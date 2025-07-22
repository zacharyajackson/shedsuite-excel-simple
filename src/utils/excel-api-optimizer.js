/**
 * Excel API Optimizer
 * 
 * Optimizes Excel API interactions with:
 * - Direct range updates instead of sessions for large workbooks
 * - Intelligent rate limiting and request queuing
 * - Configurable timeouts for different operation types
 * - Connection pooling and request optimization
 * - Graceful degradation when Excel API is unavailable
 * 
 * Enhanced features:
 * - Adaptive timeout handling based on operation type and workbook size
 * - Advanced connection pooling with health monitoring
 * - Intelligent request batching and prioritization
 * - Circuit breaker pattern for API failure protection
 * - Performance metrics collection and analysis
 */

const { logger } = require('./logger');
const { ErrorHandler, ERROR_CATEGORIES } = require('./error-handler');

/**
 * Request Queue for managing Excel API requests
 */
class RequestQueue {
  constructor(options = {}) {
    this.config = {
      maxConcurrent: options.maxConcurrent || 3,
      queueTimeout: options.queueTimeout || 60000, // 1 minute
      priorityLevels: options.priorityLevels || 3,
      defaultPriority: options.defaultPriority || 1
    };

    this.queue = [];
    this.activeRequests = 0;
    this.rateLimitResetTime = null;
    this.paused = false;
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalErrors: 0,
      totalTimeouts: 0,
      averageWaitTime: 0,
      averageProcessingTime: 0
    };
  }

  /**
   * Add request to queue with priority
   */
  async enqueue(operation, context = {}, priority = this.config.defaultPriority) {
    this.stats.totalQueued++;
    
    const request = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      operation,
      context,
      priority: Math.min(Math.max(1, priority), this.config.priorityLevels),
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null
    };

    logger.debug('Request added to queue', {
      requestId: request.id,
      priority: request.priority,
      context: request.context
    });

    this.queue.push(request);
    this.sortQueue();

    // Process queue if not paused and below concurrency limit
    this.processQueue();

    // Return a promise that resolves when the request is processed
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue if still there
        const index = this.queue.findIndex(r => r.id === request.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.stats.totalTimeouts++;
          
          const error = new Error(`Request timed out after ${this.config.queueTimeout}ms in queue`);
          error.code = 'QUEUE_TIMEOUT';
          error.requestId = request.id;
          
          logger.warn('Request timed out in queue', {
            requestId: request.id,
            queuedAt: new Date(request.queuedAt).toISOString(),
            queueTime: Date.now() - request.queuedAt,
            context: request.context
          });
          
          reject(error);
        }
      }, this.config.queueTimeout);

      // Attach resolve/reject to the request
      request.resolve = (result) => {
        clearTimeout(timeout);
        resolve(result);
      };
      
      request.reject = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * Sort queue by priority (higher priority first)
   */
  sortQueue() {
    this.queue.sort((a, b) => {
      // Sort by priority first (higher priority first)
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // Then by queue time (oldest first)
      return a.queuedAt - b.queuedAt;
    });
  }

  /**
   * Process next request in queue
   */
  async processQueue() {
    if (this.paused || this.activeRequests >= this.config.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Check if we're rate limited
    if (this.rateLimitResetTime && Date.now() < this.rateLimitResetTime) {
      const waitTime = this.rateLimitResetTime - Date.now();
      logger.debug(`Rate limited, waiting ${waitTime}ms before processing queue`);
      setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    // Get next request
    const request = this.queue.shift();
    this.activeRequests++;
    request.startedAt = Date.now();

    const waitTime = request.startedAt - request.queuedAt;
    
    // Update average wait time
    this.stats.averageWaitTime = 
      (this.stats.averageWaitTime * (this.stats.totalProcessed) + waitTime) / 
      (this.stats.totalProcessed + 1);

    logger.debug('Processing request from queue', {
      requestId: request.id,
      priority: request.priority,
      waitTime: `${waitTime}ms`,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests
    });

    try {
      const result = await request.operation();
      request.completedAt = Date.now();
      
      const processingTime = request.completedAt - request.startedAt;
      
      // Update average processing time
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime * (this.stats.totalProcessed) + processingTime) / 
        (this.stats.totalProcessed + 1);
      
      this.stats.totalProcessed++;
      
      logger.debug('Request completed successfully', {
        requestId: request.id,
        processingTime: `${processingTime}ms`,
        totalTime: `${request.completedAt - request.queuedAt}ms`
      });
      
      request.resolve(result);
    } catch (error) {
      request.completedAt = Date.now();
      this.stats.totalErrors++;
      
      // Handle rate limiting
      if (error.statusCode === 429 || error.code === 429 || error.code === 'TooManyRequests') {
        const retryAfter = error.headers?.['retry-after'] || 10;
        this.rateLimitResetTime = Date.now() + (retryAfter * 1000);
        
        logger.warn('Rate limit hit, pausing queue', {
          requestId: request.id,
          retryAfter: `${retryAfter}s`,
          resetTime: new Date(this.rateLimitResetTime).toISOString()
        });
      }
      
      logger.error('Request failed', {
        requestId: request.id,
        error: error.message,
        code: error.code || error.statusCode,
        processingTime: `${request.completedAt - request.startedAt}ms`,
        totalTime: `${request.completedAt - request.queuedAt}ms`
      });
      
      request.reject(error);
    } finally {
      this.activeRequests--;
      
      // Process next request if available
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Pause queue processing
   */
  pause() {
    logger.info('Request queue paused');
    this.paused = true;
  }

  /**
   * Resume queue processing
   */
  resume() {
    logger.info('Request queue resumed');
    this.paused = false;
    this.processQueue();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      paused: this.paused,
      rateLimited: !!this.rateLimitResetTime && Date.now() < this.rateLimitResetTime,
      rateLimitResetTime: this.rateLimitResetTime ? new Date(this.rateLimitResetTime).toISOString() : null
    };
  }

  /**
   * Clear the queue
   */
  clear() {
    // Reject all pending requests
    this.queue.forEach(request => {
      const error = new Error('Queue cleared');
      error.code = 'QUEUE_CLEARED';
      request.reject(error);
    });
    
    this.queue = [];
    logger.info('Request queue cleared');
  }
}

/**
 * Connection Pool for Excel API
 */
class ConnectionPool {
  constructor(options = {}) {
    this.config = {
      poolSize: options.poolSize || 5,
      idleTimeout: options.idleTimeout || 300000, // 5 minutes
      maxLifetime: options.maxLifetime || 3600000 // 1 hour
    };

    this.connections = [];
    this.stats = {
      created: 0,
      reused: 0,
      expired: 0,
      errors: 0
    };
  }

  /**
   * Get a connection from the pool or create a new one
   */
  async getConnection(createFn) {
    // Find an idle connection
    const now = Date.now();
    const idleConnection = this.connections.find(conn => !conn.inUse && now - conn.lastUsed < this.config.idleTimeout);
    
    if (idleConnection) {
      idleConnection.inUse = true;
      idleConnection.lastUsed = now;
      this.stats.reused++;
      
      logger.debug('Reusing connection from pool', {
        connectionId: idleConnection.id,
        age: `${Math.round((now - idleConnection.created) / 1000)}s`,
        idleTime: `${Math.round((now - idleConnection.lastUsed) / 1000)}s`
      });
      
      return idleConnection;
    }

    // Create a new connection if pool not full
    if (this.connections.length < this.config.poolSize) {
      try {
        // If no createFn provided, create a mock client for testing
        const client = typeof createFn === 'function' 
          ? await createFn() 
          : { id: `mock_client_${Date.now()}` };
        
        const connection = {
          id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          client,
          created: now,
          lastUsed: now,
          inUse: true,
          useCount: 0
        };
        
        this.connections.push(connection);
        this.stats.created++;
        
        logger.debug('Created new connection', {
          connectionId: connection.id,
          poolSize: this.connections.length
        });
        
        return connection;
      } catch (error) {
        this.stats.errors++;
        logger.error('Error creating connection', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    }

    // No idle connections and pool is full, wait for one to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for available connection'));
      }, 30000); // 30 second timeout

      const checkInterval = setInterval(() => {
        const idleConn = this.connections.find(conn => !conn.inUse);
        if (idleConn) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          
          idleConn.inUse = true;
          idleConn.lastUsed = Date.now();
          this.stats.reused++;
          
          resolve(idleConn);
        }
      }, 100);
    });
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connection) {
    const conn = this.connections.find(c => c.id === connection.id);
    if (conn) {
      conn.inUse = false;
      conn.lastUsed = Date.now();
      conn.useCount++;
      
      logger.debug('Connection released back to pool', {
        connectionId: conn.id,
        useCount: conn.useCount,
        age: `${Math.round((Date.now() - conn.created) / 1000)}s`
      });
    }
  }

  /**
   * Clean up expired connections
   */
  cleanup() {
    const now = Date.now();
    const initialCount = this.connections.length;
    
    // Remove expired connections
    this.connections = this.connections.filter(conn => {
      const expired = 
        (now - conn.created > this.config.maxLifetime) || // Max lifetime exceeded
        (now - conn.lastUsed > this.config.idleTimeout && !conn.inUse); // Idle timeout exceeded
      
      if (expired) {
        this.stats.expired++;
        logger.debug('Removing expired connection', {
          connectionId: conn.id,
          age: `${Math.round((now - conn.created) / 1000)}s`,
          idleTime: `${Math.round((now - conn.lastUsed) / 1000)}s`,
          useCount: conn.useCount
        });
      }
      
      return !expired;
    });
    
    const removedCount = initialCount - this.connections.length;
    if (removedCount > 0) {
      logger.info(`Removed ${removedCount} expired connections`);
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const now = Date.now();
    
    return {
      ...this.stats,
      poolSize: this.connections.length,
      activeConnections: this.connections.filter(c => c.inUse).length,
      idleConnections: this.connections.filter(c => !c.inUse).length,
      oldestConnection: this.connections.length > 0 ? 
        Math.round((now - Math.min(...this.connections.map(c => c.created))) / 1000) : 0,
      averageUseCount: this.connections.length > 0 ?
        this.connections.reduce((sum, conn) => sum + conn.useCount, 0) / this.connections.length : 0
    };
  }

  /**
   * Close all connections
   */
  close() {
    this.connections = [];
    logger.info('Connection pool closed');
  }
}

/**
 * Excel API Optimizer
 */
class ExcelApiOptimizer {
  constructor(options = {}) {
    this.config = {
      // Request timeouts by operation type (in ms)
      timeouts: {
        default: options.defaultTimeout || 30000,
        read: options.readTimeout || 20000,
        write: options.writeTimeout || 60000,
        clear: options.clearTimeout || 45000,
        batch: options.batchTimeout || 90000,
        // New adaptive timeout settings
        smallWorkbook: options.smallWorkbookTimeout || 15000,
        mediumWorkbook: options.mediumWorkbookTimeout || 30000,
        largeWorkbook: options.largeWorkbookTimeout || 60000,
        veryLargeWorkbook: options.veryLargeWorkbookTimeout || 120000
      },
      // Rate limiting settings
      rateLimit: {
        maxRequestsPerMinute: options.maxRequestsPerMinute || 600,
        maxConcurrentRequests: options.maxConcurrentRequests || 5,
        // New adaptive rate limiting
        enableAdaptiveRateLimiting: options.enableAdaptiveRateLimiting !== false,
        minRequestInterval: options.minRequestInterval || 50, // ms between requests
        backoffMultiplier: options.backoffMultiplier || 1.5,
        recoveryRate: options.recoveryRate || 0.9 // Rate at which to recover after throttling
      },
      // Connection pooling settings
      connectionPool: {
        enabled: options.enableConnectionPool !== false,
        poolSize: options.connectionPoolSize || 5,
        idleTimeout: options.connectionIdleTimeout || 300000,
        // New connection health monitoring
        healthCheckInterval: options.connectionHealthCheckInterval || 60000,
        maxErrorRate: options.maxConnectionErrorRate || 0.3, // 30% error rate triggers refresh
        enableHealthMonitoring: options.enableConnectionHealthMonitoring !== false
      },
      // Graceful degradation settings
      gracefulDegradation: {
        enabled: options.enableGracefulDegradation !== false,
        localCacheEnabled: options.enableLocalCache !== false,
        maxCacheAge: options.maxCacheAge || 3600000,
        // New fallback strategies
        fallbackStrategies: options.fallbackStrategies || ['cache', 'retry', 'reduce-batch-size', 'direct-range'],
        maxFallbackAttempts: options.maxFallbackAttempts || 3,
        enableOfflineMode: options.enableOfflineMode !== false
      },
      // Retry settings
      retry: {
        maxRetries: options.maxRetries || 3,
        baseDelay: options.baseDelay || 1000,
        // New retry strategies
        retryableStatusCodes: options.retryableStatusCodes || [408, 429, 500, 502, 503, 504],
        retryableErrorCodes: options.retryableErrorCodes || [
          'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKETTIMEDOUT',
          'ServiceUnavailable', 'ThrottledRequest', 'TooManyRequests',
          'RequestTimeout', 'TemporarilyUnavailable'
        ]
      },
      // Circuit breaker settings
      circuitBreaker: {
        enabled: options.enableCircuitBreaker !== false,
        failureThreshold: options.circuitBreakerFailureThreshold || 5,
        resetTimeout: options.circuitBreakerResetTimeout || 30000,
        halfOpenSuccessThreshold: options.circuitBreakerHalfOpenSuccessThreshold || 2
      },
      // Performance monitoring
      performance: {
        enableMetricsCollection: options.enableMetricsCollection !== false,
        metricsRetentionPeriod: options.metricsRetentionPeriod || 3600000, // 1 hour
        samplingRate: options.metricsSamplingRate || 1.0, // Sample 100% of requests
        slowRequestThreshold: options.slowRequestThreshold || 5000 // 5 seconds
      }
    };

    // Initialize components
    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.retry.maxRetries,
      baseDelay: this.config.retry.baseDelay
    });

    this.requestQueue = new RequestQueue({
      maxConcurrent: this.config.rateLimit.maxConcurrentRequests
    });

    this.connectionPool = this.config.connectionPool.enabled ? 
      new ConnectionPool({
        poolSize: this.config.connectionPool.poolSize,
        idleTimeout: this.config.connectionPool.idleTimeout
      }) : null;

    // Local cache for graceful degradation
    this.cache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Circuit breaker state
    this.circuitState = {
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      lastFailure: null,
      lastSuccess: Date.now(),
      nextAttempt: null
    };

    // Performance metrics
    this.performanceMetrics = {
      requestCounts: {
        total: 0,
        success: 0,
        failure: 0,
        timeout: 0
      },
      responseTimes: {
        read: [],
        write: [],
        clear: [],
        batch: []
      },
      errorRates: {
        byType: {},
        byOperation: {}
      },
      timestamps: {
        firstRequest: null,
        lastRequest: null
      }
    };

    // Adaptive rate limiting state
    this.rateLimitState = {
      currentInterval: this.config.rateLimit.minRequestInterval,
      lastRequestTime: 0,
      consecutiveThrottles: 0,
      consecutiveSuccesses: 0
    };

    // Start cleanup interval for connection pool
    if (this.connectionPool) {
      this.cleanupInterval = setInterval(() => {
        this.connectionPool.cleanup();
      }, 60000); // Cleanup every minute
      
      // Ensure timer doesn't prevent process exit
      this.cleanupInterval.unref();
    }

    // Start health check interval for connections if enabled
    if (this.connectionPool && this.config.connectionPool.enableHealthMonitoring) {
      this.healthCheckInterval = setInterval(() => {
        this.checkConnectionHealth();
      }, this.config.connectionPool.healthCheckInterval);
      
      // Ensure timer doesn't prevent process exit
      this.healthCheckInterval.unref();
    }

    // Start metrics cleanup interval if enabled
    if (this.config.performance.enableMetricsCollection) {
      this.metricsCleanupInterval = setInterval(() => {
        this.cleanupMetrics();
      }, 300000); // Cleanup every 5 minutes
      
      // Ensure timer doesn't prevent process exit
      this.metricsCleanupInterval.unref();
    }

    logger.info('ExcelApiOptimizer initialized with enhanced features', {
      timeouts: this.config.timeouts,
      rateLimit: this.config.rateLimit,
      connectionPool: {
        enabled: !!this.connectionPool,
        poolSize: this.config.connectionPool.poolSize,
        healthMonitoring: this.config.connectionPool.enableHealthMonitoring
      },
      gracefulDegradation: this.config.gracefulDegradation,
      circuitBreaker: {
        enabled: this.config.circuitBreaker.enabled,
        failureThreshold: this.config.circuitBreaker.failureThreshold
      },
      performance: {
        metricsEnabled: this.config.performance.enableMetricsCollection
      }
    });
  }

  /**
   * Execute Excel API operation with optimizations
   */
  async executeOperation(operation, options = {}) {
    const {
      operationType = 'default',
      priority = 1,
      cacheKey = null,
      context = {}
    } = options;

    // Use adaptive timeout based on operation type and workbook size
    const timeout = this.getAdaptiveTimeout(operationType, context);

    // Check cache for read operations if graceful degradation is enabled
    if (operationType === 'read' && cacheKey && this.config.gracefulDegradation.enabled) {
      const cachedResult = this.getFromCache(cacheKey);
      if (cachedResult) {
        logger.debug('Using cached result', {
          cacheKey,
          cacheAge: Date.now() - cachedResult.timestamp
        });
        this.recordMetrics(operationType, Date.now() - 1, true); // Record cache hit as fast operation
        return cachedResult.data;
      }
    }

    // Create operation context for error handling
    const operationContext = this.errorHandler.createErrorContext('excel_api_operation', {
      operationType,
      ...context
    });

    // Check circuit breaker before proceeding
    if (!this.checkCircuitBreaker()) {
      logger.warn('Circuit breaker is open, using fallback strategies', {
        operationType,
        circuitState: this.circuitState.state,
        nextAttempt: this.circuitState.nextAttempt ? 
          new Date(this.circuitState.nextAttempt).toISOString() : null
      });
      
      // Try fallback strategies when circuit is open
      return await this.executeWithFallback(operation, {
        ...options,
        operationType,
        priority,
        cacheKey,
        context: operationContext
      });
    }

    const startTime = Date.now();

    try {
      // Apply adaptive rate limiting if enabled
      await this.applyAdaptiveRateLimit();

      // Enqueue the operation with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error(`Operation timed out after ${timeout}ms`);
          error.code = 'OPERATION_TIMEOUT';
          error.operationType = operationType;
          reject(error);
        }, timeout);
      });

      // Create the actual operation function that will be queued
      const queuedOperation = async () => {
        let connection = null;
        
        try {
          // Get connection from pool if enabled
          if (this.connectionPool) {
            connection = await this.connectionPool.getConnection(options.createConnection);
            
            // Execute operation with connection
            const result = await operation(connection.client);
            
            // Cache result for read operations
            if (operationType === 'read' && cacheKey && this.config.gracefulDegradation.enabled) {
              this.addToCache(cacheKey, result);
            }
            
            return result;
          } else {
            // Execute operation directly
            const result = await operation();
            
            // Cache result for read operations
            if (operationType === 'read' && cacheKey && this.config.gracefulDegradation.enabled) {
              this.addToCache(cacheKey, result);
            }
            
            return result;
          }
        } finally {
          // Release connection back to pool
          if (connection && this.connectionPool) {
            this.connectionPool.releaseConnection(connection);
          }
        }
      };

      // Queue the operation and race with timeout
      const result = await Promise.race([
        this.requestQueue.enqueue(queuedOperation, operationContext, priority),
        timeoutPromise
      ]);

      // Update circuit breaker and rate limiting on success
      this.updateCircuitBreaker(true);
      this.updateAdaptiveRateLimit(true);
      
      // Record metrics
      this.recordMetrics(operationType, startTime, true);
      
      return result;

    } catch (error) {
      // Record metrics for failed operation
      this.recordMetrics(operationType, startTime, false, error);
      
      // Update circuit breaker on failure
      this.updateCircuitBreaker(false);
      
      // Check if error is due to throttling
      const isThrottling = error.statusCode === 429 || error.code === 429 || 
                          error.code === 'TooManyRequests';
      
      this.updateAdaptiveRateLimit(!isThrottling);

      // Handle graceful degradation for read operations
      if (operationType === 'read' && cacheKey && this.config.gracefulDegradation.enabled) {
        const cachedResult = this.getFromCache(cacheKey, true); // Allow expired cache on error
        
        if (cachedResult) {
          logger.warn('Using expired cached result due to API error', {
            cacheKey,
            cacheAge: Date.now() - cachedResult.timestamp,
            error: error.message
          });
          
          return cachedResult.data;
        }
      }
      
      // If graceful degradation is enabled, try fallback strategies
      if (this.config.gracefulDegradation.enabled) {
        try {
          return await this.executeWithFallback(operation, {
            ...options,
            operationType,
            priority,
            cacheKey,
            context: {
              ...operationContext,
              originalError: error
            }
          });
        } catch (fallbackError) {
          // If fallback also fails, throw the original error
          throw error;
        }
      }
      
      // Rethrow the error
      throw error;
    }
  }

  /**
   * Execute batch operations efficiently with adaptive batch sizing
   */
  async executeBatch(operations, options = {}) {
    const {
      batchSize = 20,
      priority = 1,
      context = {},
      enableAdaptiveBatchSizing = true,
      minBatchSize = 5,
      maxBatchSize = 50,
      retryFailedBatches = true
    } = options;

    if (!operations || operations.length === 0) {
      return [];
    }

    logger.info(`Executing batch of ${operations.length} operations with optimized batch processing`, {
      initialBatchSize: batchSize,
      priority,
      adaptiveSizing: enableAdaptiveBatchSizing,
      retryFailedBatches
    });

    // Start with the provided batch size
    let currentBatchSize = batchSize;
    const results = [];
    let processedOperations = 0;
    let consecutiveSuccesses = 0;
    let consecutiveFailures = 0;

    // Process operations until all are complete
    while (processedOperations < operations.length) {
      // Calculate remaining operations
      const remainingOperations = operations.length - processedOperations;
      
      // Adjust batch size if needed
      if (enableAdaptiveBatchSizing) {
        if (consecutiveSuccesses >= 3) {
          // Increase batch size after consecutive successes
          const newBatchSize = Math.min(maxBatchSize, Math.floor(currentBatchSize * 1.5));
          if (newBatchSize > currentBatchSize) {
            logger.info(`Increasing batch size after consecutive successes`, {
              oldBatchSize: currentBatchSize,
              newBatchSize,
              consecutiveSuccesses
            });
            currentBatchSize = newBatchSize;
            consecutiveSuccesses = 0;
          }
        } else if (consecutiveFailures >= 2) {
          // Decrease batch size after consecutive failures
          const newBatchSize = Math.max(minBatchSize, Math.floor(currentBatchSize / 2));
          if (newBatchSize < currentBatchSize) {
            logger.warn(`Decreasing batch size after consecutive failures`, {
              oldBatchSize: currentBatchSize,
              newBatchSize,
              consecutiveFailures
            });
            currentBatchSize = newBatchSize;
            consecutiveFailures = 0;
          }
        }
      }

      // Get the next batch of operations
      const batchEndIndex = Math.min(processedOperations + currentBatchSize, operations.length);
      const currentBatch = operations.slice(processedOperations, batchEndIndex);
      const batchIndex = Math.floor(processedOperations / currentBatchSize);

      logger.debug(`Processing batch ${batchIndex + 1} with ${currentBatch.length} operations`, {
        batchSize: currentBatchSize,
        progress: `${processedOperations}/${operations.length} (${Math.round((processedOperations / operations.length) * 100)}%)`
      });

      try {
        // Execute the batch with circuit breaker and fallback strategies
        const batchResult = await this.executeOperation(
          async (client) => {
            // Format batch request
            const batchRequest = {
              requests: currentBatch.map((op, index) => ({
                id: String(index + 1),
                method: op.method,
                url: op.url,
                body: op.body,
                headers: op.headers || { 'Content-Type': 'application/json' }
              }))
            };

            // Execute batch request
            return await client.api('/$batch').post(batchRequest);
          },
          {
            operationType: 'batch',
            priority,
            context: {
              ...context,
              batchIndex,
              batchSize: currentBatch.length,
              workbookSize: context.workbookSize || 'medium',
              // Add fallback strategy for batch size reduction
              reduceBatchSize: async (newSize) => {
                if (newSize < currentBatch.length) {
                  logger.info(`Fallback: reducing batch size from ${currentBatch.length} to ${newSize}`);
                  
                  // Split the current batch into smaller batches
                  const smallerBatches = [];
                  for (let i = 0; i < currentBatch.length; i += newSize) {
                    smallerBatches.push(currentBatch.slice(i, i + newSize));
                  }
                  
                  // Process each smaller batch
                  const smallerResults = [];
                  for (const smallBatch of smallerBatches) {
                    try {
                      const smallBatchResult = await this.executeOperation(
                        async (client) => {
                          const smallBatchRequest = {
                            requests: smallBatch.map((op, index) => ({
                              id: String(index + 1),
                              method: op.method,
                              url: op.url,
                              body: op.body,
                              headers: op.headers || { 'Content-Type': 'application/json' }
                            }))
                          };
                          return await client.api('/$batch').post(smallBatchRequest);
                        },
                        {
                          operationType: 'batch',
                          priority,
                          context: {
                            ...context,
                            batchIndex,
                            batchSize: smallBatch.length,
                            isRetry: true
                          }
                        }
                      );
                      
                      if (smallBatchResult && smallBatchResult.responses) {
                        smallerResults.push(...smallBatchResult.responses);
                      }
                    } catch (smallBatchError) {
                      // Add error responses for failed small batch
                      smallerResults.push(...smallBatch.map((op, index) => ({
                        id: String(index + 1),
                        status: smallBatchError.statusCode || 500,
                        body: {
                          error: {
                            code: smallBatchError.code || 'BatchFailed',
                            message: smallBatchError.message
                          }
                        }
                      })));
                    }
                  }
                  
                  return { responses: smallerResults };
                }
                
                // If we can't reduce further, just try the original batch again
                return await client.api('/$batch').post({
                  requests: currentBatch.map((op, index) => ({
                    id: String(index + 1),
                    method: op.method,
                    url: op.url,
                    body: op.body,
                    headers: op.headers || { 'Content-Type': 'application/json' }
                  }))
                });
              }
            }
          }
        );

        // Process batch response
        if (batchResult && batchResult.responses) {
          results.push(...batchResult.responses);
          
          // Count successes and failures
          const successCount = batchResult.responses.filter(r => r.status >= 200 && r.status < 300).length;
          const failureCount = batchResult.responses.filter(r => r.status >= 400).length;
          
          logger.info(`Batch ${batchIndex + 1} completed`, {
            successCount,
            failureCount,
            successRate: `${Math.round((successCount / batchResult.responses.length) * 100)}%`
          });
          
          // Update consecutive success/failure counters
          if (failureCount === 0) {
            consecutiveSuccesses++;
            consecutiveFailures = 0;
          } else if (successCount === 0) {
            consecutiveFailures++;
            consecutiveSuccesses = 0;
          } else {
            // Mixed results - reset both counters
            consecutiveSuccesses = 0;
            consecutiveFailures = 0;
          }
        }

        // Update processed operations count
        processedOperations = batchEndIndex;

      } catch (error) {
        logger.error(`Batch ${batchIndex + 1} failed`, {
          error: error.message,
          code: error.code || error.statusCode,
          batchSize: currentBatch.length
        });

        // Increment consecutive failures
        consecutiveFailures++;
        consecutiveSuccesses = 0;

        if (retryFailedBatches) {
          // Try with smaller batch size for this batch
          logger.info(`Retrying failed batch with smaller batch size`);
          
          // Reduce batch size for retry
          const retryBatchSize = Math.max(minBatchSize, Math.floor(currentBatch.length / 2));
          
          if (retryBatchSize < currentBatch.length) {
            // Split the current batch into smaller batches
            const retryBatches = [];
            for (let i = 0; i < currentBatch.length; i += retryBatchSize) {
              retryBatches.push(currentBatch.slice(i, i + retryBatchSize));
            }
            
            // Process each retry batch
            for (const retryBatch of retryBatches) {
              try {
                const retryResult = await this.executeOperation(
                  async (client) => {
                    const retryRequest = {
                      requests: retryBatch.map((op, index) => ({
                        id: String(index + 1),
                        method: op.method,
                        url: op.url,
                        body: op.body,
                        headers: op.headers || { 'Content-Type': 'application/json' }
                      }))
                    };
                    return await client.api('/$batch').post(retryRequest);
                  },
                  {
                    operationType: 'batch',
                    priority: priority + 1, // Higher priority for retries
                    context: {
                      ...context,
                      batchIndex,
                      batchSize: retryBatch.length,
                      isRetry: true
                    }
                  }
                );
                
                if (retryResult && retryResult.responses) {
                  results.push(...retryResult.responses);
                  
                  logger.info(`Retry batch completed`, {
                    successCount: retryResult.responses.filter(r => r.status >= 200 && r.status < 300).length,
                    failureCount: retryResult.responses.filter(r => r.status >= 400).length
                  });
                }
              } catch (retryError) {
                logger.error(`Retry batch failed`, {
                  error: retryError.message,
                  code: retryError.code || retryError.statusCode
                });
                
                // Add error responses for failed retry batch
                results.push(...retryBatch.map((op, index) => ({
                  id: String(index + 1),
                  status: retryError.statusCode || 500,
                  body: {
                    error: {
                      code: retryError.code || 'BatchFailed',
                      message: retryError.message
                    }
                  }
                })));
              }
            }
          } else {
            // Can't reduce batch size further, add error responses
            results.push(...currentBatch.map((op, index) => ({
              id: String(index + 1),
              status: error.statusCode || 500,
              body: {
                error: {
                  code: error.code || 'BatchFailed',
                  message: error.message
                }
              }
            })));
          }
        } else {
          // Add error responses for all operations in the failed batch
          results.push(...currentBatch.map((op, index) => ({
            id: String(index + 1),
            status: error.statusCode || 500,
            body: {
              error: {
                code: error.code || 'BatchFailed',
                message: error.message
              }
            }
          })));
        }
        
        // Update processed operations count
        processedOperations = batchEndIndex;
      }
    }

    logger.info(`Batch processing completed`, {
      totalOperations: operations.length,
      successCount: results.filter(r => r.status >= 200 && r.status < 300).length,
      failureCount: results.filter(r => r.status >= 400).length,
      finalBatchSize: currentBatchSize
    });

    return results;
  }

  /**
   * Execute direct range update without session
   */
  async executeRangeUpdate(client, siteId, workbookId, worksheetName, range, values, options = {}) {
    const {
      priority = 2, // Higher priority for writes
      context = {}
    } = options;

    logger.debug(`Executing direct range update for ${range}`, {
      worksheetName,
      rowCount: values.length,
      columnCount: values[0]?.length || 0
    });

    return await this.executeOperation(
      async (apiClient) => {
        const client = apiClient || client;
        return await client.api(`/sites/${siteId}/drive/items/${workbookId}/workbook/worksheets/${worksheetName}/range(address='${range}')`)
          .patch({
            values
          });
      },
      {
        operationType: 'write',
        priority,
        context: {
          ...context,
          range,
          worksheetName,
          rowCount: values.length
        }
      }
    );
  }

  /**
   * Execute range clear operation
   */
  async executeRangeClear(client, siteId, workbookId, worksheetName, range, options = {}) {
    const {
      priority = 2,
      context = {}
    } = options;

    logger.debug(`Executing range clear for ${range}`, {
      worksheetName
    });

    return await this.executeOperation(
      async (apiClient) => {
        const client = apiClient || client;
        return await client.api(`/sites/${siteId}/drive/items/${workbookId}/workbook/worksheets/${worksheetName}/range(address='${range}')/clear`)
          .post({
            applyTo: 'contents'
          });
      },
      {
        operationType: 'clear',
        priority,
        context: {
          ...context,
          range,
          worksheetName
        }
      }
    );
  }

  /**
   * Execute range read operation with caching
   */
  async executeRangeRead(client, siteId, workbookId, worksheetName, range, options = {}) {
    const {
      priority = 1,
      context = {},
      useCache = true
    } = options;

    const cacheKey = useCache ? `range_read:${siteId}:${workbookId}:${worksheetName}:${range}` : null;

    logger.debug(`Executing range read for ${range}`, {
      worksheetName,
      useCache
    });

    return await this.executeOperation(
      async (apiClient) => {
        const client = apiClient || client;
        return await client.api(`/sites/${siteId}/drive/items/${workbookId}/workbook/worksheets/${worksheetName}/range(address='${range}')`)
          .get();
      },
      {
        operationType: 'read',
        priority,
        cacheKey,
        context: {
          ...context,
          range,
          worksheetName,
          workbookSize: this.estimateWorkbookSize(range)
        }
      }
    );
  }
  
  /**
   * Execute direct range operations without using sessions
   * This is more efficient for large workbooks
   */
  async executeDirectRangeOperation(client, siteId, workbookId, worksheetName, range, operation, data = null, options = {}) {
    const {
      priority = 2,
      context = {},
      operationType = 'write'
    } = options;

    logger.debug(`Executing direct range operation (${operation}) for ${range}`, {
      worksheetName,
      operationType
    });

    // Determine the API endpoint and method based on operation type
    let apiEndpoint = `/sites/${siteId}/drive/items/${workbookId}/workbook/worksheets/${worksheetName}/range(address='${range}')`;
    let method = 'get';
    let body = null;

    switch (operation) {
      case 'read':
        // Already set up for read
        break;
      case 'write':
        method = 'patch';
        body = { values: data };
        break;
      case 'clear':
        apiEndpoint += '/clear';
        method = 'post';
        body = { applyTo: 'contents' };
        break;
      case 'format':
        method = 'patch';
        body = { format: data };
        break;
      default:
        throw new Error(`Unsupported range operation: ${operation}`);
    }

    return await this.executeOperation(
      async (apiClient) => {
        const client = apiClient || client;
        const request = client.api(apiEndpoint);
        
        // Apply the appropriate method
        switch (method) {
          case 'get':
            return await request.get();
          case 'patch':
            return await request.patch(body);
          case 'post':
            return await request.post(body);
          default:
            throw new Error(`Unsupported HTTP method: ${method}`);
        }
      },
      {
        operationType,
        priority,
        context: {
          ...context,
          range,
          worksheetName,
          operation,
          workbookSize: this.estimateWorkbookSize(range)
        }
      }
    );
  }
  
  /**
   * Estimate workbook size based on range and data
   * @private
   */
  estimateWorkbookSize(range, data = null) {
    // Parse range to get dimensions
    let rowCount = 0;
    let columnCount = 0;
    
    try {
      // Parse range like "A1:Z100"
      const rangeMatch = range.match(/[A-Z]+(\d+):[A-Z]+(\d+)/);
      if (rangeMatch) {
        const startRow = parseInt(rangeMatch[1]);
        const endRow = parseInt(rangeMatch[2]);
        rowCount = endRow - startRow + 1;
        
        // Estimate column count from range
        const colMatch = range.match(/([A-Z]+)\d+:([A-Z]+)\d+/);
        if (colMatch) {
          const startCol = this.columnLetterToNumber(colMatch[1]);
          const endCol = this.columnLetterToNumber(colMatch[2]);
          columnCount = endCol - startCol + 1;
        }
      }
    } catch (e) {
      // If parsing fails, use default estimates
      rowCount = 100;
      columnCount = 10;
    }
    
    // If we have actual data, use its dimensions
    if (data && Array.isArray(data)) {
      rowCount = data.length;
      columnCount = data[0] && Array.isArray(data[0]) ? data[0].length : 1;
    }
    
    // Estimate size based on dimensions
    const estimatedCellCount = rowCount * columnCount;
    const estimatedSizeBytes = estimatedCellCount * 50; // Assume average 50 bytes per cell
    
    // Categorize workbook size
    if (estimatedSizeBytes < 1_000_000) { // < 1MB
      return 'small';
    } else if (estimatedSizeBytes < 10_000_000) { // < 10MB
      return 'medium';
    } else if (estimatedSizeBytes < 50_000_000) { // < 50MB
      return 'large';
    } else {
      return 'very-large';
    }
  }
  
  /**
   * Convert column letter to number (A=1, Z=26, AA=27, etc.)
   * @private
   */
  columnLetterToNumber(column) {
    let result = 0;
    for (let i = 0; i < column.length; i++) {
      result = result * 26 + (column.charCodeAt(i) - 64);
    }
    return result;
  }

  /**
   * Add result to cache
   */
  addToCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Cleanup old cache entries if cache is getting too large
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Get result from cache
   */
  getFromCache(key, allowExpired = false) {
    if (!this.cache.has(key)) {
      this.cacheMisses++;
      return null;
    }

    const cachedItem = this.cache.get(key);
    const now = Date.now();
    const age = now - cachedItem.timestamp;

    // Check if cache is expired
    if (!allowExpired && age > this.config.gracefulDegradation.maxCacheAge) {
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cachedItem;
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const maxAge = this.config.gracefulDegradation.maxCacheAge;
    
    let removedCount = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > maxAge) {
        this.cache.delete(key);
        removedCount++;
      }
    }
    
    logger.debug(`Cleaned up ${removedCount} expired cache entries`);
  }

  /**
   * Check circuit breaker state before executing operation
   * @private
   */
  checkCircuitBreaker() {
    if (!this.config.circuitBreaker.enabled) {
      return true; // Circuit breaker disabled, allow operation
    }

    const now = Date.now();

    // Check circuit state
    switch (this.circuitState.state) {
      case 'OPEN':
        // If circuit is open, check if we should try half-open state
        if (this.circuitState.nextAttempt && now >= this.circuitState.nextAttempt) {
          logger.info('Circuit breaker transitioning from OPEN to HALF_OPEN state');
          this.circuitState.state = 'HALF_OPEN';
          this.circuitState.failures = 0;
          return true; // Allow operation in half-open state
        }
        return false; // Circuit is open, reject operation
      
      case 'HALF_OPEN':
        // In half-open state, we allow limited operations to test if system has recovered
        return true;
      
      case 'CLOSED':
      default:
        // Circuit is closed, allow operation
        return true;
    }
  }

  /**
   * Update circuit breaker state based on operation result
   * @private
   */
  updateCircuitBreaker(success) {
    if (!this.config.circuitBreaker.enabled) {
      return;
    }

    const now = Date.now();

    switch (this.circuitState.state) {
      case 'CLOSED':
        if (success) {
          // Reset failure count on success
          this.circuitState.failures = 0;
          this.circuitState.lastSuccess = now;
        } else {
          // Increment failure count
          this.circuitState.failures++;
          this.circuitState.lastFailure = now;
          
          // If failure threshold reached, open the circuit
          if (this.circuitState.failures >= this.config.circuitBreaker.failureThreshold) {
            logger.warn('Circuit breaker threshold reached, opening circuit', {
              failures: this.circuitState.failures,
              threshold: this.config.circuitBreaker.failureThreshold
            });
            
            this.circuitState.state = 'OPEN';
            this.circuitState.nextAttempt = now + this.config.circuitBreaker.resetTimeout;
          }
        }
        break;
      
      case 'HALF_OPEN':
        if (success) {
          // Count successful operations in half-open state
          this.circuitState.failures = 0;
          this.circuitState.lastSuccess = now;
          
          // If success threshold reached, close the circuit
          if (++this.circuitState.successCount >= this.config.circuitBreaker.halfOpenSuccessThreshold) {
            logger.info('Circuit breaker recovery successful, closing circuit');
            this.circuitState.state = 'CLOSED';
            this.circuitState.successCount = 0;
          }
        } else {
          // If operation failed in half-open state, reopen the circuit
          logger.warn('Operation failed in half-open state, reopening circuit');
          this.circuitState.state = 'OPEN';
          this.circuitState.nextAttempt = now + this.config.circuitBreaker.resetTimeout;
          this.circuitState.failures++;
          this.circuitState.lastFailure = now;
          this.circuitState.successCount = 0;
        }
        break;
      
      case 'OPEN':
        // No updates needed for open state
        break;
    }
  }

  /**
   * Check connection health and refresh connections if needed
   */
  async checkConnectionHealth() {
    if (!this.connectionPool || !this.config.connectionPool.enableHealthMonitoring) {
      return;
    }

    const stats = this.connectionPool.getStats();
    const errorRate = stats.errors / (stats.created + stats.reused);

    logger.debug('Connection health check', {
      poolSize: stats.poolSize,
      activeConnections: stats.activeConnections,
      errorRate: errorRate.toFixed(2)
    });

    // If error rate is too high, refresh connections
    if (errorRate > this.config.connectionPool.maxErrorRate) {
      logger.warn('Connection error rate too high, refreshing connection pool', {
        errorRate: errorRate.toFixed(2),
        threshold: this.config.connectionPool.maxErrorRate
      });

      // Close all idle connections
      const now = Date.now();
      this.connectionPool.connections = this.connectionPool.connections.filter(conn => {
        if (!conn.inUse) {
          return false; // Remove idle connections
        }
        return true; // Keep active connections
      });

      logger.info('Connection pool partially refreshed, kept active connections');
    }
  }

  /**
   * Clean up performance metrics to prevent memory leaks
   */
  cleanupMetrics() {
    if (!this.config.performance.enableMetricsCollection) {
      return;
    }

    const now = Date.now();
    const retentionPeriod = this.config.performance.metricsRetentionPeriod;
    const cutoffTime = now - retentionPeriod;

    // Clean up response time arrays
    for (const operationType in this.performanceMetrics.responseTimes) {
      this.performanceMetrics.responseTimes[operationType] = 
        this.performanceMetrics.responseTimes[operationType].filter(item => 
          item.timestamp >= cutoffTime
        );
    }

    logger.debug('Performance metrics cleaned up', {
      retentionPeriod: `${retentionPeriod / 60000} minutes`,
      metrics: {
        read: this.performanceMetrics.responseTimes.read.length,
        write: this.performanceMetrics.responseTimes.write.length,
        clear: this.performanceMetrics.responseTimes.clear.length,
        batch: this.performanceMetrics.responseTimes.batch.length
      }
    });
  }

  /**
   * Record performance metrics for an operation
   * @private
   */
  recordMetrics(operationType, startTime, success, error = null) {
    if (!this.config.performance.enableMetricsCollection) {
      return;
    }

    const now = Date.now();
    const duration = now - startTime;

    // Update request counts
    this.performanceMetrics.requestCounts.total++;
    if (success) {
      this.performanceMetrics.requestCounts.success++;
    } else {
      this.performanceMetrics.requestCounts.failure++;
      
      // Record error type
      const errorType = error?.code || error?.statusCode || 'unknown';
      this.performanceMetrics.errorRates.byType[errorType] = 
        (this.performanceMetrics.errorRates.byType[errorType] || 0) + 1;
      
      // Record error by operation
      if (!this.performanceMetrics.errorRates.byOperation[operationType]) {
        this.performanceMetrics.errorRates.byOperation[operationType] = {};
      }
      this.performanceMetrics.errorRates.byOperation[operationType][errorType] = 
        (this.performanceMetrics.errorRates.byOperation[operationType][errorType] || 0) + 1;
    }

    // Record response time
    if (!this.performanceMetrics.responseTimes[operationType]) {
      this.performanceMetrics.responseTimes[operationType] = [];
    }
    
    this.performanceMetrics.responseTimes[operationType].push({
      duration,
      success,
      timestamp: now,
      errorType: error?.code || error?.statusCode
    });

    // Update timestamps
    if (!this.performanceMetrics.timestamps.firstRequest) {
      this.performanceMetrics.timestamps.firstRequest = now;
    }
    this.performanceMetrics.timestamps.lastRequest = now;

    // Log slow requests
    if (duration > this.config.performance.slowRequestThreshold) {
      logger.warn('Slow Excel API operation detected', {
        operationType,
        duration: `${duration}ms`,
        threshold: `${this.config.performance.slowRequestThreshold}ms`,
        success,
        errorType: error?.code || error?.statusCode
      });
    }
  }

  /**
   * Get adaptive timeout for operation based on workbook size
   * @param {string} operationType - Type of operation
   * @param {Object} context - Operation context
   * @returns {number} - Timeout in milliseconds
   */
  getAdaptiveTimeout(operationType, context = {}) {
    // Get base timeout for operation type
    const baseTimeout = this.config.timeouts[operationType] || this.config.timeouts.default;
    
    // If no workbook size info available, return base timeout
    if (!context.workbookSize) {
      return baseTimeout;
    }
    
    // Adjust timeout based on workbook size
    switch (context.workbookSize) {
      case 'small': // < 1MB
        return this.config.timeouts.smallWorkbook;
      case 'medium': // 1-10MB
        return this.config.timeouts.mediumWorkbook;
      case 'large': // 10-50MB
        return this.config.timeouts.largeWorkbook;
      case 'very-large': // > 50MB
        return this.config.timeouts.veryLargeWorkbook;
      default:
        return baseTimeout;
    }
  }

  /**
   * Apply adaptive rate limiting
   * @private
   */
  applyAdaptiveRateLimit() {
    if (!this.config.rateLimit.enableAdaptiveRateLimiting) {
      return;
    }

    const now = Date.now();
    const timeSinceLastRequest = now - this.rateLimitState.lastRequestTime;
    
    // If we haven't waited long enough, delay the next request
    if (timeSinceLastRequest < this.rateLimitState.currentInterval) {
      const delay = this.rateLimitState.currentInterval - timeSinceLastRequest;
      return new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Update last request time
    this.rateLimitState.lastRequestTime = now;
    return Promise.resolve();
  }

  /**
   * Update adaptive rate limiting based on request result
   * @private
   */
  updateAdaptiveRateLimit(success) {
    if (!this.config.rateLimit.enableAdaptiveRateLimiting) {
      return;
    }

    if (success) {
      // Increase consecutive successes and reset throttle count
      this.rateLimitState.consecutiveSuccesses++;
      this.rateLimitState.consecutiveThrottles = 0;
      
      // After enough consecutive successes, gradually reduce interval
      if (this.rateLimitState.consecutiveSuccesses >= 5) {
        const newInterval = Math.max(
          this.config.rateLimit.minRequestInterval,
          this.rateLimitState.currentInterval * this.config.rateLimit.recoveryRate
        );
        
        if (newInterval !== this.rateLimitState.currentInterval) {
          logger.debug('Reducing rate limit interval after consecutive successes', {
            oldInterval: `${this.rateLimitState.currentInterval}ms`,
            newInterval: `${newInterval}ms`
          });
          
          this.rateLimitState.currentInterval = newInterval;
        }
      }
    } else {
      // Increase throttle count and reset success count
      this.rateLimitState.consecutiveThrottles++;
      this.rateLimitState.consecutiveSuccesses = 0;
      
      // Increase interval after throttling
      const newInterval = this.rateLimitState.currentInterval * this.config.rateLimit.backoffMultiplier;
      
      logger.warn('Increasing rate limit interval after throttling', {
        oldInterval: `${this.rateLimitState.currentInterval}ms`,
        newInterval: `${newInterval}ms`,
        consecutiveThrottles: this.rateLimitState.consecutiveThrottles
      });
      
      this.rateLimitState.currentInterval = newInterval;
    }
  }

  /**
   * Execute operation with circuit breaker and adaptive rate limiting
   * @param {Function} operation - Operation to execute
   * @param {Object} options - Options for the operation
   * @returns {Promise<any>} - Operation result
   */
  async executeWithCircuitBreaker(operation, options = {}) {
    // Check if circuit breaker allows operation
    if (!this.checkCircuitBreaker()) {
      const error = new Error('Circuit breaker is open, operation rejected');
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }

    // Apply adaptive rate limiting
    await this.applyAdaptiveRateLimit();

    const startTime = Date.now();
    const operationType = options.operationType || 'default';

    try {
      // Execute operation
      const result = await operation();
      
      // Update circuit breaker and rate limiting on success
      this.updateCircuitBreaker(true);
      this.updateAdaptiveRateLimit(true);
      
      // Record metrics
      this.recordMetrics(operationType, startTime, true);
      
      return result;
    } catch (error) {
      // Update circuit breaker and rate limiting on failure
      this.updateCircuitBreaker(false);
      
      // Check if error is due to throttling
      const isThrottling = error.statusCode === 429 || error.code === 429 || 
                          error.code === 'TooManyRequests';
      
      this.updateAdaptiveRateLimit(!isThrottling);
      
      // Record metrics
      this.recordMetrics(operationType, startTime, false, error);
      
      throw error;
    }
  }

  /**
   * Execute operation with fallback strategies
   * @param {Function} operation - Operation to execute
   * @param {Object} options - Options for the operation
   * @returns {Promise<any>} - Operation result
   */
  async executeWithFallback(operation, options = {}) {
    const {
      operationType = 'default',
      fallbackStrategies = this.config.gracefulDegradation.fallbackStrategies,
      maxAttempts = this.config.gracefulDegradation.maxFallbackAttempts,
      context = {}
    } = options;

    // Try primary operation first
    try {
      return await this.executeWithCircuitBreaker(operation, options);
    } catch (primaryError) {
      // If graceful degradation is disabled, rethrow error
      if (!this.config.gracefulDegradation.enabled) {
        throw primaryError;
      }

      logger.warn('Primary operation failed, attempting fallback strategies', {
        operationType,
        error: primaryError.message,
        code: primaryError.code || primaryError.statusCode,
        availableStrategies: fallbackStrategies
      });

      // Try each fallback strategy in order
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const strategyIndex = attempt % fallbackStrategies.length;
        const strategy = fallbackStrategies[strategyIndex];

        try {
          logger.info(`Attempting fallback strategy: ${strategy}`, {
            attempt: attempt + 1,
            maxAttempts
          });

          switch (strategy) {
            case 'cache':
              // Try to use cached data (for read operations)
              if (operationType === 'read' && options.cacheKey) {
                const cachedResult = this.getFromCache(options.cacheKey, true); // Allow expired cache
                if (cachedResult) {
                  logger.info('Using cached data as fallback', {
                    cacheKey: options.cacheKey,
                    cacheAge: Date.now() - cachedResult.timestamp
                  });
                  return cachedResult.data;
                }
              }
              break;

            case 'retry':
              // Simple retry with delay
              await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
              return await this.executeWithCircuitBreaker(operation, options);

            case 'reduce-batch-size':
              // For batch operations, try with smaller batch size
              if (context.batchSize && context.reduceBatchSize) {
                const newBatchSize = Math.max(1, Math.floor(context.batchSize / 2));
                logger.info('Reducing batch size as fallback', {
                  originalBatchSize: context.batchSize,
                  newBatchSize
                });
                return await context.reduceBatchSize(newBatchSize);
              }
              break;

            case 'direct-range':
              // For session-based operations, try direct range update
              if (context.useDirectRange) {
                logger.info('Switching to direct range update as fallback');
                return await context.useDirectRange();
              }
              break;

            default:
              logger.warn(`Unknown fallback strategy: ${strategy}`);
          }
        } catch (fallbackError) {
          logger.error(`Fallback strategy '${strategy}' failed`, {
            error: fallbackError.message,
            attempt: attempt + 1,
            maxAttempts
          });
        }
      }

      // If all fallback strategies failed, rethrow the original error
      logger.error('All fallback strategies failed', {
        operationType,
        error: primaryError.message
      });
      throw primaryError;
    }
  }

  /**
   * Get performance metrics and statistics
   */
  getPerformanceMetrics() {
    if (!this.config.performance.enableMetricsCollection) {
      return { enabled: false };
    }

    const now = Date.now();
    const metrics = { ...this.performanceMetrics };

    // Calculate average response times
    const averages = {};
    for (const operationType in metrics.responseTimes) {
      const times = metrics.responseTimes[operationType];
      if (times.length > 0) {
        const successTimes = times.filter(t => t.success).map(t => t.duration);
        const failureTimes = times.filter(t => !t.success).map(t => t.duration);
        
        averages[operationType] = {
          overall: times.reduce((sum, t) => sum + t.duration, 0) / times.length,
          success: successTimes.length > 0 ? 
            successTimes.reduce((sum, d) => sum + d, 0) / successTimes.length : 0,
          failure: failureTimes.length > 0 ? 
            failureTimes.reduce((sum, d) => sum + d, 0) / failureTimes.length : 0,
          count: times.length,
          successCount: successTimes.length,
          failureCount: failureTimes.length
        };
      }
    }

    // Calculate success rate
    const successRate = metrics.requestCounts.total > 0 ? 
      metrics.requestCounts.success / metrics.requestCounts.total : 1;

    // Calculate throughput
    let throughput = 0;
    if (metrics.timestamps.firstRequest && metrics.timestamps.lastRequest) {
      const timeSpan = (metrics.timestamps.lastRequest - metrics.timestamps.firstRequest) / 1000; // in seconds
      if (timeSpan > 0) {
        throughput = metrics.requestCounts.total / timeSpan;
      }
    }

    return {
      enabled: true,
      averageResponseTimes: averages,
      successRate,
      throughput: `${throughput.toFixed(2)} requests/second`,
      errorRates: metrics.errorRates,
      circuitBreakerState: this.circuitState.state,
      rateLimitInterval: `${this.rateLimitState.currentInterval}ms`,
      requestCounts: metrics.requestCounts,
      timestamp: now
    };
  }

  /**
   * Get optimizer statistics
   */
  getStats() {
    return {
      requestQueue: this.requestQueue.getStats(),
      connectionPool: this.connectionPool ? this.connectionPool.getStats() : null,
      cache: {
        size: this.cache.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.cacheHits + this.cacheMisses > 0 ? 
          this.cacheHits / (this.cacheHits + this.cacheMisses) : 0
      },
      circuitBreaker: {
        state: this.circuitState.state,
        failures: this.circuitState.failures,
        lastFailure: this.circuitState.lastFailure ? new Date(this.circuitState.lastFailure).toISOString() : null,
        lastSuccess: this.circuitState.lastSuccess ? new Date(this.circuitState.lastSuccess).toISOString() : null,
        nextAttempt: this.circuitState.nextAttempt ? new Date(this.circuitState.nextAttempt).toISOString() : null
      },
      rateLimit: {
        currentInterval: `${this.rateLimitState.currentInterval}ms`,
        consecutiveThrottles: this.rateLimitState.consecutiveThrottles,
        consecutiveSuccesses: this.rateLimitState.consecutiveSuccesses
      },
      performance: this.getPerformanceMetrics()
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.metricsCleanupInterval) {
      clearInterval(this.metricsCleanupInterval);
    }
    
    if (this.connectionPool) {
      this.connectionPool.close();
    }
    
    this.requestQueue.clear();
    this.cache.clear();
    
    logger.info('ExcelApiOptimizer destroyed');
  }
}

module.exports = {
  ExcelApiOptimizer,
  RequestQueue,
  ConnectionPool
};