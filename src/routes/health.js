/**
 * Health check and monitoring endpoints
 */
const express = require('express');
const { logger } = require('../utils/logger');
const enhancedMonitor = require('../services/enhanced-monitor');
const systemMonitor = require('../utils/system-monitor');
const progressDashboard = require('../utils/progress-dashboard');
const notificationSystem = require('../utils/notification-system');

const router = express.Router();

/**
 * @route GET /health
 * @description Get basic health status
 * @access Public
 */
router.get('/', async (req, res) => {
  try {
    const healthStatus = await enhancedMonitor.forceHealthCheck();
    
    res.status(healthStatus.overall === 'healthy' ? 200 : 
              healthStatus.overall === 'degraded' ? 429 : 503)
       .json(healthStatus);
  } catch (error) {
    logger.error('Health check endpoint failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @route GET /health/detailed
 * @description Get detailed health status with component information
 * @access Public
 */
router.get('/detailed', async (req, res) => {
  try {
    const healthStatus = await enhancedMonitor.forceHealthCheck();
    const systemStatus = systemMonitor.getHealthStatus();
    const monitorStatus = enhancedMonitor.getStatus();
    
    const detailedStatus = {
      timestamp: new Date().toISOString(),
      status: healthStatus.overall,
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      components: {
        ...healthStatus.components,
        system: systemStatus
      },
      monitoring: {
        isRunning: monitorStatus.isRunning,
        lastCheck: monitorStatus.lastCheckTimestamp,
        lastFullSync: monitorStatus.lastFullSync,
        stats: {
          syncCount: monitorStatus.stats.syncCount,
          recordsProcessed: monitorStatus.stats.recordsProcessed,
          errors: monitorStatus.stats.errors,
          healthChecks: monitorStatus.stats.healthChecks
        }
      },
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    };
    
    res.status(healthStatus.overall === 'healthy' ? 200 : 
              healthStatus.overall === 'degraded' ? 429 : 503)
       .json(detailedStatus);
  } catch (error) {
    logger.error('Detailed health check endpoint failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @route GET /health/metrics
 * @description Get system metrics in JSON format
 * @access Public
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = enhancedMonitor.getMetrics();
    const systemMetrics = systemMonitor.getDetailedMetrics();
    
    res.json({
      timestamp: new Date().toISOString(),
      monitoring: metrics,
      system: systemMetrics
    });
  } catch (error) {
    logger.error('Metrics endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error.message
    });
  }
});

/**
 * @route GET /health/metrics/prometheus
 * @description Get system metrics in Prometheus format
 * @access Public
 */
router.get('/metrics/prometheus', (req, res) => {
  try {
    const metrics = enhancedMonitor.getPrometheusMetrics();
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Prometheus metrics endpoint failed:', error);
    res.status(500).send(`# Error: ${error.message}`);
  }
});

/**
 * @route GET /health/operations
 * @description Get active and recent operations
 * @access Public
 */
router.get('/operations', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status; // 'in_progress', 'completed', 'failed'
    const type = req.query.type;
    
    const operations = progressDashboard.getOperations({
      limit,
      status,
      type
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      count: operations.length,
      operations
    });
  } catch (error) {
    logger.error('Operations endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve operations',
      message: error.message
    });
  }
});

/**
 * @route GET /health/operations/:id
 * @description Get details for a specific operation
 * @access Public
 */
router.get('/operations/:id', (req, res) => {
  try {
    const operationId = req.params.id;
    const operation = progressDashboard.getOperation(operationId);
    
    if (!operation) {
      return res.status(404).json({
        error: 'Operation not found',
        operationId
      });
    }
    
    res.json(operation);
  } catch (error) {
    logger.error('Operation details endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve operation details',
      message: error.message
    });
  }
});

/**
 * @route GET /health/dashboard
 * @description Get dashboard summary
 * @access Public
 */
router.get('/dashboard', (req, res) => {
  try {
    const dashboard = progressDashboard.getDashboardSummary();
    
    res.json(dashboard);
  } catch (error) {
    logger.error('Dashboard endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve dashboard summary',
      message: error.message
    });
  }
});

/**
 * @route GET /health/alerts
 * @description Get active and recent alerts
 * @access Public
 */
router.get('/alerts', (req, res) => {
  try {
    const systemMetrics = systemMonitor.getDetailedMetrics();
    
    res.json({
      timestamp: new Date().toISOString(),
      activeAlerts: systemMetrics.alerts.active,
      recentAlerts: systemMetrics.alerts.recent
    });
  } catch (error) {
    logger.error('Alerts endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve alerts',
      message: error.message
    });
  }
});

/**
 * @route POST /health/alerts/:id/resolve
 * @description Resolve an active alert
 * @access Public
 */
router.post('/alerts/:id/resolve', (req, res) => {
  try {
    const alertId = req.params.id;
    const resolution = req.body.resolution || {};
    
    systemMonitor.resolveAlert(alertId, resolution);
    
    res.json({
      success: true,
      message: `Alert ${alertId} resolved`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Alert resolution endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to resolve alert',
      message: error.message
    });
  }
});

/**
 * @route GET /health/notifications
 * @description Get recent notifications
 * @access Public
 */
router.get('/notifications', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const notifications = notificationSystem.getNotificationHistory(limit);
    const stats = notificationSystem.getNotificationStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      stats,
      notifications
    });
  } catch (error) {
    logger.error('Notifications endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve notifications',
      message: error.message
    });
  }
});

/**
 * @route POST /health/test-notification
 * @description Send a test notification
 * @access Public
 */
router.post('/test-notification', async (req, res) => {
  try {
    const { level = 'info', title = 'Test Notification', message = 'This is a test notification' } = req.body;
    
    const result = await notificationSystem.sendNotification({
      level,
      title,
      message,
      details: {
        source: 'test-endpoint',
        timestamp: new Date().toISOString(),
        requestIp: req.ip
      }
    });
    
    res.json({
      success: result.success,
      notificationId: result.notificationId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Test notification endpoint failed:', error);
    res.status(500).json({
      error: 'Failed to send test notification',
      message: error.message
    });
  }
});

module.exports = { healthRouter: router };