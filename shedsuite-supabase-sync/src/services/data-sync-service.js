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
    console.log('🔧 DataSyncService.initialize() - Starting initialization');
    const initStartTime = Date.now();
    try {
      console.log('🔧 DataSyncService.initialize() - About to log initialization info');
      syncLogger.info('🔧 Initializing data sync service', {
        timestamp: new Date().toISOString(),
        syncInterval: this.syncInterval,
        batchSize: this.batchSize,
        enableRealTimeSync: process.env.ENABLE_REAL_TIME_SYNC === 'true',
        skipConnectionTests: process.env.SKIP_CONNECTION_TESTS === 'true'
      });
      console.log('🔧 DataSyncService.initialize() - Initialization info logged');

      // Test connections (optional - can be disabled for faster startup)
      if (process.env.SKIP_CONNECTION_TESTS !== 'true') {
        console.log('🔧 DataSyncService.initialize() - Connection tests enabled');
        syncLogger.info('📋 Testing connections...', { timestamp: new Date().toISOString() });
        const connectionTestStartTime = Date.now();
        await this.testConnections();
        const connectionTestDuration = Date.now() - connectionTestStartTime;
        syncLogger.info('✅ Connection tests completed', { 
          timestamp: new Date().toISOString(),
          duration: `${connectionTestDuration}ms`
        });
        console.log('🔧 DataSyncService.initialize() - Connection tests completed');
      } else {
        console.log('🔧 DataSyncService.initialize() - Skipping connection tests');
        syncLogger.info('⏭️ Skipping connection tests (SKIP_CONNECTION_TESTS=true)', { timestamp: new Date().toISOString() });
      }

      // Start scheduled sync if enabled
      console.log('🔧 DataSyncService.initialize() - Checking ENABLE_REAL_TIME_SYNC:', process.env.ENABLE_REAL_TIME_SYNC);
      if (process.env.ENABLE_REAL_TIME_SYNC === 'true') {
        console.log('🔧 DataSyncService.initialize() - Starting scheduled sync');
        syncLogger.info('📋 Starting scheduled sync...', { timestamp: new Date().toISOString() });
        const scheduledSyncStartTime = Date.now();
        this.startScheduledSync();
        const scheduledSyncDuration = Date.now() - scheduledSyncStartTime;
        syncLogger.info('✅ Scheduled sync started', { 
          timestamp: new Date().toISOString(),
          duration: `${scheduledSyncDuration}ms`
        });
        console.log('🔧 DataSyncService.initialize() - Scheduled sync started');
      } else {
        console.log('🔧 DataSyncService.initialize() - Scheduled sync disabled');
        syncLogger.info('⏭️ Scheduled sync disabled (ENABLE_REAL_TIME_SYNC=false)', { timestamp: new Date().toISOString() });
      }

      const totalInitDuration = Date.now() - initStartTime;
      console.log('🔧 DataSyncService.initialize() - Initialization completed successfully');
      console.log('🔧 DataSyncService.initialize() - Service is ready for continuous operation');
      syncLogger.info('✅ Data sync service initialized successfully', { 
        timestamp: new Date().toISOString(),
        totalDuration: `${totalInitDuration}ms`,
        syncInterval: this.syncInterval,
        batchSize: this.batchSize,
        enableRealTimeSync: process.env.ENABLE_REAL_TIME_SYNC === 'true'
      });
    } catch (error) {
      console.log('🔧 DataSyncService.initialize() - Error during initialization:', error.message);
      const totalInitDuration = Date.now() - initStartTime;
      syncLogger.error('❌ Failed to initialize data sync service', { 
        timestamp: new Date().toISOString(),
        totalDuration: `${totalInitDuration}ms`,
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }

  // Test API and database connections
  async testConnections() {
    try {
      syncLogger.info('Testing connections...');
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        throw new Error('Connection test timed out after 30 seconds');
      }, 30000);

      try {
        // Test ShedSuite API
        syncLogger.info('Testing ShedSuite API connection...');
        const apiHealth = await shedsuiteAPI.healthCheck();
        if (apiHealth.status !== 'healthy') {
          throw new Error(`ShedSuite API health check failed: ${apiHealth.error}`);
        }

        // Test Supabase connection
        syncLogger.info('Testing Supabase connection...');
        const dbHealth = await supabaseClient.healthCheck();
        if (dbHealth.status !== 'healthy') {
          throw new Error(`Supabase health check failed: ${dbHealth.error}`);
        }

        clearTimeout(timeout);
        syncLogger.info('All connections tested successfully');
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (error) {
      syncLogger.error('Connection test failed', { error: error.message });
      throw error;
    }
  }

  // Start scheduled sync
  startScheduledSync() {
    console.log('🔧 startScheduledSync() - Starting scheduled sync setup');
    const setupStartTime = Date.now();
    const cronExpression = `*/${this.syncInterval} * * * *`;
    
    console.log('🔧 startScheduledSync() - Cron expression:', cronExpression);
    console.log('🔧 startScheduledSync() - Sync interval:', this.syncInterval, 'minutes');
    
    syncLogger.info('📅 Setting up scheduled sync', {
      timestamp: new Date().toISOString(),
      cronExpression,
      intervalMinutes: this.syncInterval
    });
    
    // Log when the next sync will run
    const now = new Date();
    const nextRun = new Date(now.getTime() + (this.syncInterval * 60 * 1000));
    console.log('🔧 startScheduledSync() - Next run time:', nextRun.toISOString());
    console.log('🔧 startScheduledSync() - Sync will run every', this.syncInterval, 'minutes');
    syncLogger.info('⏰ Next scheduled sync will run at', {
      timestamp: new Date().toISOString(),
      nextRunTime: nextRun.toISOString(),
      minutesFromNow: this.syncInterval,
      cronExpression: cronExpression
    });
    
    console.log('🔧 startScheduledSync() - About to create cron job');
    console.log('🔧 startScheduledSync() - Validating cron expression:', cronExpression);
    
    // Validate the cron expression
    if (!cron.validate(cronExpression)) {
      console.error('🔧 startScheduledSync() - Invalid cron expression:', cronExpression);
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }
    console.log('🔧 startScheduledSync() - Cron expression is valid');
    
    this.cronJob = cron.schedule(cronExpression, async () => {
      console.log('🔧 CRON JOB TRIGGERED! - Starting scheduled sync at:', new Date().toISOString());
      console.log('🔧 startScheduledSync() - Cron job triggered!');
      const syncStartTime = Date.now();
      try {
        console.log('🔧 startScheduledSync() - About to call performSync()');
        syncLogger.info('🔄 Scheduled sync triggered', { timestamp: new Date().toISOString() });
        await this.performSync();
        console.log('🔧 startScheduledSync() - performSync() completed successfully');
        const syncDuration = Date.now() - syncStartTime;
        syncLogger.info('✅ Scheduled sync completed', { 
          timestamp: new Date().toISOString(),
          duration: `${syncDuration}ms`
        });
        console.log('🔧 startScheduledSync() - Scheduled sync completed successfully');
      } catch (error) {
        console.log('🔧 startScheduledSync() - performSync() failed with error:', error.message);
        const syncDuration = Date.now() - syncStartTime;
        syncLogger.error('❌ Scheduled sync failed', { 
          timestamp: new Date().toISOString(),
          duration: `${syncDuration}ms`,
          error: error.message,
          stack: error.stack
        });
        console.log('🔧 startScheduledSync() - Scheduled sync failed:', error.message);
        // Don't throw the error to prevent cron job from stopping
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    // Verify cron job was created successfully
    if (!this.cronJob) {
      throw new Error('Failed to create cron job');
    }
    console.log('🔧 startScheduledSync() - Cron job object created:', typeof this.cronJob);
    console.log('🔧 startScheduledSync() - Cron job running status:', this.cronJob.running);

    // Add a heartbeat log every 30 seconds for debugging (more frequent in production to catch hanging issues)
    const heartbeatInterval = process.env.NODE_ENV === 'production' ? 30 * 1000 : 5 * 60 * 1000; // 30 sec in prod, 5 min in dev
    setInterval(() => {
      const now = new Date();
      const nextSync = new Date(now.getTime() + (this.syncInterval * 60 * 1000));
      console.log('💓 Service heartbeat - Next sync scheduled for:', nextSync.toISOString());
      syncLogger.info('💓 Service heartbeat', {
        timestamp: now.toISOString(),
        nextSyncTime: nextSync.toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      });
    }, heartbeatInterval);

    // Send immediate heartbeat to confirm service is alive
    console.log('💓 Service heartbeat - Initial heartbeat sent');
    syncLogger.info('💓 Service heartbeat - Initial heartbeat sent', {
      timestamp: new Date().toISOString(),
      nextSyncTime: nextRun.toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    });

    console.log('🔧 startScheduledSync() - Cron job created successfully');
    console.log('🔧 startScheduledSync() - Cron job is active and waiting for next trigger');
    const setupDuration = Date.now() - setupStartTime;
    syncLogger.info('✅ Scheduled sync started', {
      timestamp: new Date().toISOString(),
      setupDuration: `${setupDuration}ms`,
      cronExpression,
      intervalMinutes: this.syncInterval,
      nextRunTime: nextRun.toISOString()
    });
    console.log('🔧 startScheduledSync() - Scheduled sync setup completed');
    
    // Optional: Test the cron job immediately to verify it works (temporarily enabled for debugging)
    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_INITIAL_TEST_SYNC === 'true' || true) {
      console.log('🔧 startScheduledSync() - Testing cron job immediately...');
      setTimeout(async () => {
        try {
          console.log('🔧 startScheduledSync() - Triggering test sync...');
          await this.performSync();
          console.log('🔧 startScheduledSync() - Test sync completed successfully');
        } catch (error) {
          console.log('🔧 startScheduledSync() - Test sync failed:', error.message);
          syncLogger.error('Initial test sync failed', { 
            timestamp: new Date().toISOString(),
            error: error.message 
          });
          // Don't throw the error to prevent application shutdown
        }
      }, 5000); // Test after 5 seconds
    } else {
      console.log('🔧 startScheduledSync() - Skipping initial test sync (production mode)');
      console.log('🔧 startScheduledSync() - Current time:', new Date().toISOString());
      console.log('🔧 startScheduledSync() - First sync will occur at:', nextRun.toISOString());
      syncLogger.info('⏭️ Skipping initial test sync (production mode)', { 
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV,
        firstSyncTime: nextRun.toISOString()
      });
      
      // Test the cron job immediately to verify it works (but don't run full sync)
      console.log('🔧 startScheduledSync() - Testing cron job functionality...');
      setTimeout(() => {
        console.log('🔧 startScheduledSync() - Testing cron job trigger...');
        if (this.cronJob && typeof this.cronJob.fireOnTick === 'function') {
          console.log('🔧 startScheduledSync() - Manually triggering cron job to test...');
          this.cronJob.fireOnTick();
          console.log('🔧 startScheduledSync() - Cron job test trigger completed');
        } else {
          console.log('🔧 startScheduledSync() - ERROR - Cron job not properly initialized');
        }
      }, 3000);
    }
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
      console.log('🔧 performSync() - Starting sync operation with ID:', syncId);
      syncLogger.info('Starting sync operation', { syncId, options });

      // Get last sync timestamp
      console.log('🔧 performSync() - Getting last sync timestamp...');
      const lastSyncTimestamp = await supabaseClient.getLastSyncTimestamp();
      console.log('🔧 performSync() - Last sync timestamp:', lastSyncTimestamp);
      
      // Build filters for incremental sync
      const filters = {};
      if (lastSyncTimestamp && !options.fullSync) {
        filters.updated_after = lastSyncTimestamp;
        console.log('🔧 performSync() - Performing incremental sync with filters:', filters);
        syncLogger.info('Performing incremental sync', { lastSyncTimestamp });
      } else {
        console.log('🔧 performSync() - Performing full sync');
        syncLogger.info('Performing full sync');
      }

      // Fetch records from ShedSuite API
      console.log('🔧 performSync() - Fetching records from ShedSuite API...');
      const rawRecords = await shedsuiteAPI.fetchAllRecords(filters);
      console.log('🔧 performSync() - Raw records fetched:', rawRecords ? rawRecords.length : 'null');
      
      // Log operation scale
      if (rawRecords && rawRecords.length > 0) {
        const scale = rawRecords.length < 100 ? 'small' : rawRecords.length < 1000 ? 'medium' : 'large';
        console.log(`🔧 performSync() - Operation scale: ${scale} (${rawRecords.length} records)`);
      }
      
      // Log sample of raw records to see actual data
      if (rawRecords && rawRecords.length > 0) {
        console.log('🔧 performSync() - Sample raw record:', JSON.stringify(rawRecords[0], null, 2));
        console.log('🔧 performSync() - Raw records summary:', {
          count: rawRecords.length,
          firstRecordId: rawRecords[0]?.id || 'unknown',
          lastRecordId: rawRecords[rawRecords.length - 1]?.id || 'unknown',
          recordKeys: Object.keys(rawRecords[0] || {})
        });
        
        // Log record ID ranges for better tracking in production
        const firstFewIds = rawRecords.slice(0, 5).map(record => record.id);
        const lastFewIds = rawRecords.slice(-5).map(record => record.id);
        console.log('🔧 performSync() - Record ID range:', {
          totalRecords: rawRecords.length,
          first5Ids: firstFewIds,
          last5Ids: lastFewIds,
          idRange: `${rawRecords[0]?.id} to ${rawRecords[rawRecords.length - 1]?.id}`
        });
        
        // Log key data points from first record
        const firstRecord = rawRecords[0];
        console.log('🔧 performSync() - First record details:', {
          id: firstRecord.id,
          customerName: firstRecord.customerName,
          orderNumber: firstRecord.orderNumber,
          status: firstRecord.status,
          totalAmount: firstRecord.totalAmountDollarAmount,
          dateOrdered: firstRecord.dateOrdered
        });
      }
      
      if (!rawRecords || rawRecords.length === 0) {
        console.log('🔧 performSync() - No records to sync');
        syncLogger.info('No records to sync');
        await this.updateSyncStats(startTime, 0, true);
        return {
          success: true,
          recordsProcessed: 0,
          message: 'No records to sync'
        };
      }

      // Transform records
      console.log('🔧 performSync() - Transforming records...');
      const transformationResult = dataTransformer.transformBatch(rawRecords, 'shedsuite_orders');
      console.log('🔧 performSync() - Transformation result:', {
        total: rawRecords.length,
        transformed: transformationResult.transformed.length,
        errors: transformationResult.errors.length
      });
      
      // Log sample of transformed records
      if (transformationResult.transformed && transformationResult.transformed.length > 0) {
        console.log('🔧 performSync() - Sample transformed record:', JSON.stringify(transformationResult.transformed[0], null, 2));
        console.log('🔧 performSync() - Transformed records summary:', {
          count: transformationResult.transformed.length,
          firstRecordId: transformationResult.transformed[0]?.id || 'unknown',
          lastRecordId: transformationResult.transformed[transformationResult.transformed.length - 1]?.id || 'unknown',
          transformedKeys: Object.keys(transformationResult.transformed[0] || {})
        });
      }
      
      // Log transformation errors if any
      if (transformationResult.errors && transformationResult.errors.length > 0) {
        console.log('🔧 performSync() - Transformation errors:', transformationResult.errors);
        syncLogger.warn('Some records failed transformation', {
          totalRecords: rawRecords.length,
          transformedCount: transformationResult.transformed.length,
          errorCount: transformationResult.errors.length,
          errors: transformationResult.errors
        });
      }

      // Sync to Supabase in batches
      console.log('🔧 performSync() - Syncing to Supabase...');
      const syncResult = await this.syncToSupabase(transformationResult.transformed);
      console.log('🔧 performSync() - Supabase sync result:', syncResult);

      // Update sync timestamp
      console.log('🔧 performSync() - Updating sync timestamp...');
      await supabaseClient.updateSyncTimestamp();

      const duration = Date.now() - startTime;
      await this.updateSyncStats(startTime, syncResult.totalProcessed, true);

      console.log('🔧 performSync() - Sync completed successfully');
      const recordsPerSecond = rawRecords ? Math.round((rawRecords.length / (duration / 1000)) * 100) / 100 : 0;
      console.log('🔧 performSync() - FINAL SYNC SUMMARY:', {
        syncId: syncId,
        duration: `${duration}ms`,
        totalRecordsFromShedSuite: rawRecords ? rawRecords.length : 0,
        recordsTransformed: transformationResult.transformed.length,
        transformationErrors: transformationResult.errors.length,
        recordsUpsertedToSupabase: syncResult.totalProcessed,
        newRecordsInserted: syncResult.inserted,
        existingRecordsUpdated: syncResult.totalProcessed - syncResult.inserted,
        recordsPerSecond: recordsPerSecond,
        syncTimestamp: new Date().toISOString()
      });
      
      syncLogger.info('Sync completed successfully', {
        syncId,
        duration: `${duration}ms`,
        recordsProcessed: syncResult.totalProcessed,
        recordsInserted: syncResult.inserted,
        totalRecordsFromShedSuite: rawRecords ? rawRecords.length : 0,
        transformationErrors: transformationResult.errors.length,
        existingRecordsUpdated: syncResult.totalProcessed - syncResult.inserted
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
        error: error.message,
        stack: error.stack
      });

      // Don't throw the error to prevent application shutdown
      console.log('🔧 performSync() - Sync failed but continuing:', error.message);
      return {
        success: false,
        syncId,
        duration,
        error: error.message
      };
    } finally {
      this.isRunning = false;
      this.lastSyncTime = new Date();
    }
  }

  // Sync transformed records to Supabase
  async syncToSupabase(transformedRecords) {
    try {
      console.log('🔧 syncToSupabase() - Starting Supabase sync with', transformedRecords.length, 'records');
      
      if (!Array.isArray(transformedRecords) || transformedRecords.length === 0) {
        console.log('🔧 syncToSupabase() - No records to sync');
        return { totalProcessed: 0, inserted: 0 };
      }

      // Log deduplication information
      const uniqueIds = new Set(transformedRecords.map(record => record.id));
      const duplicateCount = transformedRecords.length - uniqueIds.size;
      console.log(`🔧 syncToSupabase() - Found ${duplicateCount} duplicate records out of ${transformedRecords.length} total records`);
      syncLogger.info('Deduplication analysis', {
        totalRecords: transformedRecords.length,
        uniqueRecords: uniqueIds.size,
        duplicateRecords: duplicateCount,
        duplicatePercentage: ((duplicateCount / transformedRecords.length) * 100).toFixed(2) + '%'
      });

      syncLogger.info('Starting Supabase sync', {
        recordCount: transformedRecords.length,
        uniqueRecords: uniqueIds.size,
        duplicateRecords: duplicateCount,
        batchSize: this.batchSize
      });

      // Process in batches
      const batches = [];
      for (let i = 0; i < transformedRecords.length; i += this.batchSize) {
        batches.push(transformedRecords.slice(i, i + this.batchSize));
      }

      console.log('🔧 syncToSupabase() - Created', batches.length, 'batches of size', this.batchSize);

      let totalInserted = 0;
      let totalProcessed = 0;
      let totalDuplicatesInSupabase = 0; // Track how many records were updated vs inserted

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        const totalBatches = batches.length;
        const progressPercent = ((batchNumber / totalBatches) * 100).toFixed(1);

        console.log(`🔧 syncToSupabase() - Processing batch ${batchNumber}/${totalBatches} (${progressPercent}%) with ${batch.length} records`);
        
        // Log batch summary for production scale
        if (batch.length > 0) {
          const batchIds = batch.map(record => record.id);
          console.log(`🔧 syncToSupabase() - Batch ${batchNumber} summary:`, {
            batchSize: batch.length,
            recordIds: batchIds.length <= 10 ? batchIds : `${batchIds.slice(0, 5).join(', ')} ... ${batchIds.slice(-5).join(', ')}`,
            idRange: `${batchIds[0]} to ${batchIds[batchIds.length - 1]}`
          });
        }

        try {
          syncLogger.debug(`Processing batch ${batchNumber}/${totalBatches}`, {
            batchSize: batch.length
          });

          console.log(`🔧 syncToSupabase() - Calling supabaseClient.upsertCustomerOrders() for batch ${batchNumber}`);
          const result = await supabaseClient.upsertCustomerOrders(batch);
          console.log(`🔧 syncToSupabase() - Batch ${batchNumber} result:`, result);
          
          totalInserted += result.inserted;
          totalProcessed += result.totalProcessed;

          console.log(`🔧 syncToSupabase() - Batch ${batchNumber} completed: inserted=${result.inserted}, processed=${result.totalProcessed}`);
          syncLogger.debug(`Batch ${batchNumber} completed`, {
            inserted: result.inserted,
            totalProcessed: result.totalProcessed
          });

        } catch (batchError) {
          console.log(`🔧 syncToSupabase() - Batch ${batchNumber} failed with error:`, batchError.message);
          syncLogger.error(`Batch ${batchNumber} failed`, {
            error: batchError.message,
            batchSize: batch.length,
            stack: batchError.stack
          });

          // Continue with next batch instead of failing completely
          totalProcessed += batch.length;
        }

        // Small delay between batches to be respectful
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log('🔧 syncToSupabase() - All batches completed. Final result:', {
        totalProcessed,
        totalInserted,
        batchesProcessed: batches.length,
        duplicatesInSupabase: totalProcessed - totalInserted,
        averageBatchSize: Math.round(totalProcessed / batches.length),
        successRate: `${((totalInserted / totalProcessed) * 100).toFixed(1)}%`
      });

      syncLogger.info('Supabase sync completed', {
        totalProcessed,
        totalInserted,
        batchesProcessed: batches.length,
        duplicatesInSupabase: totalProcessed - totalInserted,
        newRecords: totalInserted,
        updatedRecords: totalProcessed - totalInserted
      });

      return {
        totalProcessed,
        inserted: totalInserted
      };

    } catch (error) {
      console.log('🔧 syncToSupabase() - Supabase sync failed with error:', error.message);
      syncLogger.error('Supabase sync failed', {
        error: error.message,
        recordCount: transformedRecords.length,
        stack: error.stack
      });
      // Don't throw the error to prevent application shutdown
      return { totalProcessed: transformedRecords.length, inserted: 0 };
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