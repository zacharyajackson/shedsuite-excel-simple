const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create ShedSuite-specific log file
const SHEDSUITE_LOG_FILE = path.join(logsDir, 'shedsuite-operations.log');

// Create detailed ShedSuite operation logger
const shedSuiteLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.printf(({ timestamp, level, message, operation, details, ...metadata }) => {
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        operation: operation || 'general',
        message,
        ...details,
        ...metadata
      };
      return JSON.stringify(logEntry);
    })
  ),
  transports: [
    // File transport for ShedSuite operations
    new winston.transports.File({
      filename: SHEDSUITE_LOG_FILE,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Console transport for immediate feedback
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, operation, details, ...metadata }) => {
          const operationStr = operation ? `[${operation.toUpperCase()}]` : '';
          const detailsStr = details ? `\n${JSON.stringify(details, null, 2)}` : '';
          return `${timestamp} ${level} ${operationStr} ${message}${detailsStr}`;
        })
      )
    })
  ]
});

// Helper functions for specific ShedSuite operations
const shedSuiteLog = {
  // Log API connection attempts
  connection: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'connection',
      details
    });
  },

  // Log data fetching operations
  fetching: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'fetching',
      details
    });
  },

  // Log pagination operations
  pagination: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'pagination',
      details
    });
  },

  // Log rate limiting and delays
  rateLimit: (message, details = {}) => {
    shedSuiteLogger.warn(message, {
      operation: 'rate_limit',
      details
    });
  },

  // Log batch operations
  batch: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'batch',
      details
    });
  },

  // Log data processing
  processing: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'processing',
      details
    });
  },

  // Log errors
  error: (message, error = null, details = {}) => {
    shedSuiteLogger.error(message, {
      operation: 'error',
      details: {
        ...details,
        error: error ? {
          message: error.message,
          code: error.code,
          stack: error.stack
        } : null
      }
    });
  },

  // Log performance metrics
  performance: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'performance',
      details
    });
  },

  // Log general info
  info: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'info',
      details
    });
  },

  // Log warnings
  warn: (message, details = {}) => {
    shedSuiteLogger.warn(message, {
      operation: 'warning',
      details
    });
  },

  // Log debug info
  debug: (message, details = {}) => {
    shedSuiteLogger.debug(message, {
      operation: 'debug',
      details
    });
  },

  // Log HTTP request details
  http: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'http',
      details
    });
  },

  // Log data validation
  validation: (message, details = {}) => {
    shedSuiteLogger.info(message, {
      operation: 'validation',
      details
    });
  }
};

module.exports = shedSuiteLog; 