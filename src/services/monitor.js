const { logger } = require('../utils/logger');
const cron = require('node-cron');
const shedsuite = require('./shedsuite');
const excel = require('./excel');

/**
 * Enhanced monitoring service that watches for ShedSuite updates and applies targeted Excel updates
 * Supports both polling and scheduled synchronization
 */
class MonitoringService {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = null;
    this.cronJob = null;
    this.lastCheckTimestamp = null;
    this.stats = {
      syncCount: 0,
      recordsProcessed: 0,
      lastSyncDuration: 0,
      averageSyncDuration: 0,
      errors: 0,
      lastError: null
    };
    this.config = {
      pollingIntervalMs: parseInt(process.env.MONITORING_POLLING_INTERVAL_MS) || 60000,
      cronSchedule: process.env.MONITORING_CRON_SCHEDULE || null,
      fullSyncInterval: parseInt(process.env.FULL_SYNC_INTERVAL_HOURS) || 24,
      maxConcurrentSyncs: parseInt(process.env.MAX_CONCURRENT_SYNCS) || 1,
      enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING === 'true'
    };
    this.activeSyncs = 0;
    this.lastFullSync = null;

    logger.info('MonitoringService initialized with configuration:', {
      pollingInterval: `${this.config.pollingIntervalMs / 1000} seconds`,
      cronSchedule: this.config.cronSchedule || 'Not configured',
      fullSyncInterval: `${this.config.fullSyncInterval} hours`,
      maxConcurrentSyncs: this.config.maxConcurrentSyncs,
      performanceLogging: this.config.enablePerformanceLogging
    });
  }

  /**
   * Start the monitoring service with flexible configuration
   * @param {Object} options Configuration options
   * @returns {Promise<void>}
   */
  async start(options = {}) {
    if (this.isRunning) {
      logger.warn('Monitoring service is already running');
      return;
    }

    const config = { ...this.config, ...options };
    logger.info('Starting ShedSuite monitoring service', config);

    try {
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

      this.isRunning = true;
      logger.info('Monitoring service started successfully');
    } catch (error) {
      logger.error('Failed to start monitoring service:', error);
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
      logger.warn('Monitoring service is not running');
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

    this.isRunning = false;
    logger.info('Monitoring service stopped');
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
    const syncId = Date.now().toString(36); // Generate a unique sync ID

    try {
      logger.info(`[Sync ${syncId}] Starting full synchronization process...`);

      // Perform health checks first
      logger.info(`[Sync ${syncId}] Performing health checks...`);
      const shedsiteHealth = await shedsuite.healthCheck();
      const excelHealth = await excel.healthCheck();

      if (shedsiteHealth.status !== 'healthy') {
        throw new Error(`ShedSuite API unhealthy: ${shedsiteHealth.error}`);
      }

      if (excelHealth.status !== 'healthy') {
        throw new Error(`Excel API unhealthy: ${excelHealth.error}`);
      }

      logger.info(`[Sync ${syncId}] Health checks passed. Starting data fetch...`);

      // Fetch all records with progress tracking
      const records = await shedsuite.fetchAllRecords(options.filters || {});
      logger.info(`[Sync ${syncId}] Retrieved ${records.length} records from ShedSuite API`);

      const formattedRecords = shedsuite.formatRecordsForExport(records);
      logger.info(`[Sync ${syncId}] Formatted ${formattedRecords.length} records for Excel export`);

      // Update Excel with full dataset
      logger.info(`[Sync ${syncId}] Updating Excel spreadsheet...`);
      await excel.updateSpreadsheet(formattedRecords);

      const duration = Date.now() - startTime;
      this.updateStats(duration, formattedRecords.length);
      this.lastFullSync = new Date().toISOString();

      logger.info(`[Sync ${syncId}] Sync completed successfully`, {
        duration: `${duration / 1000} seconds`,
        recordsProcessed: formattedRecords.length,
        averageTimePerRecord: `${(duration / formattedRecords.length).toFixed(2)}ms`,
        timestamp: new Date().toISOString()
      });
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

    try {
      logger.debug(`Checking for updates since ${this.lastCheckTimestamp}`);

      // Fetch only updated records
      const updatedRecords = await shedsuite.fetchAllRecords({
        updatedAfter: this.lastCheckTimestamp,
        pageSize: 100 // Smaller page size for incremental updates
      });

      if (updatedRecords.length === 0) {
        logger.debug('No updates found');
        return;
      }

      logger.info(`Found ${updatedRecords.length} updated records`);

      // Format the updated records
      const formattedUpdates = shedsuite.formatRecordsForExport(updatedRecords);

      // Apply targeted updates to Excel
      await this.applyTargetedUpdates(formattedUpdates);

      // Update statistics and timestamp
      const duration = Date.now() - startTime;
      this.updateStats(duration, formattedUpdates.length);
      this.lastCheckTimestamp = new Date().toISOString();

      if (this.config.enablePerformanceLogging) {
        logger.info(`Update check completed in ${duration}ms`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.errors++;
      this.stats.lastError = error.message;
      logger.error(`Error checking for updates after ${duration}ms:`, error);

      // Don't throw to continue monitoring
    } finally {
      this.activeSyncs--;
    }
  }

  /**
   * Apply targeted updates to specific Excel cells with batch optimization
   * @param {Array} updates The updated records
   * @returns {Promise<void>}
   */
  async applyTargetedUpdates(updates) {
    try {
      if (updates.length === 0) {
        return;
      }

      logger.info(`Applying ${updates.length} targeted updates to Excel`);

      // Use Excel service's optimized targeted update method
      await excel.applyTargetedUpdates(updates);

      logger.info('Targeted updates applied successfully');
    } catch (error) {
      logger.error('Failed to apply targeted updates:', error);

      // Fallback to full sync if targeted updates fail
      if (updates.length > 0) {
        logger.info('Attempting fallback to full spreadsheet update...');
        await excel.updateSpreadsheet(updates);
        logger.info('Fallback update completed');
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
      isHealthy: this.stats.errors === 0 || (this.stats.errors / this.stats.syncCount) < 0.1 // Less than 10% error rate
    };
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
      lastError: null
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
}

// Export a singleton instance
const monitoringService = new MonitoringService();

module.exports = monitoringService;
