const { logger } = require('./logger');

class ErrorCategorizer {
  constructor() {
    this.errorPatterns = {
      // Network/connectivity errors (usually transient)
      network: {
        patterns: [
          /fetch failed/i,
          /network error/i,
          /connection refused/i,
          /timeout/i,
          /socket hang up/i,
          /econnreset/i,
          /enotfound/i,
          /etimedout/i
        ],
        category: 'transient',
        severity: 'warning',
        defaultRetryStrategy: 'exponential_backoff',
        maxRetries: 5,
        baseDelay: 2000
      },

      // Authentication errors (can be transient if token expired)
      authentication: {
        patterns: [
          /invalidauthenticationtoken/i,
          /unauthorized/i,
          /401/,
          /token.*expired/i,
          /authentication.*failed/i,
          /invalid.*credentials/i
        ],
        category: 'transient',
        severity: 'error',
        defaultRetryStrategy: 'token_refresh',
        maxRetries: 3,
        baseDelay: 1000
      },

      // Rate limiting errors (transient)
      rateLimit: {
        patterns: [
          /rate limit/i,
          /too many requests/i,
          /429/,
          /throttled/i,
          /quota.*exceeded/i
        ],
        category: 'transient',
        severity: 'warning',
        defaultRetryStrategy: 'exponential_backoff',
        maxRetries: 8,
        baseDelay: 5000
      },

      // Server errors (usually transient)
      server: {
        patterns: [
          /internal server error/i,
          /500/,
          /502/,
          /503/,
          /504/,
          /bad gateway/i,
          /service unavailable/i,
          /gateway timeout/i
        ],
        category: 'transient',
        severity: 'error',
        defaultRetryStrategy: 'exponential_backoff',
        maxRetries: 4,
        baseDelay: 3000
      },

      // Memory/resource errors (potentially transient)
      resource: {
        patterns: [
          /out of memory/i,
          /heap.*out of memory/i,
          /maximum call stack/i,
          /allocation failed/i,
          /resource temporarily unavailable/i
        ],
        category: 'transient',
        severity: 'critical',
        defaultRetryStrategy: 'memory_cleanup',
        maxRetries: 2,
        baseDelay: 10000
      },

      // Validation/data errors (usually permanent)
      validation: {
        patterns: [
          /validation.*failed/i,
          /invalid.*data/i,
          /schema.*error/i,
          /required.*field/i,
          /invalid.*format/i,
          /constraint.*violation/i
        ],
        category: 'permanent',
        severity: 'error',
        defaultRetryStrategy: 'none',
        maxRetries: 0,
        baseDelay: 0
      },

      // Permission errors (usually permanent)
      permission: {
        patterns: [
          /permission.*denied/i,
          /access.*denied/i,
          /forbidden/i,
          /403/,
          /insufficient.*privileges/i,
          /not.*authorized/i
        ],
        category: 'permanent',
        severity: 'error',
        defaultRetryStrategy: 'none',
        maxRetries: 0,
        baseDelay: 0
      },

      // File system errors (can be transient or permanent)
      filesystem: {
        patterns: [
          /no such file/i,
          /file not found/i,
          /enoent/i,
          /permission denied.*file/i,
          /disk.*full/i,
          /no space left/i
        ],
        category: 'mixed',
        severity: 'error',
        defaultRetryStrategy: 'filesystem_check',
        maxRetries: 2,
        baseDelay: 1000
      },

      // Excel/Graph API specific errors
      excel: {
        patterns: [
          /workbook.*not found/i,
          /worksheet.*not found/i,
          /range.*invalid/i,
          /excel.*api.*error/i,
          /graph.*api.*error/i,
          /sharepoint.*error/i
        ],
        category: 'mixed',
        severity: 'error',
        defaultRetryStrategy: 'api_refresh',
        maxRetries: 3,
        baseDelay: 2000
      }
    };

    this.errorHistory = [];
    this.retryStrategies = {
      exponential_backoff: this.exponentialBackoffStrategy.bind(this),
      token_refresh: this.tokenRefreshStrategy.bind(this),
      memory_cleanup: this.memoryCleanupStrategy.bind(this),
      filesystem_check: this.filesystemCheckStrategy.bind(this),
      api_refresh: this.apiRefreshStrategy.bind(this),
      none: this.noRetryStrategy.bind(this)
    };
  }

  categorizeError(error) {
    const errorMessage = error.message || error.toString();
    const errorStack = error.stack || '';
    const errorCode = error.code || error.status || error.statusCode;

    // Check each error pattern category
    for (const [type, config] of Object.entries(this.errorPatterns)) {
      for (const pattern of config.patterns) {
        if (pattern.test(errorMessage) || pattern.test(errorStack) || pattern.test(String(errorCode))) {
          const categorization = {
            type,
            category: config.category,
            severity: config.severity,
            retryStrategy: config.defaultRetryStrategy,
            maxRetries: config.maxRetries,
            baseDelay: config.baseDelay,
            originalError: error,
            timestamp: Date.now(),
            context: {
              message: errorMessage,
              code: errorCode,
              stack: errorStack
            }
          };

          // Record in history
          this.recordError(categorization);

          logger.debug('🔍 Error categorized', {
            type,
            category: config.category,
            severity: config.severity,
            message: errorMessage.substring(0, 100)
          });

          return categorization;
        }
      }
    }

    // Default categorization for unknown errors
    const defaultCategorization = {
      type: 'unknown',
      category: 'mixed',
      severity: 'error',
      retryStrategy: 'exponential_backoff',
      maxRetries: 2,
      baseDelay: 5000,
      originalError: error,
      timestamp: Date.now(),
      context: {
        message: errorMessage,
        code: errorCode,
        stack: errorStack
      }
    };

    this.recordError(defaultCategorization);

    logger.warn('🔍 Unknown error pattern', {
      message: errorMessage.substring(0, 100),
      code: errorCode
    });

    return defaultCategorization;
  }

  recordError(categorization) {
    this.errorHistory.push(categorization);

    // Keep only last 100 errors
    if (this.errorHistory.length > 100) {
      this.errorHistory = this.errorHistory.slice(-100);
    }
  }

  shouldRetry(categorization, attemptNumber) {
    if (categorization.category === 'permanent') {
      return false;
    }

    if (attemptNumber >= categorization.maxRetries) {
      return false;
    }

    // Check for patterns that suggest giving up
    const recentSimilarErrors = this.getRecentSimilarErrors(categorization.type, 300000); // 5 minutes
    if (recentSimilarErrors.length > 10) {
      logger.warn('🔍 Too many similar errors recently, suggesting permanent issue', {
        type: categorization.type,
        count: recentSimilarErrors.length
      });
      return false;
    }

    return true;
  }

  getRecentSimilarErrors(errorType, timeWindowMs = 300000) {
    const cutoffTime = Date.now() - timeWindowMs;
    return this.errorHistory.filter(e =>
      e.type === errorType && e.timestamp > cutoffTime);
  }

  executeRetryStrategy(categorization, attemptNumber, context = {}) {
    const strategy = this.retryStrategies[categorization.retryStrategy];
    if (!strategy) {
      logger.warn('🔍 Unknown retry strategy', { strategy: categorization.retryStrategy });
      return this.exponentialBackoffStrategy(categorization, attemptNumber, context);
    }

    logger.info('🔄 Executing retry strategy', {
      strategy: categorization.retryStrategy,
      attempt: attemptNumber,
      maxRetries: categorization.maxRetries,
      errorType: categorization.type
    });

    return strategy(categorization, attemptNumber, context);
  }

  async exponentialBackoffStrategy(categorization, attemptNumber, _context) {
    const delay = categorization.baseDelay * Math.pow(2, attemptNumber - 1);
    const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
    const totalDelay = Math.min(delay + jitter, 30000); // Cap at 30 seconds

    logger.info('⏱️ Exponential backoff delay', {
      attempt: attemptNumber,
      delay: Math.round(totalDelay),
      baseDelay: categorization.baseDelay
    });

    await new Promise(resolve => setTimeout(resolve, totalDelay));
  }

  async tokenRefreshStrategy(categorization, attemptNumber, context) {
    logger.info('🔑 Attempting token refresh');

    // First, wait a bit
    await new Promise(resolve => setTimeout(resolve, categorization.baseDelay));

    // If context has a token refresh function, call it
    if (context.refreshToken && typeof context.refreshToken === 'function') {
      try {
        await context.refreshToken();
        logger.info('✅ Token refresh completed');
      } catch (refreshError) {
        logger.error('❌ Token refresh failed', { error: refreshError.message });
        // Fall back to exponential backoff
        await this.exponentialBackoffStrategy(categorization, attemptNumber, context);
      }
    } else {
      logger.warn('⚠️ No token refresh function provided, using exponential backoff');
      await this.exponentialBackoffStrategy(categorization, attemptNumber, context);
    }
  }

  async memoryCleanupStrategy(categorization, attemptNumber, context) {
    logger.info('🧹 Attempting memory cleanup');

    // Force garbage collection if available
    if (global.gc) {
      const beforeMem = process.memoryUsage();
      global.gc();
      const afterMem = process.memoryUsage();
      const freed = beforeMem.heapUsed - afterMem.heapUsed;

      logger.info('🧹 Forced garbage collection', {
        freedMemory: `${Math.round(freed / 1024 / 1024)}MB`,
        heapBefore: `${Math.round(beforeMem.heapUsed / 1024 / 1024)}MB`,
        heapAfter: `${Math.round(afterMem.heapUsed / 1024 / 1024)}MB`
      });
    }

    // If context has a cleanup function, call it
    if (context.cleanup && typeof context.cleanup === 'function') {
      try {
        await context.cleanup();
        logger.info('✅ Custom cleanup completed');
      } catch (cleanupError) {
        logger.error('❌ Custom cleanup failed', { error: cleanupError.message });
      }
    }

    // Wait longer for memory to stabilize
    const delay = categorization.baseDelay * (attemptNumber + 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async filesystemCheckStrategy(categorization, attemptNumber, context) {
    logger.info('📁 Checking filesystem conditions');

    // Check disk space and permissions if possible
    try {
      const fs = require('fs');
      const path = require('path');

      // Try to write a test file
      const testPath = path.join(process.cwd(), '.error-test-file');
      fs.writeFileSync(testPath, 'test');
      fs.unlinkSync(testPath);

      logger.info('✅ Filesystem appears accessible');
    } catch (fsError) {
      logger.error('❌ Filesystem check failed', { error: fsError.message });
    }

    await this.exponentialBackoffStrategy(categorization, attemptNumber, context);
  }

  async apiRefreshStrategy(categorization, attemptNumber, context) {
    logger.info('🔄 Attempting API refresh');

    // If context has an API refresh function, call it
    if (context.refreshApi && typeof context.refreshApi === 'function') {
      try {
        await context.refreshApi();
        logger.info('✅ API refresh completed');
      } catch (refreshError) {
        logger.error('❌ API refresh failed', { error: refreshError.message });
      }
    }

    await this.exponentialBackoffStrategy(categorization, attemptNumber, context);
  }

  noRetryStrategy(_categorization, _attemptNumber, _context) {
    logger.info('🚫 No retry strategy - error considered permanent');
    // No delay, no retry
  }

  getErrorStatistics() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);

    const recentErrors = this.errorHistory.filter(e => e.timestamp > hourAgo);
    const dailyErrors = this.errorHistory.filter(e => e.timestamp > dayAgo);

    const byType = {};
    const byCategory = {};
    const bySeverity = {};

    dailyErrors.forEach(e => {
      byType[e.type] = (byType[e.type] || 0) + 1;
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    });

    return {
      total: this.errorHistory.length,
      lastHour: recentErrors.length,
      last24Hours: dailyErrors.length,
      byType,
      byCategory,
      bySeverity,
      patterns: Object.keys(this.errorPatterns)
    };
  }

  getRecommendations() {
    const stats = this.getErrorStatistics();
    const recommendations = [];

    // Check for high error rates
    if (stats.lastHour > 10) {
      recommendations.push({
        type: 'high_error_rate',
        message: 'High error rate detected in the last hour',
        suggestion: 'Consider pausing operations and investigating system health',
        severity: 'critical'
      });
    }

    // Check for dominant error types
    const dominantType = Object.entries(stats.byType)
      .sort(([, a], [, b]) => b - a)[0];

    if (dominantType && dominantType[1] > stats.last24Hours * 0.5) {
      recommendations.push({
        type: 'dominant_error_type',
        message: `${dominantType[0]} errors are dominant (${dominantType[1]} occurrences)`,
        suggestion: this.getTypeSpecificSuggestion(dominantType[0]),
        severity: 'warning'
      });
    }

    // Check for permanent errors
    if (stats.byCategory.permanent > 0) {
      recommendations.push({
        type: 'permanent_errors',
        message: `${stats.byCategory.permanent} permanent errors detected`,
        suggestion: 'Review and fix permanent issues before continuing',
        severity: 'error'
      });
    }

    return recommendations;
  }

  getTypeSpecificSuggestion(errorType) {
    const suggestions = {
      network: 'Check network connectivity and consider increasing timeout values',
      authentication: 'Verify credentials and token refresh mechanisms',
      rateLimit: 'Implement more aggressive rate limiting and increase delays',
      server: 'Check server status and consider contacting API provider',
      resource: 'Monitor memory usage and consider reducing batch sizes',
      validation: 'Review data validation and fix data quality issues',
      permission: 'Check access permissions and credentials',
      filesystem: 'Check disk space and file permissions',
      excel: 'Verify Excel/SharePoint connectivity and permissions'
    };

    return suggestions[errorType] || 'Review error patterns and adjust retry strategies';
  }
}

module.exports = { ErrorCategorizer };
