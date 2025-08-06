/**
 * COMPREHENSIVE LOGGING UTILITY
 * =============================
 * 
 * This module provides a centralized, structured logging system for the ShedSuite application.
 * Built on Winston logging library with multiple output formats, file rotation, and
 * context-specific loggers for different application components.
 * 
 * Key Features:
 * - Multiple log levels (error, warn, info, debug)
 * - Separate file outputs for different log types
 * - Automatic log rotation with size and file count limits
 * - Console output with colorization for development
 * - Context-specific loggers (sync, api, database)
 * - Request logging middleware for HTTP operations
 * - JSON formatting for structured log analysis
 * - Environment-based configuration
 * 
 * Log Files Created:
 * - app.log: All application logs
 * - error.log: Error-level logs only
 * 
 * Environment Variables:
 * - LOG_LEVEL: Minimum log level (default: 'info')
 * - LOG_MAX_SIZE: Maximum file size in bytes (default: 10MB)
 * - LOG_MAX_FILES: Number of rotated files to keep (default: 5)
 */

// Import required modules for logging functionality
const winston = require('winston');  // Primary logging library
const path = require('path');        // Path manipulation utilities
const fs = require('fs');           // File system operations

// DIRECTORY SETUP: Ensure logs directory exists
// Create logs directory in project root with proper permissions
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  // Use recursive: true to create parent directories if needed
  fs.mkdirSync(logsDir, { recursive: true });
}

// CONSOLE OUTPUT FORMATTING
// ==========================
// 
// Custom formatter optimized for development and debugging.
// Provides human-readable output with colors and timestamps.

const consoleFormat = winston.format.combine(
  // Add timestamp in human-readable format for debugging
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  
  // Include full stack traces for error objects
  winston.format.errors({ stack: true }),
  
  // Colorize log levels for better visual distinction
  // Colors: error=red, warn=yellow, info=green, debug=blue
  winston.format.colorize(),
  
  // Custom printf formatter for structured console output
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Append metadata as JSON if present (context, ids, etc.)
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);

// FILE OUTPUT FORMATTING
// =======================
// 
// JSON formatter optimized for log analysis tools and monitoring systems.
// Structured format enables easy parsing, searching, and alerting.

const fileFormat = winston.format.combine(
  // ISO timestamp for consistent log ordering and analysis
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  
  // Preserve full error objects with stack traces in JSON
  winston.format.errors({ stack: true }),
  
  // JSON format for structured logging and log analysis tools
  // Enables easy parsing by monitoring systems (ELK, Splunk, etc.)
  winston.format.json()
);

// MAIN LOGGER CONFIGURATION
// ==========================
// 
// Creates the primary Winston logger instance with multiple transports
// for different output destinations and log levels.

const logger = winston.createLogger({
  // Set minimum log level from environment or default to 'info'
  // Levels: error=0, warn=1, info=2, debug=3 (lower numbers = higher priority)
  level: process.env.LOG_LEVEL || 'info',
  
  // Default to file format (JSON) for structured logging
  format: fileFormat,
  
  // Default metadata added to all log entries
  // Helps identify logs from this service in aggregated log systems
  defaultMeta: { service: 'shedsuite-supabase-sync' },
  
  // TRANSPORT CONFIGURATION: Define where logs are sent
  transports: [
    // PRIMARY LOG FILE: All application logs
    // This file contains the complete log history for debugging and analysis
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),  // Main application log
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,  // 10MB per file
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,       // Keep 5 rotated files
      tailable: true  // Enable log rotation when max size reached
    }),
    
    // ERROR-ONLY LOG FILE: Critical issues and errors
    // Separate file for easy monitoring and alerting on critical issues
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'), // Error-specific log file
      level: 'error',                            // Only error-level logs
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,  // 10MB per file
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,       // Keep 5 rotated files
      tailable: true  // Enable log rotation
    })
  ]
});

// CONSOLE OUTPUT TRANSPORT
// =========================
// 
// Add console logging for real-time monitoring and development.
// Essential for cloud deployments where console logs are captured by platform.

logger.add(new winston.transports.Console({
  format: consoleFormat  // Use human-readable format with colors
}));

// Note: Console transport is critical for:
// - Development debugging and real-time monitoring
// - Cloud platform log aggregation (Railway, Heroku, AWS, etc.)
// - Container orchestration log collection (Docker, Kubernetes)
// - CI/CD pipeline output and error tracking

// HTTP REQUEST LOGGING MIDDLEWARE
// ================================
// 
// Express middleware that automatically logs all HTTP requests with
// comprehensive metadata for monitoring, debugging, and performance analysis.
// 
// Captures:
// - Request method and URL
// - Response status code and duration
// - Client information (IP, User-Agent)
// - Performance metrics
// 
// Usage: app.use(requestLogger)

const requestLogger = (req, res, next) => {
  // Record request start time for duration calculation
  const start = Date.now();
  
  // Listen for response completion to log final request details
  res.on('finish', () => {
    // Calculate total request processing time
    const duration = Date.now() - start;
    
    // Log comprehensive request information
    logger.info('HTTP Request', {
      method: req.method,                                    // HTTP method (GET, POST, etc.)
      url: req.url,                                         // Requested URL path
      statusCode: res.statusCode,                           // HTTP response status
      duration: `${duration}ms`,                            // Processing time
      userAgent: req.get('User-Agent'),                     // Client browser/app info
      ip: req.ip || req.connection.remoteAddress,           // Client IP address
      context: 'http-request',                              // Log context for filtering
      timestamp: new Date().toISOString()                   // Request timestamp
    });
  });
  
  // Continue to next middleware/route handler
  next();
};

// CONTEXT-SPECIFIC LOGGERS
// =========================
// 
// Pre-configured logger instances that automatically add context metadata
// to help categorize and filter logs from different application components.
// This enables easy log analysis and component-specific monitoring.

// SYNCHRONIZATION LOGGER
// Used for data synchronization operations between external systems
// Context: 'sync' - helps identify sync-related issues and performance
const syncLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'sync' }),     // Sync progress and status
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'sync' }),   // Sync failures and errors
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'sync' }),     // Sync warnings and retries
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'sync' })    // Detailed sync debugging
};

// API OPERATIONS LOGGER
// Used for REST API requests, responses, and external API interactions
// Context: 'api' - helps monitor API performance and integration issues
const apiLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'api' }),     // API calls and responses
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'api' }),   // API failures and timeouts
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'api' }),     // API warnings and rate limits
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'api' })    // Detailed API debugging
};

// DATABASE OPERATIONS LOGGER
// Used for all database operations, connections, and data manipulation
// Context: 'database' - helps identify database performance and connectivity issues
const dbLogger = {
  info: (message, meta = {}) => logger.info(message, { ...meta, context: 'database' }),   // DB connections and queries
  error: (message, meta = {}) => logger.error(message, { ...meta, context: 'database' }), // DB errors and failures
  warn: (message, meta = {}) => logger.warn(message, { ...meta, context: 'database' }),   // DB warnings and slow queries
  debug: (message, meta = {}) => logger.debug(message, { ...meta, context: 'database' })  // Detailed DB debugging
};

// CONTEXT BENEFITS:
// - Easy log filtering: grep 'context":"database"' app.log
// - Component-specific monitoring and alerting
// - Simplified debugging of specific application areas
// - Better log organization for large applications

// MODULE EXPORTS
// ==============
// 
// Export all logging utilities for use throughout the application.
// Import pattern: const { dbLogger, syncLogger } = require('./utils/logger');

module.exports = {
  logger,         // Main Winston logger instance (for general use)
  requestLogger,  // Express middleware for HTTP request logging
  syncLogger,     // Context-specific logger for sync operations
  apiLogger,      // Context-specific logger for API operations
  dbLogger        // Context-specific logger for database operations
}; 