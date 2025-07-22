require('dotenv').config();
console.log('Starting application...');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { setupLogger, logger, requestLogger } = require('./utils/logger');

// Setup logger immediately
setupLogger();
console.log('Logger setup complete');

const { exportRouter } = require('./routes/export');
const { healthRouter } = require('./routes/health');
const enhancedMonitor = require('./services/enhanced-monitor');
const monitoringService = require('./services/monitor');
const shedsuite = require('./services/shedsuite');
const excel = require('./services/excel');
const systemMonitor = require('./utils/system-monitor');

// Validate required environment variables
const requiredEnvVars = [
  'API_BASE_URL',
  'API_TOKEN',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET'
];

console.log('Checking environment variables...');
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}
console.log('Environment variables validated');

// Initialize Express app
const app = express();

logger.info('Application starting...', {
  nodeEnv: process.env.NODE_ENV,
  apiBaseUrl: process.env.API_BASE_URL?.replace(/\/+$/, ''),
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*'
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      scriptSrc: ['\'self\''],
      imgSrc: ['\'self\'', 'data:', 'https:']
    }
  }
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', limiter);
// Add request logging middleware
app.use(requestLogger);

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      monitoring: monitoringService.getStatus(),
      version: process.env.npm_package_version || '2.0.0'
    };

    // Check external dependencies
    try {
      await shedsuite.getTotalRecordCount();
      healthStatus.shedsuite = 'connected';
    } catch (error) {
      healthStatus.shedsuite = 'disconnected';
      healthStatus.status = 'degraded';
    }

    res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Readiness probe
app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready' });
});

// Routes
app.use('/api/export', exportRouter);
app.use('/api/health', healthRouter);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handling middleware
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown'
  });
});

// Import enhanced graceful shutdown handler
const gracefulShutdown = require('./utils/graceful-shutdown');

// Initialize graceful shutdown handler with timeout from environment or default
gracefulShutdown.initGracefulShutdown({
  timeout: process.env.GRACEFUL_SHUTDOWN_TIMEOUT ? 
           parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT) : 30000
});

// Register error handlers for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // The graceful shutdown handler will take care of the exit process
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // The graceful shutdown handler will take care of the exit process
});

async function startServices() {
  try {
    logger.info('Starting services initialization...');

    // Test connections first
    logger.info('Testing ShedSuite API connection...');
    try {
      const recordCount = await shedsuite.getTotalRecordCount();
      logger.info('ShedSuite API connection successful', { recordCount });
    } catch (error) {
      logger.error('ShedSuite API connection failed:', error);
      throw error;
    }

    logger.info('Testing Excel API connection...');
    try {
      await excel.initializeClient();
      logger.info('Excel API connection successful');
    } catch (error) {
      logger.error('Excel API connection failed:', error);
      throw error;
    }

    // Perform initial full sync
    logger.info('Performing initial full sync...');
    try {
      // Register this operation with the graceful shutdown handler
      const syncOperationId = 'initial-full-sync-' + Date.now();
      const unregisterSync = gracefulShutdown.registerOperation(syncOperationId, {
        type: 'sync',
        name: 'Initial Full Sync',
        startTime: new Date()
      }, async () => {
        // Cleanup function that will be called during shutdown
        logger.info('Cleaning up initial sync operation during shutdown');
        // No specific cleanup needed for read-only operation
        return Promise.resolve();
      });

      const startTime = Date.now();
      logger.info('Fetching all records from ShedSuite API...');
      const records = await shedsuite.fetchAllRecords({});

      logger.info(`Formatting ${records.length} records for Excel...`);
      const formattedRecords = shedsuite.formatRecordsForExport(records);

      logger.info(`Updating Excel spreadsheet with ${formattedRecords.length} records...`);
      await excel.updateSpreadsheet(formattedRecords);

      const duration = Date.now() - startTime;
      logger.info('Initial full sync completed successfully:', {
        recordsCount: formattedRecords.length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
      
      // Unregister the operation since it completed successfully
      unregisterSync();
    } catch (error) {
      logger.error('Initial full sync failed:', error);
      // Don't throw here - allow the service to start even if initial sync fails
      logger.warn('Service will continue without initial sync data');
    }

    // Start monitoring services if enabled
    if (process.env.ENABLE_MONITORING !== 'false') {
      logger.info('Starting monitoring services...');
      
      // Start enhanced monitoring service with graceful shutdown support
      await enhancedMonitor.start({
        pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL) || 300000,
        cronSchedule: process.env.CRON_SCHEDULE,
        fullSyncInterval: parseInt(process.env.FULL_SYNC_INTERVAL) || 24,
        enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING !== 'false',
        healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 300000,
        metricsExportIntervalMs: parseInt(process.env.METRICS_EXPORT_INTERVAL_MS) || 60000
      });
      
      // Register the monitoring service with the graceful shutdown handler
      gracefulShutdown.registerOperation('enhanced-monitor', {
        type: 'service',
        name: 'Enhanced Monitoring Service',
        startTime: new Date()
      }, async () => {
        logger.info('Stopping enhanced monitoring service during shutdown');
        return enhancedMonitor.stop();
      });
      
      logger.info('Enhanced monitoring service started successfully');
      
      // Start legacy monitoring service for backward compatibility if needed
      if (process.env.ENABLE_LEGACY_MONITORING === 'true') {
        monitoringService.start({
          pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL) || 300000,
          cronSchedule: process.env.CRON_SCHEDULE,
          fullSyncInterval: parseInt(process.env.FULL_SYNC_INTERVAL) || 24,
          enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING !== 'false'
        });
        
        // Register the legacy monitoring service with the graceful shutdown handler
        gracefulShutdown.registerOperation('legacy-monitor', {
          type: 'service',
          name: 'Legacy Monitoring Service',
          startTime: new Date()
        }, async () => {
          logger.info('Stopping legacy monitoring service during shutdown');
          return monitoringService.stop();
        });
        
        logger.info('Legacy monitoring service started for backward compatibility');
      }
      
      // Register system monitor with graceful shutdown handler
      gracefulShutdown.registerOperation('system-monitor', {
        type: 'service',
        name: 'System Monitor',
        startTime: new Date()
      }, async () => {
        logger.info('Stopping system monitor during shutdown');
        return systemMonitor.stop();
      });
    } else {
      logger.info('Monitoring services are disabled');
    }

    // Register HTTP server with graceful shutdown handler
    gracefulShutdown.registerOperation('http-server', {
      type: 'service',
      name: 'HTTP Server',
      startTime: new Date(),
      port: process.env.PORT || 3000
    }, async () => {
      return new Promise((resolve, reject) => {
        logger.info('Closing HTTP server during shutdown');
        server.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server:', err);
            reject(err);
          } else {
            logger.info('HTTP server closed successfully');
            resolve();
          }
        });
      });
    });

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to start services:', error);
    throw error;
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  startServices().catch(error => {
    logger.error('Failed to start services:', error);
    process.exit(1);
  });
});

// Handle server errors
server.on('error', (error) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

  switch (error.code) {
  case 'EACCES':
    logger.error(`${bind} requires elevated privileges`);
    process.exit(1);
    break;
  case 'EADDRINUSE':
    logger.error(`${bind} is already in use`);
    process.exit(1);
    break;
  default:
    throw error;
  }
});

module.exports = { app, server };
