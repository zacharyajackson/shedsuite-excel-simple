require('dotenv').config();
// Prefer IPv4 for outbound connections (avoids ENETUNREACH on IPv6-only blocks)
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}
console.log('🚀 Starting ShedSuite Supabase Sync Service...');
console.log('📅 Startup timestamp:', new Date().toISOString());

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { logger, requestLogger } = require('./utils/logger');

// Import routes
const { syncRouter } = require('./routes/sync');
const { healthRouter } = require('./routes/health');

// Import services
const dataSyncService = require('./services/data-sync-service');
const { runStartupMigrations } = require('./services/db-migration');

// Validate required environment variables
const requiredEnvVars = [
  'SHEDSUITE_API_BASE_URL',
  'SHEDSUITE_API_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

console.log('🔍 Checking environment variables...');

const missingVars = [];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    missingVars.push(envVar);
  }
}

if (missingVars.length > 0) {
  console.error(`❌ Missing ${missingVars.length} required environment variables: ${missingVars.join(', ')}`);
  console.warn('⚠️ Application will start but may have limited functionality');
} else {
  console.log('✅ All required environment variables are present');
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Railway deployment (fixes rate limiter X-Forwarded-For error)
app.set('trust proxy', 1);

// Track application startup state
let isFullyInitialized = false;
let startupStartTime = Date.now();

logger.info('Application starting...', {
  nodeEnv: process.env.NODE_ENV,
  port: PORT,
  shedsuiteApiUrl: process.env.SHEDSUITE_API_BASE_URL?.replace(/\/+$/, ''),
  supabaseUrl: process.env.SUPABASE_URL
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
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
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add request logging middleware
app.use(requestLogger);

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: isFullyInitialized ? 'healthy' : 'starting',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      syncStatus: dataSyncService.getSyncStatus()
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

// API routes
app.use('/api/sync', syncRouter);
app.use('/api/health', healthRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'ShedSuite Supabase Sync Service',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      sync: '/api/sync',
      healthDetailed: '/api/health/detailed'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Initialize services
async function startServices() {
  try {
    // Optionally skip startup DB migrations in production to avoid network issues
    const skipMigrations = process.env.SKIP_STARTUP_MIGRATIONS === 'true' || (process.env.NODE_ENV === 'production');
    if (skipMigrations) {
      logger.info('Skipping startup DB migrations', {
        reason: process.env.SKIP_STARTUP_MIGRATIONS === 'true' ? 'env_flag' : 'production_env'
      });
    } else {
      await runStartupMigrations();
    }

    await dataSyncService.initialize();
    isFullyInitialized = true;
  } catch (error) {
    console.error('🔧 startServices() - Error details:', error.message);
    logger.error('❌ Failed to initialize services', { error: error.message, stack: error.stack });
    throw error;
  }
}

// Start server
async function startServer() {
  const serverStartTime = Date.now();
  try {
    logger.info('🚀 Starting server initialization...', { timestamp: new Date().toISOString() });
    
    logger.info('📋 Step 1: Starting services initialization...', { timestamp: new Date().toISOString() });
    const servicesStartTime = Date.now();
    await startServices();
    const servicesDuration = Date.now() - servicesStartTime;
    logger.info('✅ Step 1: Services initialization completed', { 
      timestamp: new Date().toISOString(),
      duration: `${servicesDuration}ms`
    });
    
    logger.info('📋 Step 2: Starting HTTP server...', { timestamp: new Date().toISOString() });
    const serverSetupStartTime = Date.now();
    const server = app.listen(PORT, () => {
      const serverSetupDuration = Date.now() - serverSetupStartTime;
      logger.info('✅ Step 2: HTTP server started successfully', {
        timestamp: new Date().toISOString(),
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        startupTime: Date.now() - startupStartTime,
        serverSetupDuration: `${serverSetupDuration}ms`
      });
    });

    logger.info('📋 Step 3: Setting up graceful shutdown handlers...', { timestamp: new Date().toISOString() });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`🔧 startServer() - Graceful shutdown triggered by ${signal}`);
      logger.info(`🛑 Received ${signal}, starting graceful shutdown...`, { timestamp: new Date().toISOString() });
      
      try {
        // Stop accepting new connections
        server.close(() => {
          console.log('🔧 startServer() - HTTP server closed');
          logger.info('✅ HTTP server closed', { timestamp: new Date().toISOString() });
        });

        // Shutdown services
        console.log('🔧 startServer() - Shutting down services...');
        logger.info('📋 Shutting down services...', { timestamp: new Date().toISOString() });
        await dataSyncService.shutdown();
        logger.info('✅ Services shutdown completed', { timestamp: new Date().toISOString() });
        
        console.log('🔧 startServer() - Graceful shutdown completed');
        logger.info('✅ Graceful shutdown completed', { timestamp: new Date().toISOString() });
        process.exit(0);
      } catch (error) {
        console.log('🔧 startServer() - Error during graceful shutdown');
        logger.error('❌ Error during graceful shutdown', { 
          timestamp: new Date().toISOString(),
          error: error.message 
        });
        process.exit(1);
      }
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => {
      console.log('🔧 startServer() - SIGTERM received');
      gracefulShutdown('SIGTERM');
    });

    process.on('SIGINT', () => {
      console.log('🔧 startServer() - SIGINT received');
      gracefulShutdown('SIGINT');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.log('🔧 startServer() - Uncaught exception received');
      logger.error('❌ Uncaught exception', { 
        timestamp: new Date().toISOString(),
        error: error.message, 
        stack: error.stack 
      });
      // Log the error but don't shut down the application
      console.log('🔧 startServer() - Continuing despite uncaught exception');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.log('🔧 startServer() - Unhandled promise rejection received');
      logger.error('❌ Unhandled promise rejection', { 
        timestamp: new Date().toISOString(),
        reason: reason?.message || reason, 
        promise 
      });
      // Log the error but don't shut down the application
      console.log('🔧 startServer() - Continuing despite unhandled promise rejection');
    });

    const totalStartupDuration = Date.now() - serverStartTime;
    logger.info('✅ Step 3: Graceful shutdown handlers configured', { timestamp: new Date().toISOString() });
    logger.info('🎉 Server startup completed successfully!', { 
      timestamp: new Date().toISOString(),
      totalStartupDuration: `${totalStartupDuration}ms`
    });
    console.log('🎉 SERVER IS FULLY STARTED AND RUNNING!');
    console.log(`🌐 Server listening on port ${PORT}`);
    console.log(`�� Total startup time: ${totalStartupDuration}ms`);

  } catch (error) {
    const totalStartupDuration = Date.now() - serverStartTime;
    console.error('🔧 startServer() - Error details:', error.message);
    logger.error('❌ Failed to start server', { 
      timestamp: new Date().toISOString(),
      totalStartupDuration: `${totalStartupDuration}ms`,
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Start the application
startServer(); 