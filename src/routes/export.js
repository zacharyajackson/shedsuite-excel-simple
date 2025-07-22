const express = require('express');
const { logger } = require('../utils/logger');
const shedsuite = require('../services/shedsuite');
const excel = require('../services/excel');
const monitoringService = require('../services/monitor');

const router = express.Router();

// Input validation middleware
const validatePagination = (req, res, next) => {
  const { page, pageSize } = req.query;

  if (page && (isNaN(page) || parseInt(page) < 1)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid page parameter. Must be a positive integer.'
    });
  }

  if (pageSize && (isNaN(pageSize) || parseInt(pageSize) < 1 || parseInt(pageSize) > 1000)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pageSize parameter. Must be between 1 and 1000.'
    });
  }

  next();
};

// Rate limiting for expensive operations
const expensiveOperationLimiter = (req, res, next) => {
  // This could be enhanced with Redis for distributed rate limiting
  const userKey = req.ip;
  const now = Date.now();

  // Simple in-memory rate limiting (production should use Redis)
  if (!req.app.locals.rateLimitStore) {
    req.app.locals.rateLimitStore = new Map();
  }

  const userRequests = req.app.locals.rateLimitStore.get(userKey) || [];
  const recentRequests = userRequests.filter(time => now - time < 60000); // Last minute

  if (recentRequests.length >= 5) { // Max 5 requests per minute
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait before retrying.',
      retryAfter: 60
    });
  }

  recentRequests.push(now);
  req.app.locals.rateLimitStore.set(userKey, recentRequests);
  next();
};

// GET /api/export/orders - Export orders with optional filtering and sync
router.get('/orders', validatePagination, async (req, res) => {
  const startTime = Date.now();

  try {
    const filters = {
      updatedAfter: req.query.updatedAfter,
      status: req.query.status,
      page: req.query.page ? parseInt(req.query.page) : undefined,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize) : undefined,
      // Add more filters as needed
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) {
        delete filters[key];
      }
    });

    logger.info('Starting export with filters:', { filters, ip: req.ip });

    const records = await shedsuite.fetchAllRecords(filters);
    const formattedRecords = shedsuite.formatRecordsForExport(records);

    let excelSyncStatus = 'not_requested';

    // Update Excel spreadsheet if sync is requested
    if (req.query.sync === 'true') {
      try {
        await excel.updateSpreadsheet(formattedRecords);
        excelSyncStatus = 'completed';
        logger.info('Excel spreadsheet updated successfully');
      } catch (excelError) {
        excelSyncStatus = 'failed';
        logger.error('Error updating Excel:', excelError);
        // Continue with the response even if Excel sync fails
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Export completed in ${duration}ms for ${formattedRecords.length} records`);

    res.json({
      success: true,
      count: formattedRecords.length,
      data: formattedRecords,
      excel_sync: excelSyncStatus,
      metadata: {
        duration: `${duration}ms`,
        filters,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Export failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: 'Export failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred during export',
      duration: `${duration}ms`
    });
  }
});

// GET /api/export/orders/count - Get total record count
router.get('/orders/count', async (req, res) => {
  try {
    const count = await shedsuite.getTotalRecordCount();

    res.json({
      success: true,
      count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get count',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to retrieve record count'
    });
  }
});

// POST /api/export/sync - Manual Excel sync
router.post('/sync', expensiveOperationLimiter, async (req, res) => {
  const startTime = Date.now();

  try {
    logger.info('Starting manual Excel sync', { ip: req.ip });

    // Allow filtering for partial syncs
    const filters = req.body.filters || {};

    // Fetch latest records
    const records = await shedsuite.fetchAllRecords(filters);
    const formattedRecords = shedsuite.formatRecordsForExport(records);

    // Update Excel
    await excel.updateSpreadsheet(formattedRecords);

    const duration = Date.now() - startTime;
    logger.info(`Manual sync completed in ${duration}ms`);

    res.json({
      success: true,
      message: 'Excel sync completed successfully',
      records_synced: formattedRecords.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Manual sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: 'Sync failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Sync operation failed',
      duration: `${duration}ms`
    });
  }
});

// POST /api/export/monitor/start - Start monitoring service
router.post('/monitor/start', async (req, res) => {
  try {
    const options = {
      pollingIntervalMs: req.body.pollingIntervalMs,
      cronSchedule: req.body.cronSchedule,
      fullSyncInterval: req.body.fullSyncInterval,
      enablePerformanceLogging: req.body.enablePerformanceLogging
    };

    // Remove undefined options
    Object.keys(options).forEach(key => {
      if (options[key] === undefined) {
        delete options[key];
      }
    });

    await monitoringService.start(options);

    res.json({
      success: true,
      message: 'Monitoring service started successfully',
      config: monitoringService.getStatus().config
    });
  } catch (error) {
    logger.error('Error starting monitoring service:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start monitoring service',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to start monitoring'
    });
  }
});

// POST /api/export/monitor/stop - Stop monitoring service
router.post('/monitor/stop', (req, res) => {
  try {
    monitoringService.stop();

    res.json({
      success: true,
      message: 'Monitoring service stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping monitoring service:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop monitoring service',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to stop monitoring'
    });
  }
});

// GET /api/export/monitor/status - Get monitoring service status
router.get('/monitor/status', (req, res) => {
  try {
    const status = monitoringService.getStatus();

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    logger.error('Error getting monitoring service status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get monitoring service status',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to get status'
    });
  }
});

// GET /api/export/monitor/metrics - Get performance metrics
router.get('/monitor/metrics', (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();

    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting monitoring metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get monitoring metrics',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to get metrics'
    });
  }
});

// POST /api/export/monitor/reset-stats - Reset monitoring statistics
router.post('/monitor/reset-stats', (req, res) => {
  try {
    monitoringService.resetStats();

    res.json({
      success: true,
      message: 'Monitoring statistics reset successfully'
    });
  } catch (error) {
    logger.error('Error resetting monitoring stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset monitoring statistics',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to reset stats'
    });
  }
});

// POST /api/export/monitor/force-sync - Force a sync check
router.post('/monitor/force-sync', expensiveOperationLimiter, async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.body.fullSync === true) {
      await monitoringService.forceFullSync(req.body.options || {});
    } else {
      await monitoringService.forceSyncCheck();
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: req.body.fullSync ? 'Full sync completed successfully' : 'Sync check completed successfully',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Force sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: 'Force sync failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Sync operation failed',
      duration: `${duration}ms`
    });
  }
});

// GET /api/export/health - Comprehensive health check
router.get('/health', async (req, res) => {
  try {
    const [shedsiteHealth, excelHealth] = await Promise.allSettled([
      shedsuite.healthCheck(),
      excel.healthCheck()
    ]);

    const overallHealth = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        shedsuite: shedsiteHealth.status === 'fulfilled'
          ? shedsiteHealth.value
          : {
            status: 'unhealthy',
            error: shedsiteHealth.reason?.message
          },
        excel: excelHealth.status === 'fulfilled'
          ? excelHealth.value
          : {
            status: 'unhealthy',
            error: excelHealth.reason?.message
          },
        monitoring: monitoringService.getStatus()
      }
    };

    // Determine overall status
    if (overallHealth.services.shedsuite.status !== 'healthy' ||
        overallHealth.services.excel.status !== 'healthy') {
      overallHealth.status = 'degraded';
    }

    const statusCode = overallHealth.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json({
      success: overallHealth.status === 'healthy',
      ...overallHealth
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = {
  exportRouter: router
};
