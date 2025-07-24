require('dotenv').config();
console.log('Starting ShedSuite Supabase Sync Service...');

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

// Validate required environment variables
const requiredEnvVars = [
  'SHEDSUITE_API_BASE_URL',
  'SHEDSUITE_API_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
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
const PORT = process.env.PORT || 3001;

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
    logger.info('Initializing services...');
    
    // Initialize data sync service
    await dataSyncService.initialize();
    
    logger.info('All services initialized successfully');
    isFullyInitialized = true;
    
    const startupDuration = Date.now() - startupStartTime;
    logger.info('Application startup completed', {
      duration: `${startupDuration}ms`,
      services: ['dataSyncService']
    });
    
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    process.exit(1);
  }
}

// Start server
async function startServer() {
  try {
    await startServices();
    
    const server = app.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        startupTime: Date.now() - startupStartTime
      });
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      try {
        // Stop accepting new connections
        server.close(() => {
          logger.info('HTTP server closed');
        });

        // Shutdown services
        await dataSyncService.shutdown();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', { error: error.message });
        process.exit(1);
      }
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      gracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', { reason: reason?.message || reason, promise });
      gracefulShutdown('unhandledRejection');
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Start the application
startServer(); 