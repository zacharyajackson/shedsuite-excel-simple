const { logger } = require('./logger');
const { ProgressState } = require('./progress-state');
const { RowPositionTracker } = require('./row-position-tracker');
const { ErrorHandler } = require('./error-handler');

/**
 * Performance Metrics Tracker
 * Tracks batch processing performance for adaptive sizing
 */
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      batchTimes: [],
      errorRates: [],
      timeoutCounts: 0,
      successCounts: 0,
      totalBatches: 0,
      averageResponseTime: 0,
      recentPerformance: []
    };
    this.windowSize = 10; // Track last 10 batches for adaptive decisions
  }

  recordBatchMetrics(batchSize, processingTime, success, errorType = null) {
    this.metrics.totalBatches++;
    
    if (success) {
      this.metrics.successCounts++;
      this.metrics.batchTimes.push({ batchSize, processingTime, timestamp: Date.now() });
      
      // Keep only recent batch times
      if (this.metrics.batchTimes.length > this.windowSize) {
        this.metrics.batchTimes.shift();
      }
      
      // Update average response time
      const recentTimes = this.metrics.batchTimes.map(b => b.processingTime);
      this.metrics.averageResponseTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
    } else {
      if (errorType === 'timeout') {
        this.metrics.timeoutCounts++;
      }
    }

    // Track recent performance for adaptive decisions
    this.metrics.recentPerformance.push({
      batchSize,
      processingTime,
      success,
      errorType,
      timestamp: Date.now()
    });

    if (this.metrics.recentPerformance.length > this.windowSize) {
      this.metrics.recentPerformance.shift();
    }

    // Calculate current error rate
    const recentErrors = this.metrics.recentPerformance.filter(p => !p.success).length;
    this.metrics.currentErrorRate = recentErrors / this.metrics.recentPerformance.length;
  }

  getPerformanceInsights() {
    const recentSuccesses = this.metrics.recentPerformance.filter(p => p.success);
    const recentTimeouts = this.metrics.recentPerformance.filter(p => p.errorType === 'timeout');
    
    return {
      averageResponseTime: this.metrics.averageResponseTime,
      currentErrorRate: this.metrics.currentErrorRate || 0,
      recentTimeoutRate: recentTimeouts.length / this.metrics.recentPerformance.length,
      performanceTrend: this.calculatePerformanceTrend(),
      recommendedAction: this.getRecommendedAction(),
      totalBatches: this.metrics.totalBatches,
      successRate: this.metrics.successCounts / this.metrics.totalBatches
    };
  }

  calculatePerformanceTrend() {
    if (this.metrics.recentPerformance.length < 3) return 'insufficient_data';
    
    const recent = this.metrics.recentPerformance.slice(-3);
    const older = this.metrics.recentPerformance.slice(-6, -3);
    
    if (older.length === 0) return 'insufficient_data';
    
    const recentAvgTime = recent.reduce((sum, p) => sum + (p.processingTime || 0), 0) / recent.length;
    const olderAvgTime = older.reduce((sum, p) => sum + (p.processingTime || 0), 0) / older.length;
    
    if (recentAvgTime < olderAvgTime * 0.9) return 'improving';
    if (recentAvgTime > olderAvgTime * 1.1) return 'degrading';
    return 'stable';
  }

  getRecommendedAction() {
    const insights = {
      averageResponseTime: this.metrics.averageResponseTime,
      currentErrorRate: this.metrics.currentErrorRate || 0,
      recentTimeoutRate: this.metrics.recentPerformance.filter(p => p.errorType === 'timeout').length / this.metrics.recentPerformance.length
    };

    // High timeout rate - reduce batch size
    if (insights.recentTimeoutRate > 0.3) {
      return { action: 'decrease', reason: 'high_timeout_rate', factor: 0.5 };
    }

    // High error rate - reduce batch size
    if (insights.currentErrorRate > 0.2) {
      return { action: 'decrease', reason: 'high_error_rate', factor: 0.7 };
    }

    // Slow response times - reduce batch size
    if (insights.averageResponseTime > 30000) { // 30 seconds
      return { action: 'decrease', reason: 'slow_response_time', factor: 0.8 };
    }

    // Good performance - consider increasing
    if (insights.currentErrorRate < 0.05 && insights.averageResponseTime < 10000 && this.calculatePerformanceTrend() === 'stable') {
      return { action: 'increase', reason: 'good_performance', factor: 1.2 };
    }

    return { action: 'maintain', reason: 'stable_performance', factor: 1.0 };
  }

  reset() {
    this.metrics = {
      batchTimes: [],
      errorRates: [],
      timeoutCounts: 0,
      successCounts: 0,
      totalBatches: 0,
      averageResponseTime: 0,
      recentPerformance: []
    };
  }
}

/**
 * Adaptive Batch Sizing Manager
 * Manages dynamic batch size adjustments based on performance metrics
 */
class AdaptiveBatchSizer {
  constructor(options = {}) {
    this.config = {
      initialBatchSize: options.initialBatchSize || 50,
      minBatchSize: options.minBatchSize || 5,
      maxBatchSize: options.maxBatchSize || 200,
      adjustmentFactor: options.adjustmentFactor || 0.2,
      stabilityThreshold: options.stabilityThreshold || 5, // batches before considering adjustment
      performanceWindow: options.performanceWindow || 10
    };
    
    this.currentBatchSize = this.config.initialBatchSize;
    this.adjustmentHistory = [];
    this.batchesSinceLastAdjustment = 0;
  }

  adjustBatchSize(performanceInsights) {
    const recommendation = performanceInsights.recommendedAction;
    
    // Only adjust if we have enough stability
    if (this.batchesSinceLastAdjustment < this.config.stabilityThreshold) {
      this.batchesSinceLastAdjustment++;
      return {
        batchSize: this.currentBatchSize,
        adjusted: false,
        reason: 'waiting_for_stability'
      };
    }

    let newBatchSize = this.currentBatchSize;
    let adjusted = false;

    if (recommendation.action === 'decrease') {
      newBatchSize = Math.max(
        this.config.minBatchSize,
        Math.floor(this.currentBatchSize * recommendation.factor)
      );
      adjusted = newBatchSize !== this.currentBatchSize;
    } else if (recommendation.action === 'increase') {
      newBatchSize = Math.min(
        this.config.maxBatchSize,
        Math.ceil(this.currentBatchSize * recommendation.factor)
      );
      adjusted = newBatchSize !== this.currentBatchSize;
    }

    if (adjusted) {
      logger.info('Adjusting batch size', {
        previousSize: this.currentBatchSize,
        newSize: newBatchSize,
        reason: recommendation.reason,
        factor: recommendation.factor,
        performanceInsights: {
          errorRate: performanceInsights.currentErrorRate,
          avgResponseTime: performanceInsights.averageResponseTime,
          trend: performanceInsights.performanceTrend
        }
      });

      this.adjustmentHistory.push({
        timestamp: Date.now(),
        previousSize: this.currentBatchSize,
        newSize: newBatchSize,
        reason: recommendation.reason,
        performanceInsights
      });

      this.currentBatchSize = newBatchSize;
      this.batchesSinceLastAdjustment = 0;
    } else {
      this.batchesSinceLastAdjustment++;
    }

    return {
      batchSize: this.currentBatchSize,
      adjusted,
      reason: recommendation.reason,
      recommendation
    };
  }

  getCurrentBatchSize() {
    return this.currentBatchSize;
  }

  getAdjustmentHistory() {
    return this.adjustmentHistory;
  }

  reset(initialSize = null) {
    this.currentBatchSize = initialSize || this.config.initialBatchSize;
    this.adjustmentHistory = [];
    this.batchesSinceLastAdjustment = 0;
  }
}

/**
 * Enhanced Batch Processor
 * 
 * Provides reliable batch processing with accurate row position tracking,
 * progress state management, duplicate prevention, and adaptive batch sizing.
 */
class EnhancedBatchProcessor {
  constructor(options = {}) {
    this.config = {
      batchSize: options.batchSize || 50,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      maxConcurrentBatches: options.maxConcurrentBatches || 1,
      enableProgressState: options.enableProgressState !== false,
      enableRowTracking: options.enableRowTracking !== false,
      validateRowPositions: options.validateRowPositions !== false,
      startRow: options.startRow || 2,
      stateDir: options.stateDir || 'state',
      // Adaptive batch sizing options
      enableAdaptiveSizing: options.enableAdaptiveSizing !== false,
      minBatchSize: options.minBatchSize || 5,
      maxBatchSize: options.maxBatchSize || 200,
      performanceMonitoring: options.performanceMonitoring !== false
    };

    // Initialize components
    this.progressState = this.config.enableProgressState 
      ? new ProgressState({ stateDir: this.config.stateDir })
      : null;

    this.rowTracker = this.config.enableRowTracking 
      ? new RowPositionTracker({ 
          startRow: this.config.startRow,
          maxConcurrentBatches: this.config.maxConcurrentBatches,
          conflictDetectionEnabled: true,
          validationEnabled: this.config.validateRowPositions
        })
      : null;

    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.maxRetries,
      baseDelay: this.config.retryDelay
    });

    // Initialize adaptive sizing components
    this.performanceMetrics = this.config.performanceMonitoring 
      ? new PerformanceMetrics()
      : null;

    this.adaptiveSizer = this.config.enableAdaptiveSizing 
      ? new AdaptiveBatchSizer({
          initialBatchSize: this.config.batchSize,
          minBatchSize: this.config.minBatchSize,
          maxBatchSize: this.config.maxBatchSize
        })
      : null;

    this.operationId = null;
    this.isInitialized = false;

    logger.info('EnhancedBatchProcessor initialized', {
      config: this.config,
      componentsEnabled: {
        progressState: !!this.progressState,
        rowTracking: !!this.rowTracker,
        errorHandler: true,
        performanceMetrics: !!this.performanceMetrics,
        adaptiveSizing: !!this.adaptiveSizer
      }
    });
  }

  /**
   * Initialize batch processor for a new operation
   */
  async initialize(operationId, records, options = {}) {
    try {
      this.operationId = operationId;
      const totalRecords = records.length;
      const totalBatches = Math.ceil(totalRecords / this.config.batchSize);

      const initData = {
        totalRecords,
        totalBatches,
        batchSize: this.config.batchSize,
        maxRetries: this.config.maxRetries,
        ...options
      };

      // Initialize progress state
      if (this.progressState) {
        await this.progressState.initialize(operationId, initData);
      }

      // Reset row tracker
      if (this.rowTracker) {
        this.rowTracker.reset(this.config.startRow);
      }

      this.isInitialized = true;

      logger.info('Batch processor initialized', {
        operationId,
        totalRecords,
        totalBatches,
        batchSize: this.config.batchSize
      });

      return {
        operationId,
        totalRecords,
        totalBatches,
        batchSize: this.config.batchSize,
        canResume: false
      };
    } catch (error) {
      logger.error('Failed to initialize batch processor', {
        operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Resume batch processor from existing state
   */
  async resume(operationId) {
    try {
      this.operationId = operationId;

      // Load progress state
      let recoveryInfo = null;
      if (this.progressState) {
        const state = await this.progressState.loadState(operationId);
        if (!state) {
          throw new Error(`No existing state found for operation ${operationId}`);
        }
        recoveryInfo = this.progressState.getRecoveryInfo();
      }

      // Initialize row tracker for resume
      if (this.rowTracker && recoveryInfo) {
        this.rowTracker.reset(recoveryInfo.nextRowPosition);
        
        // Reconstruct completed batch allocations
        const completedBatches = this.progressState.getCurrentState().completedBatches;
        for (const batch of completedBatches) {
          if (batch.rowPosition) {
            const recordCount = batch.batchSize || this.config.batchSize;
            const startRow = batch.rowPosition - recordCount + 1;
            
            // Allocate and mark as completed
            const rowRange = this.rowTracker.allocateRowRange(
              batch.batchIndex, 
              recordCount, 
              { resumeFromRow: startRow, forceAllocation: true }
            );
            this.rowTracker.markBatchCompleted(batch.batchIndex, recordCount);
          }
        }
      }

      this.isInitialized = true;

      logger.info('Batch processor resumed', {
        operationId,
        recoveryInfo: recoveryInfo ? {
          nextBatchIndex: recoveryInfo.nextBatchIndex,
          nextRowPosition: recoveryInfo.nextRowPosition,
          remainingRecords: recoveryInfo.remainingRecords,
          progressPercentage: recoveryInfo.progressPercentage
        } : null
      });

      return recoveryInfo;
    } catch (error) {
      logger.error('Failed to resume batch processor', {
        operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Process a single batch with row position tracking and performance monitoring
   */
  async processBatch(batchIndex, batchRecords, processingFunction, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Batch processor not initialized');
    }

    const { 
      retryCount = 0, 
      resumeFromRow = null,
      validateBeforeProcessing = true 
    } = options;

    let rowRange = null;
    const startTime = Date.now();
    let processingTime = 0;
    let errorType = null;

    try {
      // Allocate row range for this batch
      if (this.rowTracker) {
        rowRange = this.rowTracker.allocateRowRange(
          batchIndex, 
          batchRecords.length, 
          { resumeFromRow }
        );

        logger.info('Processing batch with row tracking', {
          batchIndex,
          recordCount: batchRecords.length,
          startRow: rowRange.startRow,
          endRow: rowRange.endRow,
          range: rowRange.range,
          retryCount,
          currentBatchSize: this.adaptiveSizer ? this.adaptiveSizer.getCurrentBatchSize() : this.config.batchSize
        });
      }

      // Validate row positions if enabled
      if (validateBeforeProcessing && this.rowTracker) {
        const validation = this.rowTracker.validateConsistency();
        if (!validation.isValid) {
          throw new Error(`Row position validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Execute the processing function with row range information
      const processingContext = {
        batchIndex,
        records: batchRecords,
        rowRange,
        retryCount,
        operationId: this.operationId
      };

      const result = await this.errorHandler.executeWithRetry(
        () => processingFunction(processingContext),
        this.errorHandler.createErrorContext('batch_processing', {
          batchIndex,
          recordCount: batchRecords.length,
          rowRange: rowRange ? `${rowRange.startRow}-${rowRange.endRow}` : 'unknown'
        })
      );

      processingTime = Date.now() - startTime;

      // Record performance metrics for successful batch
      if (this.performanceMetrics) {
        this.performanceMetrics.recordBatchMetrics(
          batchRecords.length,
          processingTime,
          true,
          null
        );
      }

      // Mark batch as completed
      if (this.rowTracker) {
        this.rowTracker.markBatchCompleted(batchIndex, batchRecords.length);
      }

      // Update progress state
      if (this.progressState) {
        await this.progressState.updateProgress(batchIndex, {
          recordsProcessed: batchRecords.length,
          rowPosition: rowRange ? rowRange.endRow : null,
          batchSize: batchRecords.length,
          metadata: {
            processingTime,
            retryCount,
            rowRange: rowRange ? rowRange.range : null
          }
        });
      }

      logger.info('Batch processed successfully', {
        batchIndex,
        recordCount: batchRecords.length,
        rowRange: rowRange ? `${rowRange.startRow}-${rowRange.endRow}` : 'unknown',
        retryCount,
        processingTime,
        performanceMetrics: this.performanceMetrics ? {
          avgResponseTime: this.performanceMetrics.getPerformanceInsights().averageResponseTime,
          errorRate: this.performanceMetrics.getPerformanceInsights().currentErrorRate
        } : null
      });

      return {
        batchIndex,
        recordsProcessed: batchRecords.length,
        rowRange,
        success: true,
        result,
        processingTime
      };

    } catch (error) {
      processingTime = Date.now() - startTime;
      
      // Classify error type for performance metrics
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        errorType = 'timeout';
      } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
        errorType = 'network';
      } else if (error.status === 429) {
        errorType = 'rate_limit';
      } else if (error.status >= 500) {
        errorType = 'server_error';
      } else {
        errorType = 'client_error';
      }

      // Record performance metrics for failed batch
      if (this.performanceMetrics) {
        this.performanceMetrics.recordBatchMetrics(
          batchRecords.length,
          processingTime,
          false,
          errorType
        );
      }

      logger.error('Batch processing failed', {
        batchIndex,
        recordCount: batchRecords.length,
        rowRange: rowRange ? `${rowRange.startRow}-${rowRange.endRow}` : 'unknown',
        retryCount,
        error: error.message,
        errorType,
        processingTime
      });

      // Mark batch as failed
      if (this.rowTracker) {
        this.rowTracker.markBatchFailed(batchIndex, error);
      }

      // Record failed batch in progress state
      if (this.progressState) {
        await this.progressState.recordFailedBatch(batchIndex, error, retryCount);
      }

      throw error;
    }
  }

  /**
   * Process all batches with adaptive sizing and proper sequencing
   */
  async processAllBatches(records, processingFunction, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Batch processor not initialized');
    }

    const { 
      resumeFromBatch = 0,
      maxConcurrentBatches = this.config.maxConcurrentBatches,
      validateAfterEachBatch = true 
    } = options;

    const results = [];
    let processedRecords = 0;
    let currentBatchIndex = resumeFromBatch;
    let recordIndex = resumeFromBatch * this.config.batchSize;

    // Reset performance metrics for this operation
    if (this.performanceMetrics) {
      this.performanceMetrics.reset();
    }

    // Reset adaptive sizer for this operation
    if (this.adaptiveSizer) {
      this.adaptiveSizer.reset(this.config.batchSize);
    }

    logger.info('Starting adaptive batch processing', {
      totalRecords: records.length,
      initialBatchSize: this.config.batchSize,
      resumeFromBatch,
      maxConcurrentBatches,
      adaptiveSizingEnabled: !!this.adaptiveSizer,
      performanceMonitoringEnabled: !!this.performanceMetrics
    });

    try {
      // Process batches with adaptive sizing
      while (recordIndex < records.length) {
        // Get current batch size (may be adjusted based on performance)
        let currentBatchSize = this.config.batchSize;
        
        if (this.adaptiveSizer && this.performanceMetrics) {
          const performanceInsights = this.performanceMetrics.getPerformanceInsights();
          const sizingDecision = this.adaptiveSizer.adjustBatchSize(performanceInsights);
          currentBatchSize = sizingDecision.batchSize;

          if (sizingDecision.adjusted) {
            logger.info('Batch size adjusted', {
              batchIndex: currentBatchIndex,
              previousSize: this.config.batchSize,
              newSize: currentBatchSize,
              reason: sizingDecision.reason,
              performanceInsights: {
                errorRate: performanceInsights.currentErrorRate,
                avgResponseTime: performanceInsights.averageResponseTime,
                trend: performanceInsights.performanceTrend
              }
            });
          }
        }

        // Calculate batch boundaries
        const batchStart = recordIndex;
        const batchEnd = Math.min(batchStart + currentBatchSize, records.length);
        const batchRecords = records.slice(batchStart, batchEnd);

        if (batchRecords.length === 0) {
          break; // No more records to process
        }

        try {
          const batchResult = await this.processBatch(
            currentBatchIndex, 
            batchRecords, 
            processingFunction,
            { 
              currentBatchSize,
              adaptiveSizing: !!this.adaptiveSizer 
            }
          );
          
          results.push(batchResult);
          processedRecords += batchRecords.length;
          recordIndex += batchRecords.length;

          // Validate consistency after each batch if enabled
          if (validateAfterEachBatch && this.rowTracker) {
            const validation = this.rowTracker.validateConsistency();
            if (validation.warnings.length > 0) {
              logger.warn('Row position validation warnings', {
                batchIndex: currentBatchIndex,
                warnings: validation.warnings
              });
            }
          }

          // Log progress with adaptive sizing info
          const progressPercentage = Math.round((processedRecords / records.length) * 100);
          const remainingRecords = records.length - processedRecords;
          const estimatedRemainingBatches = Math.ceil(remainingRecords / currentBatchSize);

          logger.info('Batch processing progress', {
            batchIndex: currentBatchIndex,
            batchSize: currentBatchSize,
            processedRecords,
            totalRecords: records.length,
            progressPercentage,
            remainingRecords,
            estimatedRemainingBatches,
            performanceMetrics: this.performanceMetrics ? {
              avgResponseTime: this.performanceMetrics.getPerformanceInsights().averageResponseTime,
              errorRate: this.performanceMetrics.getPerformanceInsights().currentErrorRate,
              successRate: this.performanceMetrics.getPerformanceInsights().successRate
            } : null
          });

        } catch (batchError) {
          logger.error('Batch failed after all retries', {
            batchIndex: currentBatchIndex,
            batchSize: currentBatchSize,
            error: batchError.message,
            processedSoFar: processedRecords
          });

          // Record failed batch for adaptive sizing
          if (this.performanceMetrics) {
            // This will be recorded in processBatch, but we ensure it's captured
            logger.debug('Performance metrics will adjust for batch failure');
          }

          // Continue with next batch or stop based on configuration
          if (options.stopOnFirstFailure) {
            throw batchError;
          }
          
          results.push({
            batchIndex: currentBatchIndex,
            recordsProcessed: 0,
            success: false,
            error: batchError.message,
            batchSize: currentBatchSize
          });

          // Move to next batch even on failure
          recordIndex += batchRecords.length;
        }

        currentBatchIndex++;
      }

      // Final validation
      if (this.rowTracker) {
        const finalValidation = this.rowTracker.validateConsistency();
        if (!finalValidation.isValid) {
          logger.error('Final row position validation failed', {
            errors: finalValidation.errors,
            warnings: finalValidation.warnings
          });
        }
      }

      const successfulBatches = results.filter(r => r.success).length;
      const failedBatches = results.filter(r => !r.success).length;
      const totalBatches = results.length;

      // Get final performance insights
      const finalPerformanceInsights = this.performanceMetrics ? 
        this.performanceMetrics.getPerformanceInsights() : null;

      const adaptiveSizingHistory = this.adaptiveSizer ? 
        this.adaptiveSizer.getAdjustmentHistory() : null;

      logger.info('Adaptive batch processing completed', {
        totalBatches,
        successfulBatches,
        failedBatches,
        totalProcessedRecords: processedRecords,
        successRate: `${Math.round((successfulBatches / totalBatches) * 100)}%`,
        finalBatchSize: this.adaptiveSizer ? this.adaptiveSizer.getCurrentBatchSize() : this.config.batchSize,
        performanceInsights: finalPerformanceInsights,
        adaptiveSizingAdjustments: adaptiveSizingHistory ? adaptiveSizingHistory.length : 0
      });

      return {
        totalBatches,
        successfulBatches,
        failedBatches,
        processedRecords,
        results,
        summary: {
          operationId: this.operationId,
          totalRecords: records.length,
          successRate: successfulBatches / totalBatches,
          rowTrackingInfo: this.rowTracker ? this.rowTracker.getRecoveryInfo() : null,
          progressInfo: this.progressState ? this.progressState.getRecoveryInfo() : null,
          performanceInsights: finalPerformanceInsights,
          adaptiveSizing: {
            enabled: !!this.adaptiveSizer,
            finalBatchSize: this.adaptiveSizer ? this.adaptiveSizer.getCurrentBatchSize() : this.config.batchSize,
            adjustmentHistory: adaptiveSizingHistory,
            totalAdjustments: adaptiveSizingHistory ? adaptiveSizingHistory.length : 0
          }
        }
      };

    } catch (error) {
      logger.error('Adaptive batch processing failed', {
        error: error.message,
        processedRecords,
        totalRecords: records.length,
        currentBatchSize: this.adaptiveSizer ? this.adaptiveSizer.getCurrentBatchSize() : this.config.batchSize,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get current processing status
   */
  getStatus() {
    if (!this.isInitialized) {
      return { status: 'not_initialized' };
    }

    const progressInfo = this.progressState ? this.progressState.getRecoveryInfo() : null;
    const rowTrackingInfo = this.rowTracker ? this.rowTracker.getRecoveryInfo() : null;
    const validation = this.rowTracker ? this.rowTracker.validateConsistency() : null;

    return {
      status: 'initialized',
      operationId: this.operationId,
      progress: progressInfo,
      rowTracking: rowTrackingInfo,
      validation,
      config: this.config
    };
  }

  /**
   * Validate current state consistency
   */
  async validateState() {
    const errors = [];
    const warnings = [];

    // Validate progress state
    if (this.progressState) {
      const progressValidation = await this.progressState.validateState();
      errors.push(...progressValidation.errors);
      warnings.push(...progressValidation.warnings);
    }

    // Validate row tracking
    if (this.rowTracker) {
      const rowValidation = this.rowTracker.validateConsistency();
      errors.push(...rowValidation.errors);
      warnings.push(...rowValidation.warnings);
    }

    // Cross-validate progress state and row tracking
    if (this.progressState && this.rowTracker) {
      const progressInfo = this.progressState.getRecoveryInfo();
      const rowInfo = this.rowTracker.getRecoveryInfo();

      if (progressInfo && rowInfo) {
        if (progressInfo.processedRecords > 0 && rowInfo.lastCompletedRow <= this.config.startRow) {
          warnings.push('Progress state indicates processed records but row tracker shows no completed rows');
        }
      }
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings,
      components: {
        progressState: this.progressState ? 'enabled' : 'disabled',
        rowTracking: this.rowTracker ? 'enabled' : 'disabled'
      }
    };
  }

  /**
   * Reset processor for new operation
   */
  async reset() {
    if (this.progressState) {
      await this.progressState.reset();
    }

    if (this.rowTracker) {
      this.rowTracker.reset();
    }

    this.operationId = null;
    this.isInitialized = false;

    logger.info('Batch processor reset');
  }
}

module.exports = { EnhancedBatchProcessor };