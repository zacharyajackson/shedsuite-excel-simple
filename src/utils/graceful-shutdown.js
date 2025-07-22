/**
 * Graceful Shutdown Handler
 * 
 * Manages graceful shutdown of the application, ensuring that long-running
 * operations can complete or save their state before the process exits.
 */
const { logger } = require('./logger');
const progressDashboard = require('./progress-dashboard');
const notificationSystem = require('./notification-system');

// Track active operations that need to complete before shutdown
const activeOperations = new Map();
let isShuttingDown = false;
let forceShutdownTimeout = null;

/**
 * Register an operation that should be allowed to complete during graceful shutdown
 * @param {string} operationId - Unique identifier for the operation
 * @param {Object} details - Operation details
 * @param {Function} cleanupFn - Function to call for cleanup during shutdown
 * @returns {Function} Function to call when operation completes
 */
function registerOperation(operationId, details, cleanupFn) {
  if (isShuttingDown) {
    logger.warn(`Attempted to register operation ${operationId} during shutdown`);
    return () => {}; // No-op if we're already shutting down
  }

  activeOperations.set(operationId, {
    id: operationId,
    details,
    cleanupFn: cleanupFn || (() => Promise.resolve()),
    startTime: new Date()
  });

  logger.debug(`Registered operation ${operationId} for graceful shutdown handling`);

  // Return a function to call when the operation completes normally
  return () => {
    if (activeOperations.has(operationId)) {
      activeOperations.delete(operationId);
      logger.debug(`Operation ${operationId} completed and unregistered`);
    }
  };
}

/**
 * Initialize graceful shutdown handling
 * @param {Object} options - Configuration options
 * @param {number} options.timeout - Maximum time to wait for operations to complete (ms)
 */
function initGracefulShutdown(options = {}) {
  const timeout = options.timeout || 
                  (process.env.GRACEFUL_SHUTDOWN_TIMEOUT ? 
                   parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT) : 30000);

  // Handle process termination signals
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    process.on(signal, async () => {
      if (isShuttingDown) {
        logger.warn(`Received ${signal} signal again during shutdown, forcing exit`);
        process.exit(1);
        return;
      }

      isShuttingDown = true;
      logger.info(`Received ${signal} signal, starting graceful shutdown (timeout: ${timeout}ms)`);
      
      try {
        await notificationSystem.sendNotification({
          level: 'warn',
          title: 'Application Shutdown Initiated',
          message: `Graceful shutdown started due to ${signal} signal`,
          details: {
            activeOperations: activeOperations.size,
            shutdownTimeout: timeout
          }
        });
      } catch (error) {
        logger.error('Failed to send shutdown notification', error);
      }

      // Set a timeout to force exit if operations take too long
      forceShutdownTimeout = setTimeout(() => {
        const remaining = activeOperations.size;
        logger.error(`Graceful shutdown timeout after ${timeout}ms with ${remaining} operations still active`);
        
        // Log details of remaining operations
        activeOperations.forEach(op => {
          const duration = Date.now() - op.startTime.getTime();
          logger.warn(`Operation still active: ${op.id}, running for ${duration}ms`, op.details);
        });

        process.exit(1);
      }, timeout);

      // If no active operations, exit immediately
      if (activeOperations.size === 0) {
        logger.info('No active operations, shutting down immediately');
        clearTimeout(forceShutdownTimeout);
        process.exit(0);
        return;
      }

      // Handle active operations
      logger.info(`Waiting for ${activeOperations.size} operations to complete`);
      
      // Create a dashboard entry for shutdown progress
      progressDashboard.startOperation('system-shutdown', {
        type: 'system',
        name: 'Graceful Shutdown',
        total: activeOperations.size,
        current: 0,
        status: 'in_progress'
      });

      // Call cleanup functions for all active operations
      const cleanupPromises = [];
      activeOperations.forEach((operation, id) => {
        logger.info(`Cleaning up operation: ${id}`);
        try {
          const cleanupPromise = Promise.resolve(operation.cleanupFn())
            .then(() => {
              logger.debug(`Cleanup completed for operation ${id}`);
              activeOperations.delete(id);
              
              // Update shutdown progress
              progressDashboard.updateOperation('system-shutdown', {
                current: activeOperations.size,
                message: `Remaining operations: ${activeOperations.size}`
              });
            })
            .catch(error => {
              logger.error(`Error during cleanup of operation ${id}:`, error);
              // Continue shutdown even if cleanup fails
              activeOperations.delete(id);
            });
          
          cleanupPromises.push(cleanupPromise);
        } catch (error) {
          logger.error(`Exception during cleanup of operation ${id}:`, error);
          activeOperations.delete(id);
        }
      });

      // Wait for all cleanup operations to complete
      try {
        await Promise.all(cleanupPromises);
        logger.info('All operations cleaned up successfully');
        
        progressDashboard.completeOperation('system-shutdown', {
          status: 'completed',
          message: 'All operations shut down gracefully'
        });
        
        await notificationSystem.sendNotification({
          level: 'info',
          title: 'Application Shutdown Complete',
          message: 'All operations were shut down gracefully',
          details: {
            shutdownDuration: Date.now() - (isShuttingDown ? isShuttingDown.getTime() : Date.now())
          }
        });
      } catch (error) {
        logger.error('Error during shutdown cleanup:', error);
        
        progressDashboard.completeOperation('system-shutdown', {
          status: 'failed',
          message: 'Shutdown encountered errors',
          error: error.message
        });
      }

      // Clear the force shutdown timeout and exit
      clearTimeout(forceShutdownTimeout);
      process.exit(0);
    });
  });

  logger.info('Graceful shutdown handler initialized');
}

module.exports = {
  initGracefulShutdown,
  registerOperation,
  getActiveOperations: () => Array.from(activeOperations.entries()),
  isShuttingDown: () => isShuttingDown
};