const express = require('express');
const { logger } = require('../utils/logger');
const shedsuiteAPI = require('../services/shedsuite-api');
const supabaseClient = require('../services/supabase-client');
const dataSyncService = require('../services/data-sync-service');

const router = express.Router();

// Basic health check
router.get('/', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    res.json(healthStatus);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Detailed health check with all services
router.get('/detailed', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Check ShedSuite API
    const apiHealth = await shedsuiteAPI.healthCheck();
    
    // Check Supabase connection
    const dbHealth = await supabaseClient.healthCheck();
    
    // Get sync service status
    const syncStatus = dataSyncService.getSyncStatus();
    
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        shedsuiteAPI: apiHealth,
        supabase: dbHealth,
        syncService: {
          status: syncStatus.isRunning ? 'running' : 'idle',
          lastSyncTime: syncStatus.lastSyncTime,
          scheduledSyncEnabled: syncStatus.config.scheduledSyncEnabled
        }
      },
      responseTime: Date.now() - startTime
    };

    // Determine overall health status
    if (apiHealth.status !== 'healthy' || dbHealth.status !== 'healthy') {
      healthStatus.status = 'degraded';
    }

    res.json(healthStatus);
  } catch (error) {
    logger.error('Detailed health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Service-specific health checks
router.get('/api', async (req, res) => {
  try {
    const apiHealth = await shedsuiteAPI.healthCheck();
    res.json(apiHealth);
  } catch (error) {
    logger.error('API health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

router.get('/database', async (req, res) => {
  try {
    const dbHealth = await supabaseClient.healthCheck();
    res.json(dbHealth);
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

router.get('/sync', async (req, res) => {
  try {
    const syncStatus = dataSyncService.getSyncStatus();
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      isRunning: syncStatus.isRunning,
      lastSyncTime: syncStatus.lastSyncTime,
      scheduledSyncEnabled: syncStatus.config.scheduledSyncEnabled,
      stats: syncStatus.syncStats
    };

    res.json(healthStatus);
  } catch (error) {
    logger.error('Sync health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// System information
router.get('/system', async (req, res) => {
  try {
    const systemInfo = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      pid: process.pid,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };

    res.json(systemInfo);
  } catch (error) {
    logger.error('System info failed', { error: error.message });
    res.status(500).json({
      error: error.message
    });
  }
});

// Metrics endpoint (for Prometheus monitoring)
router.get('/metrics', async (req, res) => {
  try {
    const syncStatus = dataSyncService.getSyncStatus();
    const memory = process.memoryUsage();
    
    const metrics = {
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      memory_heap_used_bytes: memory.heapUsed,
      memory_heap_total_bytes: memory.heapTotal,
      memory_external_bytes: memory.external,
      memory_rss_bytes: memory.rss,
      sync_total_count: syncStatus.syncStats.totalSyncs,
      sync_successful_count: syncStatus.syncStats.successfulSyncs,
      sync_failed_count: syncStatus.syncStats.failedSyncs,
      sync_total_records_processed: syncStatus.syncStats.totalRecordsProcessed,
      sync_last_duration_ms: syncStatus.syncStats.lastSyncDuration,
      sync_average_duration_ms: syncStatus.syncStats.averageSyncDuration,
      sync_is_running: syncStatus.isRunning ? 1 : 0
    };

    res.json(metrics);
  } catch (error) {
    logger.error('Metrics failed', { error: error.message });
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = { healthRouter: router }; 