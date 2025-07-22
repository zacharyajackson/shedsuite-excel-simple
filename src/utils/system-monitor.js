/**
 * System monitoring utility for collecting and exposing system metrics
 */
const os = require('os');
const { EventEmitter } = require('events');
const { logger } = require('./logger');

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      system: {
        startTime: Date.now(),
        lastUpdate: Date.now(),
      },
      memory: {
        history: [],
        current: {},
        peak: {},
      },
      cpu: {
        history: [],
        current: 0,
        peak: 0,
      },
      process: {
        uptime: 0,
        memoryUsage: {},
        cpuUsage: {},
      },
      operations: {
        total: 0,
        successful: 0,
        failed: 0,
        inProgress: 0,
        lastOperation: null,
        averageDuration: 0,
      },
      batches: {
        total: 0,
        successful: 0,
        failed: 0,
        averageSize: 0,
        averageDuration: 0,
        history: [],
      },
      errors: {
        total: 0,
        byType: {},
        byComponent: {},
        recent: [],
      },
      alerts: {
        active: [],
        history: [],
      },
      thresholds: {
        memory: 85, // Percentage
        cpu: 80, // Percentage
        errorRate: 10, // Percentage
        responseTime: 5000, // ms
      }
    };
    
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.alertListeners = [];
  }

  /**
   * Start collecting system metrics
   * @param {Object} options Configuration options
   */
  start(options = {}) {
    if (this.isMonitoring) {
      logger.warn('System monitor is already running');
      return;
    }

    const interval = options.interval || 60000; // Default: collect metrics every minute
    const historySize = options.historySize || 60; // Default: keep 1 hour of history (60 minutes)
    
    this.metrics.system.startTime = Date.now();
    this.metrics.thresholds = { ...this.metrics.thresholds, ...options.thresholds };
    
    // Initialize metrics
    this.collectMetrics();
    
    // Start periodic collection
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      
      // Trim history arrays to maintain historySize
      if (this.metrics.memory.history.length > historySize) {
        this.metrics.memory.history = this.metrics.memory.history.slice(-historySize);
      }
      
      if (this.metrics.cpu.history.length > historySize) {
        this.metrics.cpu.history = this.metrics.cpu.history.slice(-historySize);
      }
      
      if (this.metrics.batches.history.length > historySize) {
        this.metrics.batches.history = this.metrics.batches.history.slice(-historySize);
      }
      
      if (this.metrics.errors.recent.length > 20) {
        this.metrics.errors.recent = this.metrics.errors.recent.slice(-20);
      }
      
      // Check for alert conditions
      this.checkAlertConditions();
      
    }, interval);
    
    this.isMonitoring = true;
    logger.info('System monitoring started', { 
      interval: `${interval / 1000} seconds`,
      historySize
    });
  }

  /**
   * Stop collecting system metrics
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }
    
    clearInterval(this.monitoringInterval);
    this.monitoringInterval = null;
    this.isMonitoring = false;
    logger.info('System monitoring stopped');
  }

  /**
   * Collect current system metrics
   */
  collectMetrics() {
    try {
      const now = Date.now();
      
      // Process metrics
      const processMemory = process.memoryUsage();
      const processCpu = process.cpuUsage();
      
      // System metrics
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryPercentage = (usedMem / totalMem) * 100;
      
      // CPU load (average across all cores)
      const cpuLoad = os.loadavg()[0] / os.cpus().length * 100;
      
      // Update metrics
      this.metrics.system.lastUpdate = now;
      this.metrics.process.uptime = process.uptime();
      this.metrics.process.memoryUsage = processMemory;
      this.metrics.process.cpuUsage = processCpu;
      
      // Current memory metrics
      this.metrics.memory.current = {
        timestamp: now,
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percentage: memoryPercentage.toFixed(2)
      };
      
      // Update peak memory if current is higher
      if (!this.metrics.memory.peak.percentage || 
          parseFloat(this.metrics.memory.current.percentage) > parseFloat(this.metrics.memory.peak.percentage)) {
        this.metrics.memory.peak = { ...this.metrics.memory.current };
      }
      
      // Add to history
      this.metrics.memory.history.push({
        timestamp: now,
        percentage: memoryPercentage.toFixed(2),
        heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024) // MB
      });
      
      // CPU metrics
      this.metrics.cpu.current = cpuLoad.toFixed(2);
      if (cpuLoad > this.metrics.cpu.peak) {
        this.metrics.cpu.peak = cpuLoad.toFixed(2);
      }
      
      this.metrics.cpu.history.push({
        timestamp: now,
        percentage: cpuLoad.toFixed(2)
      });
      
    } catch (error) {
      logger.error('Error collecting system metrics:', error);
    }
  }

  /**
   * Record the start of an operation
   * @param {string} operationType Type of operation
   * @param {Object} metadata Operation metadata
   * @returns {string} Operation ID
   */
  startOperation(operationType, metadata = {}) {
    const operationId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.metrics.operations.inProgress++;
    this.metrics.operations.lastOperation = {
      id: operationId,
      type: operationType,
      startTime: Date.now(),
      metadata
    };
    
    return operationId;
  }

  /**
   * Record the completion of an operation
   * @param {string} operationId Operation ID
   * @param {boolean} success Whether the operation was successful
   * @param {Object} result Operation result
   */
  endOperation(operationId, success = true, result = {}) {
    const now = Date.now();
    
    // Find the operation in progress operations
    if (this.metrics.operations.lastOperation && this.metrics.operations.lastOperation.id === operationId) {
      const operation = this.metrics.operations.lastOperation;
      const duration = now - operation.startTime;
      
      // Update metrics
      this.metrics.operations.total++;
      this.metrics.operations.inProgress = Math.max(0, this.metrics.operations.inProgress - 1);
      
      if (success) {
        this.metrics.operations.successful++;
      } else {
        this.metrics.operations.failed++;
      }
      
      // Update average duration
      if (this.metrics.operations.averageDuration === 0) {
        this.metrics.operations.averageDuration = duration;
      } else {
        this.metrics.operations.averageDuration = 
          (this.metrics.operations.averageDuration * (this.metrics.operations.total - 1) + duration) / 
          this.metrics.operations.total;
      }
      
      // Log completion
      if (success) {
        logger.debug(`Operation ${operationId} completed successfully`, { 
          type: operation.type,
          duration: `${duration}ms`,
          result
        });
      } else {
        logger.warn(`Operation ${operationId} failed`, { 
          type: operation.type,
          duration: `${duration}ms`,
          error: result.error || 'Unknown error'
        });
      }
    }
  }

  /**
   * Record a batch processing operation
   * @param {Object} batchInfo Batch information
   */
  recordBatch(batchInfo) {
    const { batchId, size, duration, success, errorType } = batchInfo;
    
    this.metrics.batches.total++;
    
    if (success) {
      this.metrics.batches.successful++;
    } else {
      this.metrics.batches.failed++;
      
      // Record error
      this.recordError({
        type: errorType || 'batch_processing_error',
        component: 'batch_processor',
        message: `Batch ${batchId} processing failed`,
        details: batchInfo
      });
    }
    
    // Update average batch size
    this.metrics.batches.averageSize = 
      (this.metrics.batches.averageSize * (this.metrics.batches.total - 1) + size) / 
      this.metrics.batches.total;
    
    // Update average duration
    this.metrics.batches.averageDuration = 
      (this.metrics.batches.averageDuration * (this.metrics.batches.total - 1) + duration) / 
      this.metrics.batches.total;
    
    // Add to history
    this.metrics.batches.history.push({
      timestamp: Date.now(),
      batchId,
      size,
      duration,
      success
    });
  }

  /**
   * Record an error
   * @param {Object} error Error information
   */
  recordError(error) {
    const { type, component, message, details } = error;
    const timestamp = Date.now();
    
    // Increment total errors
    this.metrics.errors.total++;
    
    // Increment by type
    if (!this.metrics.errors.byType[type]) {
      this.metrics.errors.byType[type] = 0;
    }
    this.metrics.errors.byType[type]++;
    
    // Increment by component
    if (!this.metrics.errors.byComponent[component]) {
      this.metrics.errors.byComponent[component] = 0;
    }
    this.metrics.errors.byComponent[component]++;
    
    // Add to recent errors
    this.metrics.errors.recent.unshift({
      timestamp,
      type,
      component,
      message,
      details
    });
    
    // Check if this error should trigger an alert
    this.checkErrorAlert(error);
  }

  /**
   * Check if current conditions warrant an alert
   */
  checkAlertConditions() {
    // Check memory usage
    const memoryPercentage = parseFloat(this.metrics.memory.current.percentage);
    if (memoryPercentage > this.metrics.thresholds.memory) {
      this.triggerAlert('high_memory_usage', {
        level: 'warning',
        message: `High memory usage: ${memoryPercentage}%`,
        value: memoryPercentage,
        threshold: this.metrics.thresholds.memory
      });
    }
    
    // Check CPU usage
    const cpuPercentage = parseFloat(this.metrics.cpu.current);
    if (cpuPercentage > this.metrics.thresholds.cpu) {
      this.triggerAlert('high_cpu_usage', {
        level: 'warning',
        message: `High CPU usage: ${cpuPercentage}%`,
        value: cpuPercentage,
        threshold: this.metrics.thresholds.cpu
      });
    }
    
    // Check error rate
    if (this.metrics.operations.total > 0) {
      const errorRate = (this.metrics.operations.failed / this.metrics.operations.total) * 100;
      if (errorRate > this.metrics.thresholds.errorRate) {
        this.triggerAlert('high_error_rate', {
          level: 'error',
          message: `High error rate: ${errorRate.toFixed(2)}%`,
          value: errorRate.toFixed(2),
          threshold: this.metrics.thresholds.errorRate
        });
      }
    }
  }

  /**
   * Check if an error should trigger an alert
   * @param {Object} error Error information
   */
  checkErrorAlert(error) {
    // Critical errors always trigger alerts
    if (error.level === 'critical' || error.type.includes('critical')) {
      this.triggerAlert('critical_error', {
        level: 'critical',
        message: `Critical error in ${error.component}: ${error.message}`,
        error
      });
      return;
    }
    
    // Check for repeated errors of the same type
    const typeCount = this.metrics.errors.byType[error.type] || 0;
    if (typeCount >= 3) {
      this.triggerAlert('repeated_error', {
        level: 'warning',
        message: `Repeated error of type ${error.type} (${typeCount} occurrences)`,
        error,
        count: typeCount
      });
    }
  }

  /**
   * Trigger an alert
   * @param {string} type Alert type
   * @param {Object} alert Alert information
   */
  triggerAlert(type, alert) {
    const alertId = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    
    const fullAlert = {
      id: alertId,
      type,
      timestamp,
      ...alert,
      active: true
    };
    
    // Check if this alert type is already active
    const existingAlertIndex = this.metrics.alerts.active.findIndex(a => a.type === type);
    if (existingAlertIndex >= 0) {
      // Update existing alert
      this.metrics.alerts.active[existingAlertIndex] = {
        ...this.metrics.alerts.active[existingAlertIndex],
        ...fullAlert,
        count: (this.metrics.alerts.active[existingAlertIndex].count || 1) + 1,
        lastUpdated: timestamp
      };
    } else {
      // Add new alert
      this.metrics.alerts.active.push({
        ...fullAlert,
        count: 1
      });
    }
    
    // Add to history
    this.metrics.alerts.history.unshift(fullAlert);
    
    // Trim history
    if (this.metrics.alerts.history.length > 50) {
      this.metrics.alerts.history = this.metrics.alerts.history.slice(0, 50);
    }
    
    // Log alert
    const logLevel = alert.level === 'critical' ? 'error' : 
                    alert.level === 'warning' ? 'warn' : 'info';
    
    logger[logLevel](`ALERT [${alert.level.toUpperCase()}]: ${alert.message}`, {
      alertId,
      type,
      details: alert
    });
    
    // Emit alert event
    this.emit('alert', fullAlert);
    
    // Notify alert listeners
    this.notifyAlertListeners(fullAlert);
  }

  /**
   * Resolve an active alert
   * @param {string} alertId Alert ID
   * @param {Object} resolution Resolution information
   */
  resolveAlert(alertId, resolution = {}) {
    const alertIndex = this.metrics.alerts.active.findIndex(a => a.id === alertId);
    if (alertIndex >= 0) {
      const alert = this.metrics.alerts.active[alertIndex];
      
      // Update history
      const historyIndex = this.metrics.alerts.history.findIndex(a => a.id === alertId);
      if (historyIndex >= 0) {
        this.metrics.alerts.history[historyIndex] = {
          ...this.metrics.alerts.history[historyIndex],
          active: false,
          resolvedAt: Date.now(),
          resolution
        };
      }
      
      // Remove from active alerts
      this.metrics.alerts.active.splice(alertIndex, 1);
      
      // Log resolution
      logger.info(`Alert resolved: ${alert.message}`, {
        alertId,
        resolution
      });
      
      // Emit resolution event
      this.emit('alertResolved', {
        alertId,
        alert,
        resolution
      });
    }
  }

  /**
   * Register an alert listener
   * @param {Function} listener Alert listener function
   */
  addAlertListener(listener) {
    if (typeof listener === 'function') {
      this.alertListeners.push(listener);
    }
  }

  /**
   * Remove an alert listener
   * @param {Function} listener Alert listener function
   */
  removeAlertListener(listener) {
    const index = this.alertListeners.indexOf(listener);
    if (index >= 0) {
      this.alertListeners.splice(index, 1);
    }
  }

  /**
   * Notify all alert listeners
   * @param {Object} alert Alert information
   */
  notifyAlertListeners(alert) {
    this.alertListeners.forEach(listener => {
      try {
        listener(alert);
      } catch (error) {
        logger.error('Error in alert listener:', error);
      }
    });
  }

  /**
   * Get current system health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const memoryPercentage = parseFloat(this.metrics.memory.current.percentage || 0);
    const cpuPercentage = parseFloat(this.metrics.cpu.current || 0);
    const errorRate = this.metrics.operations.total > 0 
      ? (this.metrics.operations.failed / this.metrics.operations.total) * 100 
      : 0;
    
    // Determine overall health status
    let status = 'healthy';
    const issues = [];
    
    if (memoryPercentage > this.metrics.thresholds.memory) {
      status = 'degraded';
      issues.push(`High memory usage: ${memoryPercentage}%`);
    }
    
    if (cpuPercentage > this.metrics.thresholds.cpu) {
      status = 'degraded';
      issues.push(`High CPU usage: ${cpuPercentage}%`);
    }
    
    if (errorRate > this.metrics.thresholds.errorRate) {
      status = 'degraded';
      issues.push(`High error rate: ${errorRate.toFixed(2)}%`);
    }
    
    if (this.metrics.alerts.active.some(alert => alert.level === 'critical')) {
      status = 'critical';
      issues.push('Critical alerts active');
    }
    
    return {
      status,
      timestamp: Date.now(),
      uptime: process.uptime(),
      issues,
      metrics: {
        memory: {
          used: memoryPercentage,
          threshold: this.metrics.thresholds.memory
        },
        cpu: {
          used: cpuPercentage,
          threshold: this.metrics.thresholds.cpu
        },
        errors: {
          rate: errorRate.toFixed(2),
          threshold: this.metrics.thresholds.errorRate,
          total: this.metrics.errors.total
        },
        operations: {
          total: this.metrics.operations.total,
          failed: this.metrics.operations.failed,
          inProgress: this.metrics.operations.inProgress
        },
        alerts: {
          active: this.metrics.alerts.active.length,
          critical: this.metrics.alerts.active.filter(a => a.level === 'critical').length
        }
      }
    };
  }

  /**
   * Get detailed metrics for dashboard/monitoring
   * @returns {Object} Detailed metrics
   */
  getDetailedMetrics() {
    return {
      timestamp: Date.now(),
      system: {
        uptime: process.uptime(),
        startTime: this.metrics.system.startTime,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpuCores: os.cpus().length
      },
      memory: {
        current: this.metrics.memory.current,
        peak: this.metrics.memory.peak,
        history: this.metrics.memory.history.slice(-30) // Last 30 data points
      },
      cpu: {
        current: this.metrics.cpu.current,
        peak: this.metrics.cpu.peak,
        history: this.metrics.cpu.history.slice(-30) // Last 30 data points
      },
      operations: {
        total: this.metrics.operations.total,
        successful: this.metrics.operations.successful,
        failed: this.metrics.operations.failed,
        inProgress: this.metrics.operations.inProgress,
        averageDuration: Math.round(this.metrics.operations.averageDuration),
        successRate: this.metrics.operations.total > 0 
          ? ((this.metrics.operations.successful / this.metrics.operations.total) * 100).toFixed(2) 
          : '100'
      },
      batches: {
        total: this.metrics.batches.total,
        successful: this.metrics.batches.successful,
        failed: this.metrics.batches.failed,
        averageSize: Math.round(this.metrics.batches.averageSize),
        averageDuration: Math.round(this.metrics.batches.averageDuration),
        history: this.metrics.batches.history.slice(-10) // Last 10 batches
      },
      errors: {
        total: this.metrics.errors.total,
        byType: this.metrics.errors.byType,
        byComponent: this.metrics.errors.byComponent,
        recent: this.metrics.errors.recent.slice(0, 10) // Last 10 errors
      },
      alerts: {
        active: this.metrics.alerts.active,
        recent: this.metrics.alerts.history.slice(0, 10) // Last 10 alerts
      }
    };
  }

  /**
   * Export metrics in Prometheus format
   * @returns {string} Prometheus formatted metrics
   */
  getPrometheusMetrics() {
    const lines = [];
    const timestamp = Math.floor(Date.now() / 1000);
    
    // System metrics
    lines.push('# HELP process_uptime_seconds The number of seconds the process has been running');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${process.uptime()} ${timestamp}`);
    
    // Memory metrics
    lines.push('# HELP process_memory_usage_bytes Memory usage in bytes');
    lines.push('# TYPE process_memory_usage_bytes gauge');
    lines.push(`process_memory_usage_bytes{type="rss"} ${this.metrics.process.memoryUsage.rss || 0} ${timestamp}`);
    lines.push(`process_memory_usage_bytes{type="heapTotal"} ${this.metrics.process.memoryUsage.heapTotal || 0} ${timestamp}`);
    lines.push(`process_memory_usage_bytes{type="heapUsed"} ${this.metrics.process.memoryUsage.heapUsed || 0} ${timestamp}`);
    lines.push(`process_memory_usage_bytes{type="external"} ${this.metrics.process.memoryUsage.external || 0} ${timestamp}`);
    
    // Memory percentage
    lines.push('# HELP system_memory_usage_percent System memory usage percentage');
    lines.push('# TYPE system_memory_usage_percent gauge');
    lines.push(`system_memory_usage_percent ${this.metrics.memory.current.percentage || 0} ${timestamp}`);
    
    // CPU metrics
    lines.push('# HELP system_cpu_usage_percent System CPU usage percentage');
    lines.push('# TYPE system_cpu_usage_percent gauge');
    lines.push(`system_cpu_usage_percent ${this.metrics.cpu.current || 0} ${timestamp}`);
    
    // Operation metrics
    lines.push('# HELP operations_total Total number of operations');
    lines.push('# TYPE operations_total counter');
    lines.push(`operations_total ${this.metrics.operations.total} ${timestamp}`);
    
    lines.push('# HELP operations_successful Total number of successful operations');
    lines.push('# TYPE operations_successful counter');
    lines.push(`operations_successful ${this.metrics.operations.successful} ${timestamp}`);
    
    lines.push('# HELP operations_failed Total number of failed operations');
    lines.push('# TYPE operations_failed counter');
    lines.push(`operations_failed ${this.metrics.operations.failed} ${timestamp}`);
    
    lines.push('# HELP operations_in_progress Current number of operations in progress');
    lines.push('# TYPE operations_in_progress gauge');
    lines.push(`operations_in_progress ${this.metrics.operations.inProgress} ${timestamp}`);
    
    lines.push('# HELP operations_average_duration_ms Average operation duration in milliseconds');
    lines.push('# TYPE operations_average_duration_ms gauge');
    lines.push(`operations_average_duration_ms ${Math.round(this.metrics.operations.averageDuration)} ${timestamp}`);
    
    // Batch metrics
    lines.push('# HELP batches_total Total number of batches processed');
    lines.push('# TYPE batches_total counter');
    lines.push(`batches_total ${this.metrics.batches.total} ${timestamp}`);
    
    lines.push('# HELP batches_successful Total number of successful batches');
    lines.push('# TYPE batches_successful counter');
    lines.push(`batches_successful ${this.metrics.batches.successful} ${timestamp}`);
    
    lines.push('# HELP batches_failed Total number of failed batches');
    lines.push('# TYPE batches_failed counter');
    lines.push(`batches_failed ${this.metrics.batches.failed} ${timestamp}`);
    
    // Error metrics
    lines.push('# HELP errors_total Total number of errors');
    lines.push('# TYPE errors_total counter');
    lines.push(`errors_total ${this.metrics.errors.total} ${timestamp}`);
    
    // Alert metrics
    lines.push('# HELP alerts_active Number of currently active alerts');
    lines.push('# TYPE alerts_active gauge');
    lines.push(`alerts_active ${this.metrics.alerts.active.length} ${timestamp}`);
    
    lines.push('# HELP alerts_critical Number of currently active critical alerts');
    lines.push('# TYPE alerts_critical gauge');
    lines.push(`alerts_critical ${this.metrics.alerts.active.filter(a => a.level === 'critical').length} ${timestamp}`);
    
    return lines.join('\n');
  }
}

// Export a singleton instance
const systemMonitor = new SystemMonitor();

module.exports = systemMonitor;