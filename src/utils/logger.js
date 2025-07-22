const winston = require('winston');
const path = require('path');
const fs = require('fs');

console.log('Initializing enhanced production logger...');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Get log configuration from environment variables
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_FORMAT = process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'text');
const LOG_FILE = process.env.LOG_FILE || path.join(logsDir, 'app.log');
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '10485760'); // 10MB default
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '10'); // 10 files default
const ENABLE_REQUEST_LOGGING = process.env.ENABLE_REQUEST_LOGGING !== 'false';

// Create custom format for structured logging
const structuredFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const logObject = {
    timestamp,
    level,
    message,
    ...metadata,
    environment: process.env.NODE_ENV || 'development',
    service: 'shedsuite-excel',
    version: process.env.npm_package_version || '2.0.0',
    hostname: require('os').hostname()
  };
  
  return JSON.stringify(logObject);
});

// Create custom format for human-readable console output
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const ts = timestamp.slice(0, 19).replace('T', ' ');
  const metadataStr = Object.keys(metadata).length ? 
    '\n' + JSON.stringify(metadata, null, 2) : '';
  
  return `${ts} ${level}: ${message}${metadataStr}`;
});

// Create the logger with appropriate configuration
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    LOG_FORMAT === 'json' ? structuredFormat : winston.format.json()
  ),
  defaultMeta: {
    service: 'shedsuite-excel',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport with appropriate format based on environment
    new winston.transports.Console({
      level: LOG_LEVEL,
      handleExceptions: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        process.env.NODE_ENV === 'production' ? 
          winston.format.uncolorize() : 
          winston.format.colorize(),
        consoleFormat
      )
    }),
    
    // File transport with rotation
    new winston.transports.File({
      filename: LOG_FILE,
      format: winston.format.combine(
        winston.format.timestamp(),
        LOG_FORMAT === 'json' ? structuredFormat : winston.format.json()
      ),
      maxsize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      tailable: true
    })
  ],
  // Don't exit on error in production
  exitOnError: process.env.NODE_ENV === 'production' ? false : true
});

// Add error handler
logger.on('error', function (err) {
  console.error('Logger error:', err);
});

// Create request logger middleware
const requestLogger = (req, res, next) => {
  if (!ENABLE_REQUEST_LOGGING) {
    return next();
  }
  
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || 
                   req.headers['x-correlation-id'] || 
                   `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  
  // Add request ID to the request object
  req.id = requestId;
  
  // Log the request
  logger.debug('Request received', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Log the response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 500 ? 'error' : 
                    res.statusCode >= 400 ? 'warn' : 'debug';
    
    logger[logLevel]('Request completed', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0
    });
  });
  
  next();
};

function setupLogger() {
  console.log(`Setting up logger with level: ${LOG_LEVEL}, format: ${LOG_FORMAT}`);
  
  // Log startup information
  logger.info('Logger initialized', {
    level: LOG_LEVEL,
    format: LOG_FORMAT,
    logFile: LOG_FILE,
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES,
    requestLogging: ENABLE_REQUEST_LOGGING
  });
  
  // Add uncaught exception handler
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
  });
  
  // Add unhandled rejection handler
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString()
    });
  });
  
  console.log('Enhanced production logger setup completed');
}

module.exports = {
  logger,
  setupLogger,
  requestLogger
};
