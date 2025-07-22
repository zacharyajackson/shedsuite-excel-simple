/**
 * Enhanced monitoring service with comprehensive metrics collection and alerting
 */
const { logger } = require('../utils/logger');
const cron = require('node-cron');
const shedsuite = require('./shedsuite');
const excel = require('./excel');
const systemMonitor = require('../utils/system-monitor');
const notificationSystem = require('../utils/notification-system');
const progressDashboard = require('../utils/progress-dashboard');

class EnhancedMonitoringService {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = null;
    this.cronJob = null;
    this.healthCheckInterval = null;
    this.metricsExportInterval = null;
    this.lastCheckTimestamp = null;
    this.stats = {
      syncCount: 0,
      recordsProcessed: 0,
      lastSyncDuration: 0,
      averageSyncDuration: 0,
      errors: 0,
      lastError: null,
      healthChecks: {
        total: 0,
        passed: 0,
        failed: 0,
        lastStatus: null,
        lastCheck: null
      }
    };
    
    this.config = {
      pollingIntervalMs: parseInt(process.env.MONITORING_POLLING_INTERVAL_MS) || 60000,
      cronSchedule: process.env.MONITORING_CRON_SCHEDULE || null,
      fullSyncInterval: parseInt(process.env.FULL_SYNC_INTERVAL_HOURS) || 24,
      maxConcurrentSyncs: parseInt(process.env.MAX_CONCURRENT_SYNCS) || 1,
      enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING === 'true',
      healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 300000, // 5 minutes
      metricsExportIntervalMs: parseInt(process.env.METRICS_EXPORT_INTERVAL_MS) || 60000, // 1 minute
      alertThresholds: {
        errorRate: parseFloat(process.env.ALERT_THRESHOLD_ERROR_RATE) || 10, // 10%
        syncDuration: parseInt(process.env.ALERT_THRESHOLD_SYNC_DURATION_MS) || 300000, // 5 minutes
        memoryUsage: parseFloat(process.env.ALERT_THRESHOLD_MEMORY_USAGE) || 85, // 85%
        cpuUsage: parseFloat(process.env.ALERT_THRESHOLD_CPU_USAGE) || 80 // 80%
      }
    };
    
    this.activeSyncs = 0;
    this.lastFullSync = null;
    this.healthStatus = {
      overall: 'unknown',
      components: {
        shedsuite: 'unknown',
        excel: 'unknown',
        system: 'unknown'
      },
      lastCheck: null
    };
    
    // Setup alert listener
    systemMonitor.addAlertListener(this.handleSystemAlert.bind(this));

    logger.info('EnhancedMonitoringService initialized with configuration:', {
      pollingInterval: `${this.config.pollingIntervalMs / 1000} seconds`,
      cronSchedule: this.config.cronSchedule || 'Not configured',
      fullSyncInterval: `${this.config.fullSyncInterval} hours`,
      maxConcurrentSyncs: this.config.maxConcurrentSyncs,
      performanceLogging: this.config.enablePerformanceLogging,
      healthCheckInterval: `${this.config.healthCheckIntervalMs / 1000} seconds`,
      metricsExportInterval: `${this.config.metricsExportIntervalMs / 1000} seconds`,
      alertThresholds: this.config.alertThresholds
    });
  }

  /**
   * Start the enhanced monitoring service
   * @param {Object} options Configuration options
   * @returns {Promise<void>}
   */
  async start(options = {}) {
    if (this.isRunning) {
      logger.warn('Enhanced monitoring service is already running');
      return;
    }

    const config = { ...this.config, ...options };
    logger.info('Starting enhanced monitoring service', config);

    try {
      // Start system monitoring
      systemMonitor.start({
        interval: Math.min(config.pollingIntervalMs, 60000), // At most once per minute
        thresholds: {
          memory: config.alertThresholds.memoryUsage,
          cpu: config.alertThresholds.cpuUsage,
          errorRate: config.alertThresholds.errorRate
        }
      });
      
      // Initialize last check timestamp
      this.lastCheckTimestamp = new Date().toISOString();

      // Start appropriate monitoring method
      if (config.cronSchedule) {
        await this.startCronMonitoring(config.cronSchedule);
      } else {
        await this.startPollingMonitoring(config.pollingIntervalMs);
      }

      // Schedule full sync if configured
      if (config.fullSyncInterval > 0) {
        this.scheduleFullSync(config.fullSyncInterval);
      }
      
      // Start health check monitoring
      this.startHealthChecks(config.healthCheckIntervalMs);
      
      // Start metrics export
      this.startMetricsExport(config.metricsExportIntervalMs);

      this.isRunning = true;
      logger.info('Enhanced monitoring service started successfully');
      
      // Perform initial health check
      this.performHealthCheck();
    } catch (error) {
      logger.error('Failed to start enhanced monitoring service:', error);
      this.stats.errors++;
      this.stats.lastError = error.message;
      throw error;
    }
  }

  /**
   * Start cron-based monitoring
   * @param {string} cronSchedule Cron schedule expression
   */
  async startCronMonitoring(cronSchedule) {
    if (!cron.validate(cronSchedule)) {
      throw new Error(`Invalid cron schedule: ${cronSchedule}`);
    }

    this.cronJob = cron.schedule(cronSchedule, () => {
      this.checkForUpdates().catch(error => {
        logger.error('Scheduled sync failed:', error);
      });
    }, {
      scheduled: false
    });

    this.cronJob.start();
    logger.info(`Cron monitoring started with schedule: ${cronSchedule}`);
  }

  /**
   * Start polling-based monitoring
   * @param {number} pollingIntervalMs Polling interval in milliseconds
   */
  async startPollingMonitoring(pollingIntervalMs) {
    this.pollingInterval = setInterval(
      () => this.checkForUpdates(),
      pollingIntervalMs
    );

    logger.info(`Polling monitoring started, checking every ${pollingIntervalMs / 1000} seconds`);
  }

  /**
   * Start periodic health checks
   * @param {number} intervalMs Health check interval in milliseconds
   */
  startHealthChecks(intervalMs) {
    this.healthCheckInterval = setInterval(
      () => this.performHealthCheck(),
      intervalMs
    );
    
    logger.info(`Health check monitoring started, checking every ${intervalMs / 1000} seconds`);
  }
  
  /**
   * Start periodic metrics export
   * @param {number} intervalMs Metrics export interval in milliseconds
   */
  startMetricsExport(intervalMs) {
    this.metricsExportInterval = setInterval(
      () => this.exportMetrics(),
      intervalMs
    );
    
    logger.info(`Metrics export started, exporting every ${intervalMs / 1000} seconds`);
  }

  /**
   * Schedule periodic full syncs
   * @param {number} intervalHours Interval in hours
   */
  scheduleFullSync(intervalHours) {
    const intervalMs = intervalHours * 60 * 60 * 1000;

    setInterval(() => {
      this.performFullSync().catch(error => {
        logger.error('Scheduled full sync failed:', error);
      });
    }, intervalMs);

    logger.info(`Full sync scheduled every ${intervalHours} hours`);
  }

  /**
   * Stop the monitoring service
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('Enhanced monitoring service is not running');
      return;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.metricsExportInterval) {
      clearInterval(this.metricsExportInterval);
      this.metricsExportInterval = null;
    }
    
    // Stop system monitoring
    systemMonitor.stop();

    this.isRunning = false;
    logger.info('Enhanced monitoring service stopped');
  }

  /**
   * Perform a comprehensive health check
   * @returns {Promise<Object>} Health check results
   */
  async performHealthCheck() {
    const startTime = Date.now();
    const healthCheckId = `health-${Date.now()}`;
    
    logger.debug(`[${healthCheckId}] Performing comprehensive health check...`);
    
    try {
      // Check ShedSuite API
      let shedsiteHealth;
      try {
        shedsiteHealth = await shedsuite.healthCheck();
        this.healthStatus.components.shedsuite = shedsiteHealth.status;
      } catch (error) {
        logger.error(`[${healthCheckId}] ShedSuite API health check failed:`, error);
        shedsiteHealth = { status: 'unhealthy', error: error.message };
        this.healthStatus.components.shedsuite = 'unhealthy';
      }
      
      // Check Excel API
      let excelHealth;
      try {
        excelHealth = await excel.healthCheck();
        this.healthStatus.components.excel = excelHealth.status;
      } catch (error) {
        logger.error(`[${healthCheckId}] Excel API health check failed:`, error);
        excelHealth = { status: 'unhealthy', error: error.message };
        this.healthStatus.components.excel = 'unhealthy';
      }
      
      // Check system health
      const systemHealth = systemMonitor.getHealthStatus();
      this.healthStatus.components.system = systemHealth.status;
      
      // Determine overall health
      if (
        shedsiteHealth.status === 'healthy' && 
        excelHealth.status === 'healthy' && 
        systemHealth.status === 'healthy'
      ) {
        this.healthStatus.overall = 'healthy';
      } else if (
        shedsiteHealth.status === 'unhealthy' || 
        excelHealth.status === 'unhealthy' || 
        systemHealth.status === 'critical'
      ) {
        this.healthStatus.overall = 'unhealthy';
      } else {
        this.healthStatus.overall = 'degraded';
      }
      
      // Update health check stats
      this.stats.healthChecks.total++;
      if (this.healthStatus.overall === 'healthy') {
        this.stats.healthChecks.passed++;
      } else {
        this.stats.healthChecks.failed++;
      }
      
      this.stats.healthChecks.lastStatus = this.healthStatus.overall;
      this.stats.healthChecks.lastCheck = new Date().toISOString();
      this.healthStatus.lastCheck = new Date().toISOString();
      
      // Log health check results
      const duration = Date.now() - startTime;
      logger.info(`[${healthCheckId}] Health check completed in ${duration}ms: ${this.healthStatus.overall}`, {
        overall: this.healthStatus.overall,
        components: this.healthStatus.components,
        duration
      });
      
      // Send alert if unhealthy
      if (this.healthStatus.overall === 'unhealthy') {
        await notificationSystem.sendNotification({
          level: 'critical',
          title: 'System Health Check Failed',
          message: `The system health check has failed with status: ${this.healthStatus.overall}`,
          details: {
            components: this.healthStatus.components,
            issues: [
              shedsiteHealth.status !== 'healthy' ? `ShedSuite API: ${shedsiteHealth.error || shedsiteHealth.status}` : null,
              excelHealth.status !== 'healthy' ? `Excel API: ${excelHealth.error || excelHealth.status}` : null,
              systemHealth.status !== 'healthy' ? `System: ${systemHealth.issues.join(', ')}` : null
            ].filter(Boolean)
          }
        });
      } else if (this.healthStatus.overall === 'degraded') {
        await notificationSystem.sendNotification({
          level: 'warning',
          title: 'System Health Degraded',
          message: `The system health check indicates degraded performance`,
          details: {
            components: this.healthStatus.components,
            issues: [
              shedsiteHealth.status !== 'healthy' ? `ShedSuite API: ${shedsiteHealth.error || shedsiteHealth.status}` : null,
              excelHealth.status !== 'healthy' ? `Excel API: ${excelHealth.error || excelHealth.status}` : null,
              systemHealth.status !== 'healthy' ? `System: ${systemHealth.issues.join(', ')}` : null
            ].filter(Boolean)
          }
        });
      }
      
      return {
        id: healthCheckId,
        timestamp: new Date().toISOString(),
        duration,
        overall: this.healthStatus.overall,
        components: {
          shedsuite: shedsiteHealth,
          excel: excelHealth,
          system: systemHealth
        }
      };
    } catch (error) {
      logger.error(`[${healthCheckId}] Health check failed with error:`, error);
      
      this.healthStatus.overall = 'unhealthy';
      this.stats.healthChecks.total++;
      this.stats.healthChecks.failed++;
      this.stats.healthChecks.lastStatus = 'unhealthy';
      this.stats.healthChecks.lastCheck = new Date().toISOString();
      
      return {
        id: healthCheckId,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        overall: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Export metrics for operational monitoring
   */
  exportMetrics() {
    try {
      // Get system metrics
      const systemMetrics = systemMonitor.getDetailedMetrics();
      
      // Get dashboard summary
      const dashboardSummary = progressDashboard.getDashboardSummary();
      
      // Combine metrics
      const combinedMetrics = {
        timestamp: Date.now(),
        system: systemMetrics,
        monitoring: {
          isRunning: this.isRunning,
          activeSyncs: this.activeSyncs,
          lastCheckTimestamp: this.lastCheckTimestamp,
          lastFullSync: this.lastFullSync,
          stats: this.stats,
          healthStatus: this.healthStatus
        },
        operations: dashboardSummary
      };
      
      // Log metrics summary
      if (this.config.enablePerformanceLogging) {
        logger.debug('Metrics exported', {
          timestamp: new Date().toISOString(),
          health: this.healthStatus.overall,
          memory: `${systemMetrics.memory.current.percentage}%`,
          cpu: `${systemMetrics.cpu.current}%`,
          operations: dashboardSummary.operations
        });
      }
      
      // Emit metrics event (for potential consumers)
      if (process.env.ENABLE_METRICS_EVENTS === 'true') {
        process.emit('metrics', combinedMetrics);
      }
      
      return combinedMetrics;
    } catch (error) {
      logger.error('Failed to export metrics:', error);
    }
  }

  /**
   * Handle system alerts
   * @param {Object} alert Alert information
   */
  async handleSystemAlert(alert) {
    try {
      // Forward alert to notification system
      await notificationSystem.sendAlertNotification(alert);
      
      // Log alert
      logger.warn(`System alert: ${alert.message}`, { alert });
    } catch (error) {
      logger.error('Failed to handle system alert:', error);
    }
  }

  /**
   * Perform a full sync between ShedSuite and Excel
   * @param {Object} options Sync options
   * @returns {Promise<void>}
   */
  async performFullSync(options = {}) {
    if (this.activeSyncs >= this.config.maxConcurrentSyncs) {
      logger.warn(`Full sync skipped - ${this.activeSyncs} syncs already in progress (max: ${this.config.maxConcurrentSyncs})`);
      return;
    }

    this.activeSyncs++;
    const startTime = Date.now();
    const syncId = `sync-${Date.now().toString(36)}`; // Generate a unique sync ID
    
    // Register operation in dashboard
    const operationId = progressDashboard.registerOperation('full_sync', {
      syncId,
      options
    });

    try {
      logger.info(`[Sync ${syncId}] Starting full synchronization process...`);
      progressDashboard.addLog(operationId, 'info', 'Starting full synchronization process');

      // Perform health checks first
      logger.info(`[Sync ${syncId}] Performing health checks...`);
      const healthCheckStep = progressDashboard.addStep(operationId, 'Health Check');
      
      const healthCheck = await this.performHealthCheck();
      
      if (healthCheck.overall === 'unhealthy') {
        progressDashboard.updateStep(operationId, healthCheckStep, 'failed', {
          error: 'Health check failed',
          details: healthCheck
        });
        progressDashboard.addLog(operationId, 'error', 'Health check failed, aborting sync');
        throw new Error(`Health check failed: ${JSON.stringify(healthCheck.components)}`);
      }
      
      progressDashboard.updateStep(operationId, healthCheckStep, 'completed', {
        status: healthCheck.overall
      });

      // Fetch all records with progress tracking
      const fetchStep = progressDashboard.addStep(operationId, 'Fetch Records');
      progressDashboard.addLog(operationId, 'info', 'Fetching records from ShedSuite API');
      
      const records = await shedsuite.fetchAllRecords(options.filters || {});
      logger.info(`[Sync ${syncId}] Retrieved ${records.length} records from ShedSuite API`);
      
      progressDashboard.updateProgress(operationId, 30, {
        totalItems: records.length,
        processedItems: 0
      });
      
      progressDashboard.updateStep(operationId, fetchStep, 'completed', {
        recordCount: records.length
      });

      // Format records
      const formatStep = progressDashboard.addStep(operationId, 'Format Records');
      progressDashboard.addLog(operationId, 'info', `Formatting ${records.length} records for Excel export`);
      
      const formattedRecords = shedsuite.formatRecordsForExport(records);
      logger.info(`[Sync ${syncId}] Formatted ${formattedRecords.length} records for Excel export`);
      
      progressDashboard.updateProgress(operationId, 50, {
        processedItems: formattedRecords.length
      });
      
      progressDashboard.updateStep(operationId, formatStep, 'completed', {
        recordCount: formattedRecords.length
      });

      // Update Excel with full dataset
      const updateStep = progressDashboard.addStep(operationId, 'Update Excel');
      progressDashboard.addLog(operationId, 'info', `Updating Excel spreadsheet with ${formattedRecords.length} records`);
      
      logger.info(`[Sync ${syncId}] Updating Excel spreadsheet...`);
      await excel.updateSpreadsheet(formattedRecords);
      
      progressDashboard.updateProgress(operationId, 100, {
        processedItems: formattedRecords.length,
        successfulItems: formattedRecords.length
      });
      
      progressDashboard.updateStep(operationId, updateStep, 'completed');

      const duration = Date.now() - startTime;
      this.updateStats(duration, formattedRecords.length);
      this.lastFullSync = new Date().toISOString();

      logger.info(`[Sync ${syncId}] Sync completed successfully`, {
        duration: `${duration / 1000} seconds`,
        recordsProcessed: formattedRecords.length,
        averageTimePerRecord: `${(duration / formattedRecords.length).toFixed(2)}ms`,
        timestamp: new Date().toISOString()
      });
      
      // Record batch in system monitor
      systemMonitor.recordBatch({
        batchId: syncId,
        size: formattedRecords.length,
        duration,
        success: true
      });
      
      // Complete operation in dashboard
      progressDashboard.completeOperation(operationId, 'completed', {
        duration,
        recordsProcessed: formattedRecords.length,
        averageTimePerRecord: (duration / formattedRecords.length).toFixed(2)
      });
      
      // Check if sync duration exceeds threshold
      if (duration > this.config.alertThresholds.syncDuration) {
        await notificationSystem.sendNotification({
          level: 'warning',
          title: 'Sync Duration Exceeded Threshold',
          message: `Full sync took ${(duration / 1000).toFixed(1)} seconds, exceeding the threshold of ${(this.config.alertThresholds.syncDuration / 1000).toFixed(1)} seconds`,
          details: {
            syncId,
            duration,
            threshold: this.config.alertThresholds.syncDuration,
            recordsProcessed: formattedRecords.length
          }
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.errors++;
      this.stats.lastError = error.message;
      
      logger.error(`[Sync ${syncId}] Sync failed`, {
        duration: `${duration / 1000} seconds`,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      
      // Record error in system monitor
      systemMonitor.recordError({
        type: 'sync_failure',
        component: 'monitoring_service',
        message: `Sync ${syncId} failed: ${error.message}`,
        details: {
          syncId,
          duration,
          error: error.message,
          stack: error.stack
        }
      });
      
      // Record failed batch
      systemMonitor.recordBatch({
        batchId: syncId,
        size: 0,
        duration,
        success: false,
        errorType: 'sync_failure'
      });
      
      // Complete operation in dashboard as failed
      progressDashboard.addLog(operationId, 'error', `Sync failed: ${error.message}`);
      progressDashboard.completeOperation(operationId, 'failed', {
        error: error.message,
        duration
      });
      
      // Send notification
      await notificationSystem.sendNotification({
        level: 'error',
        title: 'Sync Operation Failed',
        message: `Sync operation ${syncId} failed: ${error.message}`,
        details: {
          syncId,
          duration: `${duration / 1000} seconds`,
          error: error.message,
          stack: error.stack
        }
      });
      
      throw error;
    } finally {
      this.activeSyncs--;
    }
  }

  /**
   * Check for updates since the last check with enhanced error handling
   * @returns {Promise<void>}
   */
  async checkForUpdates() {
    if (this.activeSyncs >= this.config.maxConcurrentSyncs) {
      logger.debug('Update check skipped - maximum concurrent syncs reached');
      return;
    }

    this.activeSyncs++;
    const startTime = Date.now();
    const updateId = `update-${Date.now().toString(36)}`;
    
    // Register operation in dashboard
    const operationId = progressDashboard.registerOperation('incremental_update', {
      updateId,
      lastCheckTimestamp: this.lastCheckTimestamp
    });

    try {
      logger.debug(`[Update ${updateId}] Checking for updates since ${this.lastCheckTimestamp}`);
      progressDashboard.addLog(operationId, 'info', `Checking for updates since ${this.lastCheckTimestamp}`);

      // Fetch only updated records
      const fetchStep = progressDashboard.addStep(operationId, 'Fetch Updated Records');
      
      const updatedRecords = await shedsuite.fetchAllRecords({
        updatedAfter: this.lastCheckTimestamp,
        pageSize: 100 // Smaller page size for incremental updates
      });
      
      progressDashboard.updateStep(operationId, fetchStep, 'completed', {
        recordCount: updatedRecords.length
      });

      if (updatedRecords.length === 0) {
        logger.debug(`[Update ${updateId}] No updates found`);
        progressDashboard.addLog(operationId, 'info', 'No updates found');
        progressDashboard.updateProgress(operationId, 100, {
          totalItems: 0,
          processedItems: 0
        });
        progressDashboard.completeOperation(operationId, 'completed', {
          recordsProcessed: 0,
          duration: Date.now() - startTime
        });
        return;
      }

      logger.info(`[Update ${updateId}] Found ${updatedRecords.length} updated records`);
      progressDashboard.addLog(operationId, 'info', `Found ${updatedRecords.length} updated records`);
      progressDashboard.updateProgress(operationId, 30, {
        totalItems: updatedRecords.length,
        processedItems: 0
      });

      // Format the updated records
      const formatStep = progressDashboard.addStep(operationId, 'Format Records');
      const formattedUpdates = shedsuite.formatRecordsForExport(updatedRecords);
      
      progressDashboard.updateStep(operationId, formatStep, 'completed', {
        recordCount: formattedUpdates.length
      });
      progressDashboard.updateProgress(operationId, 60, {
        processedItems: formattedUpdates.length
      });

      // Apply targeted updates to Excel
      const updateStep = progressDashboard.addStep(operationId, 'Apply Updates');
      await this.applyTargetedUpdates(formattedUpdates, updateId, operationId);
      
      progressDashboard.updateStep(operationId, updateStep, 'completed');
      progressDashboard.updateProgress(operationId, 100, {
        processedItems: formattedUpdates.length,
        successfulItems: formattedUpdates.length
      });

      // Update statistics and timestamp
      const duration = Date.now() - startTime;
      this.updateStats(duration, formattedUpdates.length);
      this.lastCheckTimestamp = new Date().toISOString();

      if (this.config.enablePerformanceLogging) {
        logger.info(`[Update ${updateId}] Update check completed in ${duration}ms`);
      }
      
      // Record batch in system monitor
      systemMonitor.recordBatch({
        batchId: updateId,
        size: formattedUpdates.length,
        duration,
        success: true
      });
      
      // Complete operation in dashboard
      progressDashboard.completeOperation(operationId, 'completed', {
        duration,
        recordsProcessed: formattedUpdates.length
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.errors++;
      this.stats.lastError = error.message;
      
      logger.error(`[Update ${updateId}] Error checking for updates after ${duration}ms:`, error);
      
      // Record error in system monitor
      systemMonitor.recordError({
        type: 'update_check_failure',
        component: 'monitoring_service',
        message: `Update check ${updateId} failed: ${error.message}`,
        details: {
          updateId,
          duration,
          error: error.message,
          stack: error.stack
        }
      });
      
      // Record failed batch
      systemMonitor.recordBatch({
        batchId: updateId,
        size: 0,
        duration,
        success: false,
        errorType: 'update_check_failure'
      });
      
      // Complete operation in dashboard as failed
      progressDashboard.addLog(operationId, 'error', `Update check failed: ${error.message}`);
      progressDashboard.completeOperation(operationId, 'failed', {
        error: error.message,
        duration
      });
      
      // Don't throw to continue monitoring
    } finally {
      this.activeSyncs--;
    }
  }

  /**
   * Apply targeted updates to specific Excel cells with batch optimization
   * @param {Array} updates The updated records
   * @param {string} updateId Update ID for logging
   * @param {string} operationId Dashboard operation ID
   * @returns {Promise<void>}
   */
  async applyTargetedUpdates(updates, updateId, operationId) {
    try {
      if (updates.length === 0) {
        return;
      }

      logger.info(`[Update ${updateId}] Applying ${updates.length} targeted updates to Excel`);
      progressDashboard.addLog(operationId, 'info', `Applying ${updates.length} targeted updates to Excel`);

      // Use Excel service's optimized targeted update method
      await excel.applyTargetedUpdates(updates);

      logger.info(`[Update ${updateId}] Targeted updates applied successfully`);
      progressDashboard.addLog(operationId, 'info', 'Targeted updates applied successfully');
    } catch (error) {
      logger.error(`[Update ${updateId}] Failed to apply targeted updates:`, error);
      progressDashboard.addLog(operationId, 'error', `Failed to apply targeted updates: ${error.message}`);
      
      // Record error
      systemMonitor.recordError({
        type: 'targeted_update_failure',
        component: 'excel_service',
        message: `Failed to apply targeted updates: ${error.message}`,
        details: {
          updateId,
          updateCount: updates.length,
          error: error.message
        }
      });

      // Fallback to full sync if targeted updates fail
      if (updates.length > 0) {
        logger.info(`[Update ${updateId}] Attempting fallback to full spreadsheet update...`);
        progressDashboard.addLog(operationId, 'warning', 'Attempting fallback to full spreadsheet update');
        
        const fallbackStep = progressDashboard.addStep(operationId, 'Fallback Update');
        
        try {
          await excel.updateSpreadsheet(updates);
          logger.info(`[Update ${updateId}] Fallback update completed`);
          progressDashboard.addLog(operationId, 'info', 'Fallback update completed successfully');
          progressDashboard.updateStep(operationId, fallbackStep, 'completed');
        } catch (fallbackError) {
          logger.error(`[Update ${updateId}] Fallback update failed:`, fallbackError);
          progressDashboard.addLog(operationId, 'error', `Fallback update failed: ${fallbackError.message}`);
          progressDashboard.updateStep(operationId, fallbackStep, 'failed', {
            error: fallbackError.message
          });
          throw fallbackError;
        }
      }
    }
  }

  /**
   * Update internal statistics
   * @param {number} duration Sync duration in milliseconds
   * @param {number} recordCount Number of records processed
   */
  updateStats(duration, recordCount) {
    this.stats.syncCount++;
    this.stats.recordsProcessed += recordCount;
    this.stats.lastSyncDuration = duration;

    // Calculate rolling average
    if (this.stats.syncCount === 1) {
      this.stats.averageSyncDuration = duration;
    } else {
      this.stats.averageSyncDuration =
        (this.stats.averageSyncDuration * (this.stats.syncCount - 1) + duration) / this.stats.syncCount;
    }
  }

  /**
   * Get comprehensive status information
   * @returns {Object} Detailed status information
   */
  getStatus() {
    const uptime = this.isRunning && this.lastCheckTimestamp
      ? Date.now() - new Date(this.lastCheckTimestamp).getTime()
      : 0;

    return {
      isRunning: this.isRunning,
      activeSyncs: this.activeSyncs,
      lastCheckTimestamp: this.lastCheckTimestamp,
      lastFullSync: this.lastFullSync,
      uptime,
      health: this.healthStatus,
      stats: {
        ...this.stats,
        averageSyncDuration: Math.round(this.stats.averageSyncDuration),
        successRate: this.stats.syncCount > 0
          ? ((this.stats.syncCount - this.stats.errors) / this.stats.syncCount * 100).toFixed(2) + '%'
          : 'N/A'
      },
      config: this.config
    };
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    return {
      syncCount: this.stats.syncCount,
      recordsProcessed: this.stats.recordsProcessed,
      averageRecordsPerSync: this.stats.syncCount > 0
        ? Math.round(this.stats.recordsProcessed / this.stats.syncCount)
        : 0,
      lastSyncDuration: this.stats.lastSyncDuration,
      averageSyncDuration: Math.round(this.stats.averageSyncDuration),
      errorRate: this.stats.syncCount > 0
        ? (this.stats.errors / this.stats.syncCount * 100).toFixed(2) + '%'
        : '0%',
      isHealthy: this.healthStatus.overall === 'healthy',
      healthChecks: this.stats.healthChecks,
      system: systemMonitor.getHealthStatus()
    };
  }

  /**
   * Get metrics in Prometheus format
   * @returns {string} Prometheus formatted metrics
   */
  getPrometheusMetrics() {
    return systemMonitor.getPrometheusMetrics();
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      syncCount: 0,
      recordsProcessed: 0,
      lastSyncDuration: 0,
      averageSyncDuration: 0,
      errors: 0,
      lastError: null,
      healthChecks: {
        total: 0,
        passed: 0,
        failed: 0,
        lastStatus: null,
        lastCheck: null
      }
    };
    logger.info('Monitoring statistics reset');
  }

  /**
   * Force a sync check (manual trigger)
   * @returns {Promise<void>}
   */
  async forceSyncCheck() {
    logger.info('Manual sync check triggered');
    await this.checkForUpdates();
  }

  /**
   * Force a full sync (manual trigger)
   * @param {Object} options Sync options
   * @returns {Promise<void>}
   */
  async forceFullSync(options = {}) {
    logger.info('Manual full sync triggered');
    await this.performFullSync(options);
  }
  
  /**
   * Force a health check (manual trigger)
   * @returns {Promise<Object>} Health check results
   */
  async forceHealthCheck() {
    logger.info('Manual health check triggered');
    return await this.performHealthCheck();
  }
}

// Export a singleton instance
const enhancedMonitoringService = new EnhancedMonitoringService();

module.exports = enhancedMonitoringService;