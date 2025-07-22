const { logger } = require('./logger');

/**
 * Error types for classification
 */
const ERROR_TYPES = {
  RETRYABLE: 'retryable',
  NON_RETRYABLE: 'non_retryable',
  CRITICAL: 'critical'
};

/**
 * Error categories for detailed classification
 */
const ERROR_CATEGORIES = {
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  RATE_LIMIT: 'rate_limit',
  SERVER_ERROR: 'server_error',
  CLIENT_ERROR: 'client_error',
  DATA_CORRUPTION: 'data_corruption',
  RESOURCE_EXHAUSTION: 'resource_exhaustion',
  TIMEOUT: 'timeout',
  PERMISSION: 'permission',
  VALIDATION: 'validation'
};

/**
 * Circuit breaker states
 */
const CIRCUIT_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.successCount = 0;
    
    logger.info('Circuit breaker initialized', {
      failureThreshold: this.failureThreshold,
      recoveryTimeout: this.recoveryTimeout,
      monitoringPeriod: this.monitoringPeriod
    });
  }

  async execute(operation, context = {}) {
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        const error = new Error('Circuit breaker is OPEN');
        error.circuitBreakerState = this.state;
        error.nextAttemptTime = this.nextAttemptTime;
        throw error;
      }
      
      // Transition to half-open
      this.state = CIRCUIT_STATES.HALF_OPEN;
      logger.info('Circuit breaker transitioning to HALF_OPEN', context);
    }

    try {
      const result = await operation();
      this.onSuccess(context);
      return result;
    } catch (error) {
      this.onFailure(error, context);
      throw error;
    }
  }

  onSuccess(context = {}) {
    this.failureCount = 0;
    this.successCount++;
    
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.state = CIRCUIT_STATES.CLOSED;
      logger.info('Circuit breaker transitioned to CLOSED after successful operation', context);
    }
  }

  onFailure(error, context = {}) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    logger.warn('Circuit breaker recorded failure', {
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message,
      ...context
    });

    if (this.failureCount >= this.failureThreshold) {
      this.state = CIRCUIT_STATES.OPEN;
      this.nextAttemptTime = Date.now() + this.recoveryTimeout;
      
      logger.error('Circuit breaker OPENED due to failure threshold', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold,
        nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
        ...context
      });
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  reset() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    logger.info('Circuit breaker reset');
  }
}

/**
 * Enhanced Error Handler with comprehensive error classification,
 * exponential backoff retry logic, and circuit breaker patterns
 */
class ErrorHandler {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      baseDelay: config.baseDelay || 1000,
      maxDelay: config.maxDelay || 30000,
      backoffMultiplier: config.backoffMultiplier || 2,
      jitterEnabled: config.jitterEnabled !== false,
      circuitBreaker: config.circuitBreaker || {}
    };

    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
    
    logger.info('ErrorHandler initialized', {
      config: this.config
    });
  }

  /**
   * Classify error into retryable, non-retryable, or critical
   */
  classifyError(error) {
    const classification = {
      type: ERROR_TYPES.NON_RETRYABLE,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      retryable: false,
      critical: false,
      context: {}
    };

    // Network errors - typically retryable
    if (this.isNetworkError(error)) {
      classification.type = ERROR_TYPES.RETRYABLE;
      classification.category = ERROR_CATEGORIES.NETWORK;
      classification.retryable = true;
      classification.context.networkError = true;
    }
    // Timeout errors - retryable
    else if (this.isTimeoutError(error)) {
      classification.type = ERROR_TYPES.RETRYABLE;
      classification.category = ERROR_CATEGORIES.TIMEOUT;
      classification.retryable = true;
      classification.context.timeout = true;
    }
    // Rate limiting - retryable with longer delay
    else if (this.isRateLimitError(error)) {
      classification.type = ERROR_TYPES.RETRYABLE;
      classification.category = ERROR_CATEGORIES.RATE_LIMIT;
      classification.retryable = true;
      classification.context.rateLimited = true;
    }
    // Server errors (5xx) - retryable
    else if (this.isServerError(error)) {
      classification.type = ERROR_TYPES.RETRYABLE;
      classification.category = ERROR_CATEGORIES.SERVER_ERROR;
      classification.retryable = true;
      classification.context.serverError = true;
    }
    // Authentication errors - potentially retryable if token can be refreshed
    else if (this.isAuthenticationError(error)) {
      classification.type = ERROR_TYPES.RETRYABLE;
      classification.category = ERROR_CATEGORIES.AUTHENTICATION;
      classification.retryable = true;
      classification.context.authenticationError = true;
    }
    // Permission errors - non-retryable
    else if (this.isPermissionError(error)) {
      classification.type = ERROR_TYPES.NON_RETRYABLE;
      classification.category = ERROR_CATEGORIES.PERMISSION;
      classification.retryable = false;
      classification.context.permissionDenied = true;
    }
    // Client errors (4xx except 401, 429) - non-retryable
    else if (this.isClientError(error)) {
      classification.type = ERROR_TYPES.NON_RETRYABLE;
      classification.category = ERROR_CATEGORIES.CLIENT_ERROR;
      classification.retryable = false;
      classification.context.clientError = true;
    }
    // Data corruption - critical
    else if (this.isDataCorruptionError(error)) {
      classification.type = ERROR_TYPES.CRITICAL;
      classification.category = ERROR_CATEGORIES.DATA_CORRUPTION;
      classification.retryable = false;
      classification.critical = true;
      classification.context.dataCorruption = true;
    }
    // Resource exhaustion - critical
    else if (this.isResourceExhaustionError(error)) {
      classification.type = ERROR_TYPES.CRITICAL;
      classification.category = ERROR_CATEGORIES.RESOURCE_EXHAUSTION;
      classification.retryable = false;
      classification.critical = true;
      classification.context.resourceExhaustion = true;
    }
    // Validation errors - non-retryable
    else if (this.isValidationError(error)) {
      classification.type = ERROR_TYPES.NON_RETRYABLE;
      classification.category = ERROR_CATEGORIES.VALIDATION;
      classification.retryable = false;
      classification.context.validationError = true;
    }

    return classification;
  }

  /**
   * Execute operation with retry logic and circuit breaker
   */
  async executeWithRetry(operation, context = {}) {
    const operationId = context.operationId || `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    logger.info('Starting operation with error handling', {
      operationId,
      maxRetries: this.config.maxRetries,
      context
    });

    let lastError;
    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      try {
        const result = await this.circuitBreaker.execute(operation, {
          operationId,
          attempt,
          ...context
        });

        if (attempt > 0) {
          logger.info('Operation succeeded after retries', {
            operationId,
            attempt,
            totalDuration: Date.now() - startTime,
            context
          });
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        const classification = this.classifyError(error);
        
        this.logError(error, {
          operationId,
          attempt,
          maxRetries: this.config.maxRetries,
          classification,
          context
        });

        // Don't retry if error is not retryable or if we've exceeded max retries
        if (!classification.retryable || attempt > this.config.maxRetries) {
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, classification);
        
        logger.warn('Retrying operation after delay', {
          operationId,
          attempt,
          nextAttempt: attempt + 1,
          delay,
          errorType: classification.type,
          errorCategory: classification.category,
          context
        });

        await this.sleep(delay);
      }
    }

    // All retries exhausted or error is not retryable
    const totalDuration = Date.now() - startTime;
    const finalClassification = this.classifyError(lastError);
    
    logger.error('Operation failed after all retries', {
      operationId,
      totalAttempts: attempt,
      totalDuration,
      finalError: lastError.message,
      classification: finalClassification,
      context
    });

    // Enhance error with retry context
    lastError.retryContext = {
      operationId,
      totalAttempts: attempt,
      totalDuration,
      classification: finalClassification,
      circuitBreakerState: this.circuitBreaker.getState()
    };

    throw lastError;
  }

  /**
   * Calculate delay for exponential backoff with jitter
   */
  calculateDelay(attempt, classification) {
    let baseDelay = this.config.baseDelay;
    
    // Longer delays for rate limiting
    if (classification.category === ERROR_CATEGORIES.RATE_LIMIT) {
      baseDelay = Math.max(baseDelay, 5000); // Minimum 5 seconds for rate limits
    }

    // Exponential backoff
    let delay = baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    
    // For rate limiting, ensure minimum delay even after exponential backoff
    if (classification.category === ERROR_CATEGORIES.RATE_LIMIT) {
      delay = Math.max(delay, 5000);
    }
    
    // Cap at max delay (but not for rate limiting which needs longer delays)
    if (classification.category !== ERROR_CATEGORIES.RATE_LIMIT) {
      delay = Math.min(delay, this.config.maxDelay);
    }
    
    // Add jitter to prevent thundering herd
    if (this.config.jitterEnabled) {
      const jitter = delay * 0.1 * Math.random(); // Up to 10% jitter
      delay += jitter;
    }
    
    return Math.floor(delay);
  }

  /**
   * Enhanced error logging with structured context
   */
  logError(error, context = {}) {
    const errorContext = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        name: error.name,
        code: error.code,
        statusCode: error.statusCode,
        stack: error.stack
      },
      classification: context.classification,
      operation: {
        id: context.operationId,
        attempt: context.attempt,
        maxRetries: context.maxRetries
      },
      circuitBreaker: this.circuitBreaker.getState(),
      context: context.context || {}
    };

    // Log at appropriate level based on classification
    if (context.classification?.critical) {
      logger.error('CRITICAL ERROR detected', errorContext);
    } else if (context.classification?.retryable && context.attempt <= this.config.maxRetries) {
      logger.warn('Retryable error occurred', errorContext);
    } else {
      logger.error('Non-retryable error occurred', errorContext);
    }
  }

  /**
   * Error classification helper methods
   */
  isNetworkError(error) {
    return error.code === 'ECONNRESET' ||
           error.code === 'ENOTFOUND' ||
           error.code === 'ECONNREFUSED' ||
           error.code === 'ECONNABORTED' ||
           error.code === 'ENETUNREACH' ||
           error.code === 'EHOSTUNREACH' ||
           (error instanceof TypeError && error.message.includes('fetch failed')) ||
           (typeof error.message === 'string' && error.message.includes('fetch failed'));
  }

  isTimeoutError(error) {
    return error.code === 'ETIMEDOUT' ||
           error.message?.includes('timeout') ||
           error.message?.includes('Request timeout');
  }

  isRateLimitError(error) {
    return error.code === 429 ||
           error.statusCode === 429 ||
           error.code === 'TooManyRequests' ||
           error.message?.includes('rate limit') ||
           error.message?.includes('too many requests');
  }

  isServerError(error) {
    return (error.statusCode >= 500 && error.statusCode < 600) ||
           error.code === 503 ||
           error.code === 502 ||
           error.code === 500;
  }

  isAuthenticationError(error) {
    return error.code === 401 ||
           error.statusCode === 401 ||
           error.code === 'InvalidAuthenticationToken' ||
           error.code === 'Unauthorized' ||
           error.message?.includes('authentication') ||
           error.message?.includes('token');
  }

  isPermissionError(error) {
    return error.code === 403 ||
           error.statusCode === 403 ||
           error.code === 'Forbidden' ||
           error.message?.includes('permission') ||
           error.message?.includes('forbidden');
  }

  isClientError(error) {
    return (error.statusCode >= 400 && error.statusCode < 500) ||
           error.code === 400 ||
           error.code === 404 ||
           error.code === 'BadRequest' ||
           error.code === 'NotFound';
  }

  isDataCorruptionError(error) {
    return error.message?.includes('data corruption') ||
           error.message?.includes('integrity') ||
           error.message?.includes('checksum') ||
           error.code === 'DATA_CORRUPTION';
  }

  isResourceExhaustionError(error) {
    return error.code === 'ENOMEM' ||
           error.code === 'ENOSPC' ||
           error.message?.includes('out of memory') ||
           error.message?.includes('disk space') ||
           error.message?.includes('OpenWorkbookTooLarge') ||
           error.code === 'OpenWorkbookTooLarge';
  }

  isValidationError(error) {
    return error.code === 'VALIDATION_ERROR' ||
           error.message?.includes('validation') ||
           error.message?.includes('invalid') ||
           error.name === 'ValidationError';
  }

  /**
   * Sleep utility for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset();
  }

  /**
   * Create error context for debugging
   */
  createErrorContext(operation, additionalContext = {}) {
    return {
      operationId: `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      operation,
      timestamp: new Date().toISOString(),
      ...additionalContext
    };
  }
}

module.exports = {
  ErrorHandler,
  CircuitBreaker,
  ERROR_TYPES,
  ERROR_CATEGORIES,
  CIRCUIT_STATES
};