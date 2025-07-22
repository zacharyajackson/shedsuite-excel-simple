/**
 * Progress dashboard utility for operational monitoring
 */
const { logger } = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class ProgressDashboard {
  constructor() {
    this.operations = {};
    this.config = {
      persistPath: process.env.DASHBOARD_PERSIST_PATH || path.join(process.cwd(), 'logs', 'dashboard-data.json'),
      persistInterval: parseInt(process.env.DASHBOARD_PERSIST_INTERVAL) || 60000, // 1 minute
      maxOperations: parseInt(process.env.DASHBOARD_MAX_OPERATIONS) || 100,
      detailedLogging: process.env.DASHBOARD_DETAILED_LOGGING === 'true'
    };
    
    // Setup persistence timer
    if (this.config.persistInterval > 0) {
      this.persistTimer = setInterval(() => {
        this.persistData().catch(err => {
          logger.error('Failed to persist dashboard data:', err);
        });
      }, this.config.persistInterval);
    }
    
    // Load persisted data on startup
    this.loadData().catch(err => {
      logger.warn('Failed to load dashboard data, starting with empty state:', err);
    });
  }

  /**
   * Register a new operation for tracking
   * @param {string} operationType Type of operation
   * @param {Object} metadata Operation metadata
   * @returns {string} Operation ID
   */
  registerOperation(operationType, metadata = {}) {
    const operationId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    this.operations[operationId] = {
      id: operationId,
      type: operationType,
      startTime,
      status: 'in_progress',
      progress: 0,
      metadata,
      steps: [],
      logs: [],
      metrics: {
        totalItems: metadata.totalItems || 0,
        processedItems: 0,
        successfulItems: 0,
        failedItems: 0,
        startTime,
        lastUpdateTime: startTime,
        estimatedTimeRemaining: null,
        estimatedCompletionTime: null,
        averageItemProcessingTime: null
      }
    };
    
    if (this.config.detailedLogging) {
      logger.info(`Operation registered: ${operationType}`, {
        operationId,
        metadata
      });
    }
    
    // Clean up old operations if we have too many
    this.cleanupOldOperations();
    
    return operationId;
  }

  /**
   * Update operation progress
   * @param {string} operationId Operation ID
   * @param {number} progress Progress percentage (0-100)
   * @param {Object} metrics Additional metrics
   */
  updateProgress(operationId, progress, metrics = {}) {
    const operation = this.operations[operationId];
    if (!operation) {
      logger.warn(`Attempted to update non-existent operation: ${operationId}`);
      return;
    }
    
    const now = Date.now();
    const previousProgress = operation.progress;
    
    // Update progress
    operation.progress = Math.min(100, Math.max(0, progress));
    operation.metrics.lastUpdateTime = now;
    
    // Update metrics
    if (metrics.processedItems !== undefined) {
      operation.metrics.processedItems = metrics.processedItems;
    }
    
    if (metrics.successfulItems !== undefined) {
      operation.metrics.successfulItems = metrics.successfulItems;
    }
    
    if (metrics.failedItems !== undefined) {
      operation.metrics.failedItems = metrics.failedItems;
    }
    
    if (metrics.totalItems !== undefined && metrics.totalItems > 0) {
      operation.metrics.totalItems = metrics.totalItems;
    }
    
    // Calculate estimated time remaining
    if (operation.progress > 0 && operation.progress < 100) {
      const elapsedTime = now - operation.startTime;
      const estimatedTotalTime = elapsedTime / (operation.progress / 100);
      const estimatedTimeRemaining = estimatedTotalTime - elapsedTime;
      
      operation.metrics.estimatedTimeRemaining = estimatedTimeRemaining;
      operation.metrics.estimatedCompletionTime = now + estimatedTimeRemaining;
      
      // Calculate average item processing time if we have processed items
      if (operation.metrics.processedItems > 0) {
        operation.metrics.averageItemProcessingTime = elapsedTime / operation.metrics.processedItems;
      }
    }
    
    // Log progress update if significant change
    if (this.config.detailedLogging || 
        Math.abs(operation.progress - previousProgress) >= 5 || 
        operation.progress === 100) {
      logger.info(`Operation progress: ${operation.progress.toFixed(1)}%`, {
        operationId,
        type: operation.type,
        progress: operation.progress.toFixed(1),
        processedItems: operation.metrics.processedItems,
        totalItems: operation.metrics.totalItems,
        estimatedTimeRemaining: operation.metrics.estimatedTimeRemaining 
          ? `${Math.round(operation.metrics.estimatedTimeRemaining / 1000)}s` 
          : 'unknown'
      });
    }
  }

  /**
   * Add a step to an operation
   * @param {string} operationId Operation ID
   * @param {string} stepName Step name
   * @param {string} status Step status
   * @param {Object} details Step details
   */
  addStep(operationId, stepName, status = 'in_progress', details = {}) {
    const operation = this.operations[operationId];
    if (!operation) {
      logger.warn(`Attempted to add step to non-existent operation: ${operationId}`);
      return;
    }
    
    const step = {
      name: stepName,
      status,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      details
    };
    
    operation.steps.push(step);
    
    if (this.config.detailedLogging) {
      logger.info(`Operation step started: ${stepName}`, {
        operationId,
        status,
        details
      });
    }
    
    return operation.steps.length - 1; // Return step index
  }

  /**
   * Update a step status
   * @param {string} operationId Operation ID
   * @param {number} stepIndex Step index
   * @param {string} status Step status
   * @param {Object} details Step details
   */
  updateStep(operationId, stepIndex, status, details = {}) {
    const operation = this.operations[operationId];
    if (!operation || !operation.steps[stepIndex]) {
      logger.warn(`Attempted to update non-existent step: ${operationId}:${stepIndex}`);
      return;
    }
    
    const step = operation.steps[stepIndex];
    step.status = status;
    step.details = { ...step.details, ...details };
    
    if (status === 'completed' || status === 'failed') {
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
    }
    
    if (this.config.detailedLogging) {
      logger.info(`Operation step ${status}: ${step.name}`, {
        operationId,
        stepIndex,
        duration: step.duration ? `${step.duration}ms` : undefined,
        details
      });
    }
  }

  /**
   * Add a log entry to an operation
   * @param {string} operationId Operation ID
   * @param {string} level Log level
   * @param {string} message Log message
   * @param {Object} data Additional log data
   */
  addLog(operationId, level, message, data = {}) {
    const operation = this.operations[operationId];
    if (!operation) {
      logger.warn(`Attempted to add log to non-existent operation: ${operationId}`);
      return;
    }
    
    const logEntry = {
      timestamp: Date.now(),
      level,
      message,
      data
    };
    
    operation.logs.push(logEntry);
    
    // Trim logs if too many
    if (operation.logs.length > 100) {
      operation.logs = operation.logs.slice(-100);
    }
    
    // Also log to system logger
    logger[level](`[Operation ${operationId}] ${message}`, data);
  }

  /**
   * Complete an operation
   * @param {string} operationId Operation ID
   * @param {string} status Final status
   * @param {Object} result Operation result
   */
  completeOperation(operationId, status = 'completed', result = {}) {
    const operation = this.operations[operationId];
    if (!operation) {
      logger.warn(`Attempted to complete non-existent operation: ${operationId}`);
      return;
    }
    
    const endTime = Date.now();
    const duration = endTime - operation.startTime;
    
    operation.status = status;
    operation.endTime = endTime;
    operation.duration = duration;
    operation.result = result;
    
    // Set progress to 100% if completed successfully
    if (status === 'completed') {
      operation.progress = 100;
    }
    
    // Log completion
    logger.info(`Operation ${status}: ${operation.type}`, {
      operationId,
      duration: `${duration}ms`,
      processedItems: operation.metrics.processedItems,
      successfulItems: operation.metrics.successfulItems,
      failedItems: operation.metrics.failedItems,
      result
    });
    
    // Persist data after completion
    this.persistData().catch(err => {
      logger.error('Failed to persist dashboard data after operation completion:', err);
    });
  }

  /**
   * Get operation details
   * @param {string} operationId Operation ID
   * @returns {Object} Operation details
   */
  getOperation(operationId) {
    return this.operations[operationId];
  }

  /**
   * Get all operations
   * @param {Object} filters Filters to apply
   * @returns {Array} Filtered operations
   */
  getOperations(filters = {}) {
    let operations = Object.values(this.operations);
    
    // Apply filters
    if (filters.status) {
      operations = operations.filter(op => op.status === filters.status);
    }
    
    if (filters.type) {
      operations = operations.filter(op => op.type === filters.type);
    }
    
    if (filters.since) {
      const sinceTime = new Date(filters.since).getTime();
      operations = operations.filter(op => op.startTime >= sinceTime);
    }
    
    // Sort by start time (newest first)
    operations.sort((a, b) => b.startTime - a.startTime);
    
    // Apply limit
    if (filters.limit) {
      operations = operations.slice(0, filters.limit);
    }
    
    return operations;
  }

  /**
   * Get dashboard summary
   * @returns {Object} Dashboard summary
   */
  getDashboardSummary() {
    const operations = Object.values(this.operations);
    const activeOperations = operations.filter(op => op.status === 'in_progress');
    const completedOperations = operations.filter(op => op.status === 'completed');
    const failedOperations = operations.filter(op => op.status === 'failed');
    
    // Calculate success rate
    const totalCompleted = completedOperations.length + failedOperations.length;
    const successRate = totalCompleted > 0 
      ? (completedOperations.length / totalCompleted * 100).toFixed(1) 
      : 100;
    
    // Calculate average duration for completed operations
    let averageDuration = 0;
    if (completedOperations.length > 0) {
      const totalDuration = completedOperations.reduce((sum, op) => sum + op.duration, 0);
      averageDuration = totalDuration / completedOperations.length;
    }
    
    return {
      timestamp: Date.now(),
      operations: {
        total: operations.length,
        active: activeOperations.length,
        completed: completedOperations.length,
        failed: failedOperations.length,
        successRate: `${successRate}%`,
        averageDuration: Math.round(averageDuration)
      },
      activeOperations: activeOperations.map(op => ({
        id: op.id,
        type: op.type,
        progress: op.progress,
        startTime: op.startTime,
        elapsedTime: Date.now() - op.startTime,
        estimatedTimeRemaining: op.metrics.estimatedTimeRemaining
      })),
      recentOperations: operations
        .filter(op => op.status !== 'in_progress')
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, 5)
        .map(op => ({
          id: op.id,
          type: op.type,
          status: op.status,
          startTime: op.startTime,
          endTime: op.endTime,
          duration: op.duration,
          processedItems: op.metrics.processedItems
        }))
    };
  }

  /**
   * Clean up old operations to prevent memory bloat
   */
  cleanupOldOperations() {
    const operations = Object.values(this.operations);
    
    if (operations.length <= this.config.maxOperations) {
      return;
    }
    
    // Sort by end time or start time (oldest first)
    operations.sort((a, b) => {
      // Completed operations sorted by end time
      if (a.endTime && b.endTime) {
        return a.endTime - b.endTime;
      }
      
      // In-progress operations are considered newer than completed ones
      if (a.endTime && !b.endTime) {
        return -1;
      }
      
      if (!a.endTime && b.endTime) {
        return 1;
      }
      
      // Both in-progress, sort by start time
      return a.startTime - b.startTime;
    });
    
    // Remove oldest operations to get back to max
    const toRemove = operations.slice(0, operations.length - this.config.maxOperations);
    
    toRemove.forEach(op => {
      delete this.operations[op.id];
    });
    
    if (toRemove.length > 0) {
      logger.debug(`Cleaned up ${toRemove.length} old operations`);
    }
  }

  /**
   * Persist dashboard data to disk
   * @returns {Promise<void>}
   */
  async persistData() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.config.persistPath);
      await fs.mkdir(dir, { recursive: true });
      
      // Filter out in-progress operations for persistence
      const persistData = {
        timestamp: Date.now(),
        operations: Object.values(this.operations)
          .filter(op => op.status !== 'in_progress')
          .sort((a, b) => b.endTime - a.endTime)
          .slice(0, this.config.maxOperations)
      };
      
      await fs.writeFile(
        this.config.persistPath,
        JSON.stringify(persistData, null, 2)
      );
      
      if (this.config.detailedLogging) {
        logger.debug(`Dashboard data persisted to ${this.config.persistPath}`);
      }
    } catch (error) {
      logger.error('Failed to persist dashboard data:', error);
      throw error;
    }
  }

  /**
   * Load dashboard data from disk
   * @returns {Promise<void>}
   */
  async loadData() {
    try {
      const data = await fs.readFile(this.config.persistPath, 'utf8');
      const parsedData = JSON.parse(data);
      
      if (parsedData.operations && Array.isArray(parsedData.operations)) {
        parsedData.operations.forEach(op => {
          if (op.id) {
            this.operations[op.id] = op;
          }
        });
        
        logger.info(`Loaded ${parsedData.operations.length} operations from persisted dashboard data`);
      }
    } catch (error) {
      // File might not exist yet, that's okay
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to load dashboard data:', error);
      }
      throw error;
    }
  }

  /**
   * Get metrics for a specific operation type
   * @param {string} operationType Operation type
   * @returns {Object} Metrics for the operation type
   */
  getOperationTypeMetrics(operationType) {
    const operations = Object.values(this.operations)
      .filter(op => op.type === operationType);
    
    if (operations.length === 0) {
      return {
        type: operationType,
        count: 0
      };
    }
    
    const completed = operations.filter(op => op.status === 'completed');
    const failed = operations.filter(op => op.status === 'failed');
    
    // Calculate average duration for completed operations
    let averageDuration = 0;
    if (completed.length > 0) {
      const totalDuration = completed.reduce((sum, op) => sum + op.duration, 0);
      averageDuration = totalDuration / completed.length;
    }
    
    // Calculate average items processed
    let averageItemsProcessed = 0;
    if (completed.length > 0) {
      const totalItems = completed.reduce((sum, op) => sum + op.metrics.processedItems, 0);
      averageItemsProcessed = totalItems / completed.length;
    }
    
    return {
      type: operationType,
      count: operations.length,
      completed: completed.length,
      failed: failed.length,
      inProgress: operations.length - completed.length - failed.length,
      successRate: completed.length + failed.length > 0 
        ? (completed.length / (completed.length + failed.length) * 100).toFixed(1) 
        : '100',
      averageDuration: Math.round(averageDuration),
      averageItemsProcessed: Math.round(averageItemsProcessed),
      lastOperation: operations
        .sort((a, b) => b.startTime - a.startTime)[0]
    };
  }
}

// Export a singleton instance
const progressDashboard = new ProgressDashboard();

module.exports = progressDashboard;