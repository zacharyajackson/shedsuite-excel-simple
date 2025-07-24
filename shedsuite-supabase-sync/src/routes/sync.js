const express = require('express');
const { syncLogger } = require('../utils/logger');
const dataSyncService = require('../services/data-sync-service');

const router = express.Router();

// Manual sync trigger
router.post('/trigger', async (req, res) => {
  try {
    const { fullSync = false, filters = {} } = req.body;
    
    syncLogger.info('Manual sync triggered', {
      fullSync,
      filters,
      requestId: req.id
    });

    const result = await dataSyncService.triggerManualSync({
      fullSync,
      filters
    });

    res.json({
      success: true,
      message: 'Sync triggered successfully',
      data: result
    });

  } catch (error) {
    syncLogger.error('Manual sync trigger failed', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to trigger sync',
      error: error.message
    });
  }
});

// Get sync status
router.get('/status', async (req, res) => {
  try {
    const status = dataSyncService.getSyncStatus();
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    syncLogger.error('Failed to get sync status', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get sync status',
      error: error.message
    });
  }
});

// Get detailed sync statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await dataSyncService.getDetailedStats();
    
    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    syncLogger.error('Failed to get sync stats', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get sync statistics',
      error: error.message
    });
  }
});

// Start scheduled sync
router.post('/schedule/start', async (req, res) => {
  try {
    const { intervalMinutes } = req.body;
    
    if (intervalMinutes) {
      dataSyncService.syncInterval = parseInt(intervalMinutes);
    }
    
    dataSyncService.startScheduledSync();
    
    syncLogger.info('Scheduled sync started', {
      intervalMinutes: dataSyncService.syncInterval,
      requestId: req.id
    });

    res.json({
      success: true,
      message: 'Scheduled sync started successfully',
      data: {
        intervalMinutes: dataSyncService.syncInterval
      }
    });

  } catch (error) {
    syncLogger.error('Failed to start scheduled sync', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to start scheduled sync',
      error: error.message
    });
  }
});

// Stop scheduled sync
router.post('/schedule/stop', async (req, res) => {
  try {
    dataSyncService.stopScheduledSync();
    
    syncLogger.info('Scheduled sync stopped', { requestId: req.id });

    res.json({
      success: true,
      message: 'Scheduled sync stopped successfully'
    });

  } catch (error) {
    syncLogger.error('Failed to stop scheduled sync', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to stop scheduled sync',
      error: error.message
    });
  }
});

// Cleanup old records
router.post('/cleanup', async (req, res) => {
  try {
    const { daysToKeep = 90 } = req.body;
    
    syncLogger.info('Cleanup requested', {
      daysToKeep,
      requestId: req.id
    });

    const result = await dataSyncService.cleanupOldRecords(daysToKeep);

    res.json({
      success: true,
      message: 'Cleanup completed successfully',
      data: result
    });

  } catch (error) {
    syncLogger.error('Cleanup failed', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to cleanup old records',
      error: error.message
    });
  }
});

// Test connections
router.get('/test-connections', async (req, res) => {
  try {
    syncLogger.info('Testing connections', { requestId: req.id });

    await dataSyncService.testConnections();

    res.json({
      success: true,
      message: 'All connections are healthy'
    });

  } catch (error) {
    syncLogger.error('Connection test failed', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message
    });
  }
});

// Get sync configuration
router.get('/config', async (req, res) => {
  try {
    const config = {
      syncInterval: dataSyncService.syncInterval,
      batchSize: dataSyncService.batchSize,
      maxRetries: dataSyncService.maxRetries,
      retryDelay: dataSyncService.retryDelay,
      scheduledSyncEnabled: process.env.ENABLE_REAL_TIME_SYNC === 'true',
      environment: {
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL
      }
    };

    res.json({
      success: true,
      data: config
    });

  } catch (error) {
    syncLogger.error('Failed to get sync config', {
      error: error.message,
      requestId: req.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get sync configuration',
      error: error.message
    });
  }
});

module.exports = { syncRouter: router }; 