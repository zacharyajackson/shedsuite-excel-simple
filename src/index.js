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
const missingVars = [];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    missingVars.push(envVar);
  }
}

if (missingVars.length > 0) {
  console.error(`Missing ${missingVars.length} required environment variables: ${missingVars.join(', ')}`);
  console.warn('Application will start but may have limited functionality');
} else {
  console.log('All required environment variables are present');
}

// Initialize Express app
const app = express();

// Track application startup state
let isFullyInitialized = false;
let startupStartTime = Date.now();

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
      status: isFullyInitialized ? 'healthy' : 'starting',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '2.0.0',
      startupTime: Date.now() - startupStartTime
    };

    // Only check external dependencies if the service is fully initialized
    if (isFullyInitialized) {
      try {
        await shedsuite.getTotalRecordCount();
        healthStatus.shedsuite = 'connected';
      } catch (error) {
        healthStatus.shedsuite = 'disconnected';
        healthStatus.status = 'degraded';
        logger.warn('ShedSuite connection check failed during health check:', error.message);
      }
    } else {
      healthStatus.shedsuite = 'starting';
    }

    res.status(healthStatus.status === 'healthy' ? 200 : 
              healthStatus.status === 'starting' ? 200 : 503).json(healthStatus);
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
  const uptime = process.uptime();
  const isReady = isFullyInitialized && uptime > 5; // Consider ready after initialization and 5 seconds
  
  res.status(isReady ? 200 : 503).json({ 
    status: isReady ? 'ready' : 'starting',
    uptime: Math.round(uptime),
    startupTime: Date.now() - startupStartTime,
    isFullyInitialized,
    timestamp: new Date().toISOString()
  });
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
    console.log('🔧 Starting services initialization...');
    logger.info('Starting services initialization...');

    // Test connections first
    console.log('🔌 Testing ShedSuite API connection...');
    logger.info('Testing ShedSuite API connection...');
    try {
      const recordCount = await shedsuite.getTotalRecordCount();
      console.log(`✅ ShedSuite API connection successful - ${recordCount} records available`);
      logger.info('ShedSuite API connection successful', { recordCount });
    } catch (error) {
      console.error(`❌ ShedSuite API connection failed: ${error.message}`);
      logger.error('ShedSuite API connection failed:', error);
      // Don't throw - allow other services to start
      console.log('⚠️  ShedSuite service will be unavailable');
      logger.warn('ShedSuite service will be unavailable');
    }

    console.log('🔌 Testing Excel API connection...');
    logger.info('Testing Excel API connection...');
    try {
      await excel.initializeClient();
      console.log('✅ Excel API connection successful');
      logger.info('Excel API connection successful');
    } catch (error) {
      console.error(`❌ Excel API connection failed: ${error.message}`);
      logger.error('Excel API connection failed:', error);
      // Don't throw - allow other services to start
      console.log('⚠️  Excel service will be unavailable');
      logger.warn('Excel service will be unavailable');
    }

    // Mark as initialized early so health checks work
    isFullyInitialized = true;
    console.log('✅ Application is now initialized and ready to serve requests');
    logger.info('Application is now initialized and ready to serve requests');

    // Perform initial full sync in the background (non-blocking)
    console.log('🔄 Starting initial full sync in background (will run in 5 seconds)...');
    logger.info('Starting initial full sync in background...');
    setTimeout(async () => {
      try {
        console.log('🔄 Beginning initial full sync...');
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
        console.log('📥 Fetching all records from ShedSuite API...');
        logger.info('Fetching all records from ShedSuite API...');
        const records = await shedsuite.fetchAllRecords({});

        console.log(`📊 Formatting ${records.length} records for Excel...`);
        logger.info(`Formatting ${records.length} records for Excel...`);
        const formattedRecords = shedsuite.formatRecordsForExport(records);

        console.log(`📈 Updating Excel spreadsheet with ${formattedRecords.length} records...`);
        logger.info(`Updating Excel spreadsheet with ${formattedRecords.length} records...`);
        await excel.updateSpreadsheet(formattedRecords);

        const duration = Date.now() - startTime;
        console.log(`✅ Initial full sync completed successfully: ${formattedRecords.length} records in ${duration}ms`);
        logger.info('Initial full sync completed successfully:', {
          recordsCount: formattedRecords.length,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
        
        // Unregister the operation since it completed successfully
        unregisterSync();
      } catch (error) {
        console.error(`❌ Initial full sync failed: ${error.message}`);
        logger.error('Initial full sync failed:', error);
        // Don't throw here - allow the service to start even if initial sync fails
        console.log('⚠️  Service will continue without initial sync data');
        logger.warn('Service will continue without initial sync data');
      }
    }, 5000); // 5 second delay to let the server start first

    // Start monitoring services if enabled - DELAYED to ensure environment variables are loaded
    if (process.env.ENABLE_MONITORING !== 'false') {
      console.log('📊 Monitoring services will be started after a delay...');
      logger.info('Monitoring services will be started after a delay to ensure proper initialization...');
      
      // Delay monitoring service startup to ensure environment variables are loaded
      setTimeout(async () => {
        try {
          console.log('📊 Starting monitoring services...');
          logger.info('Starting monitoring services after delay...');
          
          // Check if basic environment variables are available before starting monitoring
          if (!process.env.API_BASE_URL || !process.env.API_TOKEN) {
            console.log('⚠️  Basic environment variables not available, skipping monitoring service startup');
            logger.warn('Basic environment variables not available, skipping monitoring service startup');
            return;
          }
          
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
          
          console.log('✅ Enhanced monitoring service started successfully');
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
            
            console.log('✅ Legacy monitoring service started for backward compatibility');
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
        } catch (error) {
          console.error(`❌ Failed to start monitoring services: ${error.message}`);
          logger.error('Failed to start monitoring services after delay:', error);
        }
      }, 10000); // 10 second delay
    } else {
      console.log('📊 Monitoring services are disabled');
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

    console.log('✅ All services initialized successfully');
    logger.info('All services initialized successfully');
  } catch (error) {
    console.error(`❌ Failed to start services: ${error.message}`);
    logger.error('Failed to start services:', error);
    // Don't throw - let the server continue running with degraded functionality
    console.log('⚠️  Application will run with limited functionality due to service initialization failures');
    logger.warn('Application will run with limited functionality due to service initialization failures');
    isFullyInitialized = true; // Mark as initialized even with errors so health check works
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
console.log(`Starting server on port ${PORT}...`);
const server = app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  logger.info(`Server is running on port ${PORT}`);
  
  // Start services in the background without blocking the server
  console.log('🚀 Starting background services...');
  const startupTimeout = setTimeout(() => {
    if (!isFullyInitialized) {
      console.log('⚠️  Service startup timeout reached, marking as initialized with limited functionality');
      logger.warn('Service startup timeout reached, marking as initialized with limited functionality');
      isFullyInitialized = true;
    }
  }, 60000); // 60 second timeout
  
  startServices().catch(error => {
    console.error('❌ Failed to start services:', error.message);
    logger.error('Failed to start services:', error);
    // Don't exit the process - let the server continue running
    // The health check will show degraded status until services are ready
  }).finally(() => {
    clearTimeout(startupTimeout);
    if (!isFullyInitialized) {
      isFullyInitialized = true;
      console.log('✅ Service startup completed, application is now ready');
      logger.info('Service startup completed, application is now ready');
    }
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
