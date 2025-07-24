const cron = require('node-cron');
const { syncLogger } = require('../utils/logger');
const shedsuiteAPI = require('./shedsuite-api');
const supabaseClient = require('./supabase-client');
const dataTransformer = require('../utils/data-transformer');

class DataSyncService {
  constructor() {
    this.isRunning = false;
    this.lastSyncTime = null;
    this.syncStats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalRecordsProcessed: 0,
      lastSyncDuration: 0,
      averageSyncDuration: 0
    };
    this.cronJob = null;
    this.syncInterval = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 15;
    this.batchSize = parseInt(process.env.BATCH_SIZE) || 100;
    this.maxRetries = parseInt(process.env.MAX_SYNC_RETRIES) || 5;
    this.retryDelay = parseInt(process.env.SYNC_RETRY_DELAY) || 5000;
  }

  // Initialize the sync service
  async initialize() {
    try {
      syncLogger.info('Initializing data sync service', {
        syncInterval: this.syncInterval,
        batchSize: this.batchSize,
        maxRetries: this.maxRetries
      });

      // Test connections
      await this.testConnections();

      // Start scheduled sync if enabled
      if (process.env.ENABLE_REAL_TIME_SYNC === 'true') {
        this.startScheduledSync();
      }

      syncLogger.info('Data sync service initialized successfully');
    } catch (error) {
      syncLogger.error('Failed to initialize data sync service', { error: error.message });
      throw error;
    }
  }

  // Test API and database connections
  async testConnections() {
    try {
      // Test ShedSuite API
      const apiHealth = await shedsuiteAPI.healthCheck();
      if (apiHealth.status !== 'healthy') {
        throw new Error(`ShedSuite API health check failed: ${apiHealth.error}`);
      }

      // Test Supabase connection
      const dbHealth = await supabaseClient.healthCheck();
      if (dbHealth.status !== 'healthy') {
        throw new Error(`Supabase health check failed: ${dbHealth.error}`);
      }

      syncLogger.info('All connections tested successfully');
    } catch (error) {
      syncLogger.error('Connection test failed', { error: error.message });
      throw error;
    }
  }

  // Start scheduled sync
  startScheduledSync() {
    const cronExpression = `*/${this.syncInterval} * * * *`;
    
    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        await this.performSync();
      } catch (error) {
        syncLogger.error('Scheduled sync failed', { error: error.message });
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    syncLogger.info('Scheduled sync started', {
      cronExpression,
      intervalMinutes: this.syncInterval
    });
  }

  // Stop scheduled sync
  stopScheduledSync() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      syncLogger.info('Scheduled sync stopped');
    }
  }

  // Perform a complete sync operation
  async performSync(options = {}) {
    const startTime = Date.now();
    const syncId = `sync_${Date.now()}`;

    try {
      if (this.isRunning) {
        throw new Error('Sync already in progress');
      }

      this.isRunning = true;
      syncLogger.info('Starting sync operation', { syncId, options });

      // Get last sync timestamp
      const lastSyncTimestamp = await supabaseClient.getLastSyncTimestamp();
      
      // Build filters for incremental sync
      const filters = {};
      if (lastSyncTimestamp && !options.fullSync) {
        filters.updated_after = lastSyncTimestamp;
        syncLogger.info('Performing incremental sync', { lastSyncTimestamp });
      } else {
        syncLogger.info('Performing full sync');
      }

      // Fetch records from ShedSuite API
      const rawRecords = await shedsuiteAPI.fetchAllRecords(filters);
      
      if (!rawRecords || rawRecords.length === 0) {
        syncLogger.info('No records to sync');
        await this.updateSyncStats(startTime, 0, true);
        return {
          success: true,
          recordsProcessed: 0,
          message: 'No records to sync'
        };
      }

      // Transform records
      const transformationResult = dataTransformer.transformBatch(rawRecords, 'shedsuite_orders');
      
      if (transformationResult.errors.length > 0) {
        syncLogger.warn('Some records failed transformation', {
          totalRecords: rawRecords.length,
          transformedCount: transformationResult.transformed.length,
          errorCount: transformationResult.errors.length
        });
      }

      // Sync to Supabase in batches
      const syncResult = await this.syncToSupabase(transformationResult.transformed);

      // Update sync timestamp
      await supabaseClient.updateSyncTimestamp();

      const duration = Date.now() - startTime;
      await this.updateSyncStats(startTime, syncResult.totalProcessed, true);

      syncLogger.info('Sync completed successfully', {
        syncId,
        duration: `${duration}ms`,
        recordsProcessed: syncResult.totalProcessed,
        recordsInserted: syncResult.inserted
      });

      return {
        success: true,
        syncId,
        duration,
        recordsProcessed: syncResult.totalProcessed,
        recordsInserted: syncResult.inserted,
        transformationErrors: transformationResult.errors.length
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      await this.updateSyncStats(startTime, 0, false);

      syncLogger.error('Sync failed', {
        syncId,
        duration: `${duration}ms`,
        error: error.message
      });

      throw error;
    } finally {
      this.isRunning = false;
      this.lastSyncTime = new Date();
    }
  }

  // Sync transformed records to Supabase
  async syncToSupabase(transformedRecords) {
    try {
      if (!Array.isArray(transformedRecords) || transformedRecords.length === 0) {
        return { totalProcessed: 0, inserted: 0 };
      }

      syncLogger.info('Starting Supabase sync', {
        recordCount: transformedRecords.length,
        batchSize: this.batchSize
      });

      // Process in batches
      const batches = [];
      for (let i = 0; i < transformedRecords.length; i += this.batchSize) {
        batches.push(transformedRecords.slice(i, i + this.batchSize));
      }

      let totalInserted = 0;
      let totalProcessed = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        const totalBatches = batches.length;

        try {
          syncLogger.debug(`Processing batch ${batchNumber}/${totalBatches}`, {
            batchSize: batch.length
          });

          const result = await supabaseClient.upsertCustomerOrders(batch);
          
          totalInserted += result.inserted;
          totalProcessed += result.totalProcessed;

          syncLogger.debug(`Batch ${batchNumber} completed`, {
            inserted: result.inserted,
            totalProcessed: result.totalProcessed
          });

        } catch (batchError) {
          syncLogger.error(`Batch ${batchNumber} failed`, {
            error: batchError.message,
            batchSize: batch.length
          });

          // Continue with next batch instead of failing completely
          totalProcessed += batch.length;
        }

        // Small delay between batches to be respectful
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      syncLogger.info('Supabase sync completed', {
        totalProcessed,
        totalInserted,
        batchesProcessed: batches.length
      });

      return {
        totalProcessed,
        inserted: totalInserted
      };

    } catch (error) {
      syncLogger.error('Supabase sync failed', {
        error: error.message,
        recordCount: transformedRecords.length
      });
      throw error;
    }
  }

  // Update sync statistics
  async updateSyncStats(startTime, recordsProcessed, success) {
    const duration = Date.now() - startTime;
    
    this.syncStats.totalSyncs++;
    this.syncStats.totalRecordsProcessed += recordsProcessed;
    this.syncStats.lastSyncDuration = duration;

    if (success) {
      this.syncStats.successfulSyncs++;
    } else {
      this.syncStats.failedSyncs++;
    }

    // Calculate average sync duration
    this.syncStats.averageSyncDuration = 
      (this.syncStats.averageSyncDuration * (this.syncStats.totalSyncs - 1) + duration) / 
      this.syncStats.totalSyncs;
  }

  // Get sync status
  getSyncStatus() {
    return {
      isRunning: this.isRunning,
      lastSyncTime: this.lastSyncTime,
      syncStats: this.syncStats,
      config: {
        syncInterval: this.syncInterval,
        batchSize: this.batchSize,
        maxRetries: this.maxRetries,
        scheduledSyncEnabled: process.env.ENABLE_REAL_TIME_SYNC === 'true'
      }
    };
  }

  // Get detailed sync statistics
  async getDetailedStats() {
    try {
      const dbStats = await supabaseClient.getSyncStats();
      
      return {
        ...this.syncStats,
        databaseStats: dbStats,
        lastSyncTimestamp: await supabaseClient.getLastSyncTimestamp()
      };
    } catch (error) {
      syncLogger.error('Failed to get detailed stats', { error: error.message });
      return {
        ...this.syncStats,
        error: error.message
      };
    }
  }

  // Manual sync trigger
  async triggerManualSync(options = {}) {
    if (this.isRunning) {
      throw new Error('Sync already in progress');
    }

    return this.performSync(options);
  }

  // Cleanup old records
  async cleanupOldRecords(daysToKeep = 90) {
    try {
      syncLogger.info('Starting cleanup of old records', { daysToKeep });
      
      const result = await supabaseClient.cleanupOldRecords(daysToKeep);
      
      syncLogger.info('Cleanup completed', {
        deletedCount: result.deletedCount,
        cutoffDate: result.cutoffDate
      });

      return result;
    } catch (error) {
      syncLogger.error('Cleanup failed', { error: error.message });
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown() {
    try {
      syncLogger.info('Shutting down data sync service');
      
      // Stop scheduled sync
      this.stopScheduledSync();
      
      // Wait for any running sync to complete
      if (this.isRunning) {
        syncLogger.info('Waiting for current sync to complete');
        let attempts = 0;
        while (this.isRunning && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }
      }
      
      syncLogger.info('Data sync service shutdown complete');
    } catch (error) {
      syncLogger.error('Error during shutdown', { error: error.message });
    }
  }
}

// Export singleton instance
module.exports = new DataSyncService(); 