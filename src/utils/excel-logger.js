const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create Excel-specific log file
const EXCEL_LOG_FILE = path.join(logsDir, 'excel-operations.log');

// Create detailed Excel operation logger
const excelLogger = winston.createLogger({
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
    // File transport for Excel operations
    new winston.transports.File({
      filename: EXCEL_LOG_FILE,
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

// Helper functions for specific Excel operations
const excelLog = {
  // Log Excel connection attempts
  connection: (message, details = {}) => {
    excelLogger.info(message, {
      operation: 'connection',
      details
    });
  },

  // Log data clearing operations
  clearing: (message, details = {}) => {
    excelLogger.info(message, {
      operation: 'clearing',
      details
    });
  },

  // Log data writing operations
  writing: (message, details = {}) => {
    excelLogger.info(message, {
      operation: 'writing',
      details
    });
  },

  // Log payload size issues
  payloadLimit: (message, details = {}) => {
    excelLogger.warn(message, {
      operation: 'payload_limit',
      details
    });
  },

  // Log batch operations
  batch: (message, details = {}) => {
    excelLogger.info(message, {
      operation: 'batch',
      details
    });
  },

  // Log errors
  error: (message, error = null, details = {}) => {
    excelLogger.error(message, {
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
    excelLogger.info(message, {
      operation: 'performance',
      details
    });
  },

  // Log general info
  info: (message, details = {}) => {
    excelLogger.info(message, {
      operation: 'info',
      details
    });
  },

  // Log warnings
  warn: (message, details = {}) => {
    excelLogger.warn(message, {
      operation: 'warning',
      details
    });
  },

  // Log debug info
  debug: (message, details = {}) => {
    excelLogger.debug(message, {
      operation: 'debug',
      details
    });
  }
};

module.exports = excelLog; 