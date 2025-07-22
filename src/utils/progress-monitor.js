const { logger } = require('./logger');
const { ProgressState } = require('./progress-state');
const { ProgressDashboard } = require('./progress-dashboard');
const os = require('os');

/**
 * ProgressMonitor - Comprehensive progress monitoring and reporting system
 * 
 * Provides detailed progress tracking, ETA calculations, structured logging,
 * real-time status updates, and stalled operation detection.
 */
class ProgressMonitor {
  constructor(options = {}) {
    this.config = {
      operationId: options.operationId || `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      operationType: options.operationType || 'sync',
      displayDashboard: options.displayDashboard !== false,
      stalledThresholdMs: options.stalledThresholdMs || 5 * 60 * 1000, // 5 minutes
      progressUpdateIntervalMs: options.progressUpdateIntervalMs || 3000, // 3 seconds
      logLevel: options.logLevel || 'info',
      stateDir: options.stateDir,
      detailedMetrics: options.detailedMetrics !== false,
      alertOnStalled: options.alertOnStalled !== false
    };

    // Initialize components
    this.progressState = new ProgressState({
      stateDir: this.config.stateDir,
      autoSave: true,
      backupEnabled: true
    });

    this.dashboard = new ProgressDashboard();
    
    // Metrics tracking
    this.metrics = {
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      lastProgressUpdate: Date.now(),
      batchTimes: [],
      networkLatencies: [],
      processingRates: [],
      memoryUsage: [],
      errorCounts: { total: 0, byCategory: {} },
      warningCounts: { total: 0, byCategory: {} },
      lastBatchDuration: 0,
      totalPauseDuration: 0,
      pauseStartTime: null
    };

    // Status tracking
    this.status = {
      isRunning: false,
      isPaused: false,
      isStalled: false,
      currentPhase: 'initializing',
      currentOperation: 'Starting up...',
      lastActivity: Date.now(),
      stalledCheckInterval: null,
      progressUpdateInterval: null
    };

    // Operation context
    this.context = {
      operationId: this.config.operationId,
      operationType: this.config.operationType,
      startTime: new Date().toISOString(),
      totalRecords: 0,
      totalBatches: 0,
      batchSize: 0,
      environment: this.getEnvironmentInfo()
    };

    logger.info('Progress monitor initialized', {
      operationId: this.config.operationId,
      operationType: this.config.operationType,
      config: this.config
    });
  }

  /**
   * Start monitoring an operation
   */
  async start(initialData = {}) {
    if (this.status.isRunning) {
      logger.warn('Progress monitor already running', {
        operationId: this.config.operationId
      });
      return;
    }

    try {
      // Initialize state
      await this.progressState.initialize(this.config.operationId, initialData);
      
      // Update context with initial data
      this.context.totalRecords = initialData.totalRecords || 0;
      this.context.totalBatches = initialData.totalBatches || 0;
      this.context.batchSize = initialData.batchSize || 0;
      
      // Reset metrics
      this.resetMetrics();
      
      // Update status
      this.status.isRunning = true;
      this.status.isPaused = false;
      this.status.isStalled = false;
      this.status.currentPhase = 'processing';
      this.status.currentOperation = 'Processing data...';
      this.status.lastActivity = Date.now();
      
      // Start dashboard if enabled
      if (this.config.displayDashboard) {
        this.dashboard.startDisplay(this.config.progressUpdateIntervalMs);
        this.updateDashboard();
      }
      
      // Start stalled operation detection
      this.startStalledDetection();
      
      // Start progress updates
      this.startProgressUpdates();
      
      // Log start event
      this.logOperationStart();
      
      return this.progressState.getCurrentState();
    } catch (error) {
      logger.error('Failed to start progress monitor', {
        operationId: this.config.operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update progress after batch processing
   */
  async updateProgress(batchIndex, batchData = {}) {
    if (!this.status.isRunning) {
      logger.warn('Cannot update progress - monitor not running', {
        operationId: this.config.operationId
      });
      return null;
    }

    try {
      // Record activity
      this.status.lastActivity = Date.now();
      
      // Calculate metrics for this batch
      const batchStartTime = batchData.startTime || this.metrics.lastUpdateTime;
      const batchEndTime = batchData.endTime || Date.now();
      const batchDuration = batchEndTime - batchStartTime;
      
      // Update metrics
      this.metrics.lastUpdateTime = Date.now();
      this.metrics.lastBatchDuration = batchDuration;
      this.metrics.batchTimes.push({
        batchIndex,
        duration: batchDuration,
        recordCount: batchData.recordsProcessed || 0,
        timestamp: Date.now()
      });
      
      // Keep only last 20 batch times for moving averages
      if (this.metrics.batchTimes.length > 20) {
        this.metrics.batchTimes = this.metrics.batchTimes.slice(-20);
      }
      
      // Update network latency if provided
      if (batchData.networkLatency) {
        this.metrics.networkLatencies.push({
          batchIndex,
          latency: batchData.networkLatency,
          timestamp: Date.now()
        });
        
        // Keep only last 20 latency measurements
        if (this.metrics.networkLatencies.length > 20) {
          this.metrics.networkLatencies = this.metrics.networkLatencies.slice(-20);
        }
      }
      
      // Calculate processing rate for this batch
      if (batchData.recordsProcessed && batchDuration > 0) {
        const recordsPerSecond = (batchData.recordsProcessed / batchDuration) * 1000;
        this.metrics.processingRates.push({
          batchIndex,
          rate: recordsPerSecond,
          timestamp: Date.now()
        });
        
        // Keep only last 20 processing rates
        if (this.metrics.processingRates.length > 20) {
          this.metrics.processingRates = this.metrics.processingRates.slice(-20);
        }
      }
      
      // Update memory usage
      this.updateMemoryUsage();
      
      // Update progress state
      const updatedState = await this.progressState.updateProgress(batchIndex, batchData);
      
      // Update dashboard
      this.updateDashboard();
      
      // Log progress update
      this.logProgressUpdate(batchIndex, batchData, updatedState);
      
      return updatedState;
    } catch (error) {
      logger.error('Failed to update progress', {
        operationId: this.config.operationId,
        batchIndex,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Record a failed batch
   */
  async recordFailure(batchIndex, error, retryCount = 0) {
    if (!this.status.isRunning) {
      logger.warn('Cannot record failure - monitor not running', {
        operationId: this.config.operationId
      });
      return null;
    }

    try {
      // Record activity
      this.status.lastActivity = Date.now();
      
      // Update error metrics
      this.metrics.errorCounts.total++;
      
      const errorCategory = error.category || 'unknown';
      if (!this.metrics.errorCounts.byCategory[errorCategory]) {
        this.metrics.errorCounts.byCategory[errorCategory] = 0;
      }
      this.metrics.errorCounts.byCategory[errorCategory]++;
      
      // Update progress state
      const failedBatch = await this.progressState.recordFailedBatch(batchIndex, error, retryCount);
      
      // Update dashboard
      this.dashboard.addError({
        message: error.message,
        type: error.category || 'error'
      });
      this.updateDashboard();
      
      // Log failure
      this.logBatchFailure(batchIndex, error, retryCount, failedBatch);
      
      return failedBatch;
    } catch (error) {
      logger.error('Failed to record batch failure', {
        operationId: this.config.operationId,
        batchIndex,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Record a warning
   */
  recordWarning(warning) {
    if (!this.status.isRunning) return;

    try {
      // Update warning metrics
      this.metrics.warningCounts.total++;
      
      const warningCategory = warning.category || 'unknown';
      if (!this.metrics.warningCounts.byCategory[warningCategory]) {
        this.metrics.warningCounts.byCategory[warningCategory] = 0;
      }
      this.metrics.warningCounts.byCategory[warningCategory]++;
      
      // Update dashboard
      this.dashboard.addWarning({
        message: warning.message || warning,
        type: warning.category || 'warning'
      });
      
      // Log warning
      logger.warn(warning.message || warning, {
        operationId: this.config.operationId,
        warningCategory,
        context: warning.context || {}
      });
    } catch (error) {
      logger.error('Failed to record warning', {
        operationId: this.config.operationId,
        error: error.message
      });
    }
  }

  /**
   * Update operation phase and current operation description
   */
  updatePhase(phase, operation = null) {
    if (!this.status.isRunning) return;

    this.status.currentPhase = phase;
    if (operation) {
      this.status.currentOperation = operation;
    }
    
    // Record activity
    this.status.lastActivity = Date.now();
    
    // Update dashboard
    this.dashboard.updateProgress({
      phase: this.status.currentPhase,
      currentOperation: this.status.currentOperation
    });
    
    // Log phase change
    logger.info('Operation phase changed', {
      operationId: this.config.operationId,
      phase: this.status.currentPhase,
      operation: this.status.currentOperation
    });
  }

  /**
   * Pause monitoring
   */
  pause(reason = 'User requested pause') {
    if (!this.status.isRunning || this.status.isPaused) return;

    this.status.isPaused = true;
    this.metrics.pauseStartTime = Date.now();
    this.updatePhase('paused', `Paused: ${reason}`);
    
    logger.info('Operation paused', {
      operationId: this.config.operationId,
      reason,
      pauseTime: new Date().toISOString()
    });
  }

  /**
   * Resume monitoring
   */
  resume() {
    if (!this.status.isRunning || !this.status.isPaused) return;

    const pauseDuration = Date.now() - this.metrics.pauseStartTime;
    this.metrics.totalPauseDuration += pauseDuration;
    this.status.isPaused = false;
    this.updatePhase('processing', 'Resuming operation...');
    
    logger.info('Operation resumed', {
      operationId: this.config.operationId,
      pauseDuration,
      totalPauseDuration: this.metrics.totalPauseDuration,
      resumeTime: new Date().toISOString()
    });
  }

  /**
   * Complete the operation and generate summary
   */
  async complete(finalData = {}) {
    if (!this.status.isRunning) {
      logger.warn('Cannot complete - monitor not running', {
        operationId: this.config.operationId
      });
      return null;
    }

    try {
      // Update phase
      this.updatePhase('completed', 'Operation completed successfully');
      
      // Stop intervals
      this.stopIntervals();
      
      // Update status
      this.status.isRunning = false;
      this.status.isPaused = false;
      this.status.isStalled = false;
      
      // Generate summary
      const summary = this.generateSummary(finalData);
      
      // Log completion
      this.logOperationComplete(summary);
      
      // Stop dashboard
      if (this.config.displayDashboard) {
        this.dashboard.stopDisplay();
      }
      
      return summary;
    } catch (error) {
      logger.error('Failed to complete operation', {
        operationId: this.config.operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Fail the operation with error
   */
  async fail(error, finalData = {}) {
    if (!this.status.isRunning) {
      logger.warn('Cannot fail - monitor not running', {
        operationId: this.config.operationId
      });
      return null;
    }

    try {
      // Update phase
      this.updatePhase('error', `Operation failed: ${error.message}`);
      
      // Stop intervals
      this.stopIntervals();
      
      // Update status
      this.status.isRunning = false;
      this.status.isPaused = false;
      
      // Generate summary
      const summary = this.generateSummary({
        ...finalData,
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack
        }
      });
      
      // Log failure
      this.logOperationFailed(error, summary);
      
      // Stop dashboard
      if (this.config.displayDashboard) {
        this.dashboard.stopDisplay();
      }
      
      return summary;
    } catch (failError) {
      logger.error('Failed to process operation failure', {
        operationId: this.config.operationId,
        originalError: error.message,
        failError: failError.message
      });
      throw failError;
    }
  }

  /**
   * Get current progress information
   */
  getProgress() {
    const state = this.progressState.getCurrentState();
    if (!state) return null;
    
    const runtime = Date.now() - this.metrics.startTime - this.metrics.totalPauseDuration;
    const progressPercentage = state.totalRecords > 0 
      ? Math.round((state.processedRecords / state.totalRecords) * 100) 
      : 0;
    
    // Calculate average processing rate
    let avgProcessingRate = 0;
    if (this.metrics.processingRates.length > 0) {
      avgProcessingRate = this.metrics.processingRates.reduce((sum, item) => sum + item.rate, 0) / 
        this.metrics.processingRates.length;
    } else if (runtime > 0 && state.processedRecords > 0) {
      avgProcessingRate = (state.processedRecords / runtime) * 1000;
    }
    
    // Calculate ETA
    let estimatedTimeRemaining = 0;
    if (avgProcessingRate > 0) {
      const remainingRecords = state.totalRecords - state.processedRecords;
      estimatedTimeRemaining = Math.round((remainingRecords / avgProcessingRate) * 1000);
    }
    
    // Calculate average batch time
    let avgBatchTime = 0;
    if (this.metrics.batchTimes.length > 0) {
      avgBatchTime = this.metrics.batchTimes.reduce((sum, item) => sum + item.duration, 0) / 
        this.metrics.batchTimes.length;
    }
    
    // Calculate average network latency
    let avgNetworkLatency = 0;
    if (this.metrics.networkLatencies.length > 0) {
      avgNetworkLatency = this.metrics.networkLatencies.reduce((sum, item) => sum + item.latency, 0) / 
        this.metrics.networkLatencies.length;
    }
    
    return {
      operationId: this.config.operationId,
      status: this.status.isPaused ? 'paused' : (this.status.isStalled ? 'stalled' : this.status.currentPhase),
      currentOperation: this.status.currentOperation,
      progress: {
        percentage: progressPercentage,
        processedRecords: state.processedRecords,
        totalRecords: state.totalRecords,
        currentBatch: state.currentBatch,
        totalBatches: state.totalBatches,
        completedBatches: state.completedBatches.length,
        failedBatches: state.failedBatches.length
      },
      timing: {
        startTime: new Date(this.metrics.startTime).toISOString(),
        runtime: this.formatDuration(runtime),
        runtimeMs: runtime,
        estimatedTimeRemaining: this.formatDuration(estimatedTimeRemaining),
        estimatedTimeRemainingMs: estimatedTimeRemaining,
        estimatedCompletionTime: new Date(Date.now() + estimatedTimeRemaining).toISOString(),
        avgBatchTimeMs: Math.round(avgBatchTime),
        lastBatchTimeMs: this.metrics.lastBatchDuration,
        totalPauseDurationMs: this.metrics.totalPauseDuration
      },
      performance: {
        recordsPerSecond: Math.round(avgProcessingRate * 10) / 10,
        avgNetworkLatencyMs: Math.round(avgNetworkLatency),
        memoryUsageMB: Math.round(this.getCurrentMemoryUsage() / 1024 / 1024),
        errorRate: this.calculateErrorRate()
      },
      errors: {
        total: this.metrics.errorCounts.total,
        byCategory: this.metrics.errorCounts.byCategory
      },
      warnings: {
        total: this.metrics.warningCounts.total,
        byCategory: this.metrics.warningCounts.byCategory
      }
    };
  }

  /**
   * Generate detailed operation summary
   */
  generateSummary(additionalData = {}) {
    const state = this.progressState.getCurrentState();
    if (!state) return null;
    
    const progress = this.getProgress();
    const endTime = Date.now();
    const totalRuntime = endTime - this.metrics.startTime;
    const activeRuntime = totalRuntime - this.metrics.totalPauseDuration;
    
    // Calculate success rate
    const successRate = state.totalBatches > 0 
      ? Math.round((state.completedBatches.length / state.totalBatches) * 100) 
      : 0;
    
    // Calculate throughput
    const throughput = activeRuntime > 0 
      ? Math.round((state.processedRecords / activeRuntime) * 1000 * 60) // records per minute
      : 0;
    
    // Get peak memory usage
    const peakMemory = this.metrics.memoryUsage.length > 0
      ? Math.max(...this.metrics.memoryUsage.map(m => m.value))
      : 0;
    
    // Generate recommendations based on metrics
    const recommendations = this.generateRecommendations(progress, state);
    
    return {
      operation: {
        id: this.config.operationId,
        type: this.config.operationType,
        startTime: new Date(this.metrics.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        status: progress.status,
        result: this.status.currentPhase === 'completed' ? 'success' : 'failed'
      },
      progress: {
        processedRecords: state.processedRecords,
        totalRecords: state.totalRecords,
        completionPercentage: progress.progress.percentage,
        completedBatches: state.completedBatches.length,
        totalBatches: state.totalBatches,
        failedBatches: state.failedBatches.length,
        successRate: `${successRate}%`
      },
      performance: {
        totalRuntimeMs: totalRuntime,
        totalRuntime: this.formatDuration(totalRuntime),
        activeRuntimeMs: activeRuntime,
        activeRuntime: this.formatDuration(activeRuntime),
        pauseDurationMs: this.metrics.totalPauseDuration,
        pauseDuration: this.formatDuration(this.metrics.totalPauseDuration),
        recordsPerSecond: progress.performance.recordsPerSecond,
        recordsPerMinute: throughput,
        avgBatchTimeMs: progress.timing.avgBatchTimeMs,
        avgNetworkLatencyMs: progress.performance.avgNetworkLatencyMs,
        memoryUsageMB: progress.performance.memoryUsageMB,
        peakMemoryUsageMB: Math.round(peakMemory / 1024 / 1024),
        errorRate: progress.performance.errorRate
      },
      errors: {
        total: this.metrics.errorCounts.total,
        byCategory: this.metrics.errorCounts.byCategory,
        details: state.failedBatches.map(batch => ({
          batchIndex: batch.batchIndex,
          retryCount: batch.retryCount,
          lastError: batch.lastError
        }))
      },
      warnings: {
        total: this.metrics.warningCounts.total,
        byCategory: this.metrics.warningCounts.byCategory
      },
      recommendations,
      ...additionalData
    };
  }

  /**
   * Generate recommendations based on metrics
   */
  generateRecommendations(progress, state) {
    const recommendations = [];
    
    // Check for high error rate
    if (progress.performance.errorRate > 10) {
      recommendations.push({
        type: 'error_rate',
        severity: 'high',
        message: `High error rate detected (${progress.performance.errorRate}%). Consider investigating network connectivity or API rate limits.`,
        action: 'Investigate error patterns and consider implementing longer delays between batches.'
      });
    }
    
    // Check for slow processing
    if (progress.performance.recordsPerSecond < 1 && state.processedRecords > 100) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: 'Slow processing rate detected. Consider optimizing batch size or reducing concurrent operations.',
        action: 'Review batch size configuration and network conditions.'
      });
    }
    
    // Check for high memory usage
    if (progress.performance.memoryUsageMB > 500) {
      recommendations.push({
        type: 'resource',
        severity: 'medium',
        message: `High memory usage detected (${progress.performance.memoryUsageMB}MB). Consider implementing memory optimization strategies.`,
        action: 'Review memory usage patterns and implement garbage collection hints.'
      });
    }
    
    // Check for network latency
    if (progress.performance.avgNetworkLatencyMs > 1000) {
      recommendations.push({
        type: 'network',
        severity: 'medium',
        message: `High network latency detected (${progress.performance.avgNetworkLatencyMs}ms). This may impact overall performance.`,
        action: 'Consider running the operation during off-peak hours or from a location closer to the API servers.'
      });
    }
    
    // Check for failed batches
    if (state.failedBatches.length > 0) {
      const failedPercentage = Math.round((state.failedBatches.length / state.totalBatches) * 100);
      
      if (failedPercentage > 20) {
        recommendations.push({
          type: 'reliability',
          severity: 'high',
          message: `High failure rate detected (${failedPercentage}% of batches). Review error patterns and consider adjusting retry strategies.`,
          action: 'Analyze error logs for patterns and implement targeted fixes for common failure modes.'
        });
      }
    }
    
    return recommendations;
  }

  /**
   * Start stalled operation detection
   */
  startStalledDetection() {
    if (this.status.stalledCheckInterval) {
      clearInterval(this.status.stalledCheckInterval);
    }
    
    this.status.stalledCheckInterval = setInterval(() => {
      this.checkForStalledOperation();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Start periodic progress updates
   */
  startProgressUpdates() {
    if (this.status.progressUpdateInterval) {
      clearInterval(this.status.progressUpdateInterval);
    }
    
    this.status.progressUpdateInterval = setInterval(() => {
      this.metrics.lastProgressUpdate = Date.now();
      this.updateDashboard();
      this.updateMemoryUsage();
    }, this.config.progressUpdateIntervalMs);
  }

  /**
   * Stop all intervals
   */
  stopIntervals() {
    if (this.status.stalledCheckInterval) {
      clearInterval(this.status.stalledCheckInterval);
      this.status.stalledCheckInterval = null;
    }
    
    if (this.status.progressUpdateInterval) {
      clearInterval(this.status.progressUpdateInterval);
      this.status.progressUpdateInterval = null;
    }
  }

  /**
   * Check for stalled operation
   */
  checkForStalledOperation() {
    if (!this.status.isRunning || this.status.isPaused) return;
    
    const timeSinceLastActivity = Date.now() - this.status.lastActivity;
    
    if (timeSinceLastActivity > this.config.stalledThresholdMs) {
      if (!this.status.isStalled) {
        this.status.isStalled = true;
        
        const stalledDuration = this.formatDuration(timeSinceLastActivity);
        const message = `Operation appears stalled. No activity for ${stalledDuration}`;
        
        this.updatePhase('stalled', message);
        
        // Add warning to dashboard
        this.dashboard.addWarning({
          message,
          type: 'stalled'
        });
        
        // Log stalled operation
        logger.warn('Operation appears stalled', {
          operationId: this.config.operationId,
          timeSinceLastActivityMs: timeSinceLastActivity,
          stalledDuration,
          lastPhase: this.status.currentPhase,
          lastOperation: this.status.currentOperation
        });
        
        // Alert if configured
        if (this.config.alertOnStalled) {
          this.alertStalledOperation(timeSinceLastActivity);
        }
      }
    } else if (this.status.isStalled) {
      // Operation was stalled but has resumed activity
      this.status.isStalled = false;
      
      const message = 'Operation resumed after being stalled';
      this.updatePhase('processing', message);
      
      logger.info('Operation resumed after being stalled', {
        operationId: this.config.operationId,
        stalledDurationMs: timeSinceLastActivity,
        stalledDuration: this.formatDuration(timeSinceLastActivity)
      });
    }
  }

  /**
   * Alert about stalled operation
   */
  alertStalledOperation(stalledTimeMs) {
    // This could be extended to send alerts via email, Slack, etc.
    logger.error('ALERT: Operation stalled', {
      operationId: this.config.operationId,
      stalledDurationMs: stalledTimeMs,
      stalledDuration: this.formatDuration(stalledTimeMs),
      lastPhase: this.status.currentPhase,
      lastOperation: this.status.currentOperation,
      state: this.progressState.getCurrentState(),
      systemInfo: this.getSystemInfo()
    });
  }

  /**
   * Update dashboard with current progress
   */
  updateDashboard() {
    if (!this.config.displayDashboard) return;
    
    const state = this.progressState.getCurrentState();
    if (!state) return;
    
    const progress = this.getProgress();
    
    // Update dashboard progress
    this.dashboard.updateProgress({
      totalRecords: state.totalRecords,
      processedRecords: state.processedRecords,
      currentBatch: state.currentBatch,
      totalBatches: state.totalBatches,
      phase: this.status.currentPhase,
      currentOperation: this.status.currentOperation
    });
    
    // Update dashboard performance
    this.dashboard.updatePerformance({
      recordsPerSecond: progress.performance.recordsPerSecond,
      averageBatchTime: progress.timing.avgBatchTimeMs,
      networkLatency: progress.performance.avgNetworkLatencyMs,
      errorRate: progress.performance.errorRate
    });
    
    // Update dashboard system info
    this.dashboard.updateSystem({
      memoryUsage: progress.performance.memoryUsageMB * 1024 * 1024,
      memoryPeak: Math.max(...this.metrics.memoryUsage.map(m => m.value)),
      cpuUsage: 0, // Not implemented yet
      healthStatus: this.status.isStalled ? 'warning' : (this.metrics.errorCounts.total > 0 ? 'warning' : 'healthy')
    });
  }

  /**
   * Update memory usage tracking
   */
  updateMemoryUsage() {
    const memUsage = this.getCurrentMemoryUsage();
    
    this.metrics.memoryUsage.push({
      timestamp: Date.now(),
      value: memUsage
    });
    
    // Keep only last 60 measurements
    if (this.metrics.memoryUsage.length > 60) {
      this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-60);
    }
  }

  /**
   * Get current memory usage
   */
  getCurrentMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    return memoryUsage.heapUsed;
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    const state = this.progressState.getCurrentState();
    if (!state || state.totalBatches === 0) return 0;
    
    return Math.round((this.metrics.errorCounts.total / state.totalBatches) * 100 * 10) / 10;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      lastProgressUpdate: Date.now(),
      batchTimes: [],
      networkLatencies: [],
      processingRates: [],
      memoryUsage: [],
      errorCounts: { total: 0, byCategory: {} },
      warningCounts: { total: 0, byCategory: {} },
      lastBatchDuration: 0,
      totalPauseDuration: 0,
      pauseStartTime: null
    };
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  /**
   * Get environment information
   */
  getEnvironmentInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length
    };
  }

  /**
   * Get detailed system information
   */
  getSystemInfo() {
    return {
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        usage: process.memoryUsage()
      },
      cpu: {
        count: os.cpus().length,
        model: os.cpus()[0].model,
        loadAvg: os.loadavg()
      },
      uptime: os.uptime(),
      processUptime: process.uptime(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version
    };
  }

  /**
   * Log operation start
   */
  logOperationStart() {
    const state = this.progressState.getCurrentState();
    
    logger.info('🚀 Operation started', {
      operationId: this.config.operationId,
      operationType: this.config.operationType,
      totalRecords: state.totalRecords,
      totalBatches: state.totalBatches,
      batchSize: state.configuration.batchSize,
      estimatedDuration: state.totalRecords > 0 && state.configuration.batchSize > 0
        ? this.formatDuration(state.totalRecords * 200) // Rough estimate: 200ms per record
        : 'unknown',
      startTime: new Date().toISOString(),
      environment: this.context.environment
    });
  }

  /**
   * Log progress update
   */
  logProgressUpdate(batchIndex, batchData, state) {
    const progress = this.getProgress();
    
    // Log at appropriate level based on configuration
    const logMethod = this.config.logLevel === 'debug' ? 'debug' : 'info';
    
    logger[logMethod]('📊 Progress update', {
      operationId: this.config.operationId,
      batchIndex,
      recordsProcessed: batchData.recordsProcessed,
      totalProcessed: state.processedRecords,
      totalRecords: state.totalRecords,
      progressPercentage: progress.progress.percentage,
      estimatedTimeRemaining: progress.timing.estimatedTimeRemaining,
      recordsPerSecond: progress.performance.recordsPerSecond,
      batchDuration: this.formatDuration(this.metrics.lastBatchDuration),
      rowPosition: batchData.rowPosition
    });
  }

  /**
   * Log batch failure
   */
  logBatchFailure(batchIndex, error, retryCount, failedBatch) {
    logger.error('❌ Batch processing failed', {
      operationId: this.config.operationId,
      batchIndex,
      retryCount,
      error: {
        message: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack
      },
      retryHistory: failedBatch.errorHistory,
      totalFailedBatches: this.progressState.getCurrentState().failedBatches.length
    });
  }

  /**
   * Log operation complete
   */
  logOperationComplete(summary) {
    logger.info('✅ Operation completed successfully', {
      operationId: this.config.operationId,
      duration: summary.performance.totalRuntime,
      processedRecords: summary.progress.processedRecords,
      totalRecords: summary.progress.totalRecords,
      completionPercentage: summary.progress.completionPercentage,
      recordsPerSecond: summary.performance.recordsPerSecond,
      errorCount: summary.errors.total,
      summary
    });
  }

  /**
   * Log operation failed
   */
  logOperationFailed(error, summary) {
    logger.error('❌ Operation failed', {
      operationId: this.config.operationId,
      duration: summary.performance.totalRuntime,
      processedRecords: summary.progress.processedRecords,
      totalRecords: summary.progress.totalRecords,
      completionPercentage: summary.progress.completionPercentage,
      error: {
        message: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack
      },
      summary
    });
  }
}

module.exports = { ProgressMonitor };