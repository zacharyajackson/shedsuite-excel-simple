const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  defaultMeta: { service: 'shedsuite-supabase-sync' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760, // 10MB
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      tailable: true
    }),
    // File transport for error logs only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      tailable: true
    })
  ]
});

// Add console transport for all environments (needed for Railway logs)
logger.add(new winston.transports.Console({
  format: consoleFormat
}));

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress
    });
  });
  
  next();
};

// Sync-specific logging methods
const syncLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'sync' }),
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'sync' }),
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'sync' }),
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'sync' })
};

// API-specific logging methods
const apiLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'api' }),
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'api' }),
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'api' }),
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'api' })
};

// Database-specific logging methods
const dbLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'database' }),
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'database' }),
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'database' }),
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'database' })
};

module.exports = {
  logger,
  requestLogger,
  syncLogger,
  apiLogger,
  dbLogger
}; 