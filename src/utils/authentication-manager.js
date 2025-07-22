const { ConfidentialClientApplication } = require('@azure/msal-node');
const { logger } = require('./logger');
const { ErrorHandler } = require('./error-handler');

/**
 * Enhanced Authentication Manager for Microsoft Graph API
 * Provides proactive token refresh, continuous monitoring, and fallback strategies
 */
class AuthenticationManager {
  constructor(config = {}) {
    this.config = {
      clientId: config.clientId || process.env.AZURE_CLIENT_ID,
      tenantId: config.tenantId || process.env.AZURE_TENANT_ID,
      clientSecret: config.clientSecret || process.env.AZURE_CLIENT_SECRET,
      scopes: config.scopes || ['https://graph.microsoft.com/.default'],
      refreshThreshold: config.refreshThreshold || 0.9, // Refresh at 90% of token lifetime
      monitoringInterval: config.monitoringInterval || 60000, // Check every minute
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      enableBackgroundMonitoring: config.enableBackgroundMonitoring !== false
    };

    // Validate required configuration
    this.validateConfiguration();

    // Initialize MSAL client
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: this.config.clientId,
        authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
        clientSecret: this.config.clientSecret
      }
    });

    // Token state
    this.tokenCache = null;
    this.tokenExpiresAt = null;
    this.tokenAcquiredAt = null;
    this.refreshInProgress = false;
    this.monitoringTimer = null;
    this.refreshAttempts = 0;
    this.lastRefreshError = null;

    // Initialize error handler
    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.maxRetries,
      baseDelay: this.config.retryDelay,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true
    });

    // Authentication event listeners
    this.eventListeners = {
      tokenRefreshed: [],
      tokenExpired: [],
      authenticationFailed: [],
      fallbackActivated: []
    };

    logger.info('AuthenticationManager initialized', {
      clientId: this.config.clientId,
      tenantId: this.config.tenantId,
      refreshThreshold: `${this.config.refreshThreshold * 100}%`,
      monitoringInterval: `${this.config.monitoringInterval / 1000}s`,
      backgroundMonitoring: this.config.enableBackgroundMonitoring
    });

    // Start background monitoring if enabled
    if (this.config.enableBackgroundMonitoring) {
      this.startTokenMonitoring();
    }
  }

  /**
   * Validate required configuration parameters
   */
  validateConfiguration() {
    const requiredVars = ['clientId', 'tenantId', 'clientSecret'];
    for (const varName of requiredVars) {
      if (!this.config[varName]) {
        throw new Error(`Missing required authentication configuration: ${varName}`);
      }
    }
  }

  /**
   * Get a valid access token with proactive refresh
   */
  async getValidToken() {
    try {
      // Check if we have a valid cached token
      if (this.isTokenValid()) {
        logger.debug('Using cached access token');
        return this.tokenCache;
      }

      // Check if token needs proactive refresh
      if (this.shouldRefreshToken()) {
        logger.info('Token approaching expiration, refreshing proactively');
        return await this.refreshToken();
      }

      // Acquire new token if none exists
      if (!this.tokenCache) {
        logger.info('No cached token found, acquiring new token');
        return await this.acquireNewToken();
      }

      // Token is expired, refresh it
      logger.info('Token expired, refreshing');
      return await this.refreshToken();

    } catch (error) {
      logger.error('Failed to get valid token:', error);
      
      // Try fallback strategies
      return await this.executeFallbackStrategy(error);
    }
  }

  /**
   * Acquire a new access token
   */
  async acquireNewToken() {
    const operationContext = this.errorHandler.createErrorContext('token_acquisition', {
      service: 'AuthenticationManager',
      operation: 'acquireNewToken'
    });

    return await this.errorHandler.executeWithRetry(async () => {
      logger.debug('Acquiring new access token...');
      
      const result = await this.msalClient.acquireTokenByClientCredential({
        scopes: this.config.scopes
      });

      if (!result || !result.accessToken) {
        throw new Error('Failed to acquire access token - no token in response');
      }

      // Cache the token with metadata
      this.cacheToken(result);
      
      // Log successful acquisition
      this.logAuthenticationEvent('token_acquired', {
        expiresAt: this.tokenExpiresAt,
        expiresIn: Math.round((this.tokenExpiresAt - Date.now()) / 1000)
      });

      // Emit event
      this.emitEvent('tokenRefreshed', { 
        token: result.accessToken,
        expiresAt: this.tokenExpiresAt,
        isNewToken: true
      });

      return this.tokenCache;
    }, operationContext);
  }

  /**
   * Refresh the current access token
   */
  async refreshToken() {
    // Prevent concurrent refresh attempts
    if (this.refreshInProgress) {
      logger.debug('Token refresh already in progress, waiting...');
      return await this.waitForRefreshCompletion();
    }

    this.refreshInProgress = true;
    const currentAttempt = this.refreshAttempts;
    this.refreshAttempts++;

    try {
      const result = await this.acquireNewToken();
      
      // Reset refresh attempts on success
      this.refreshAttempts = 0;
      this.lastRefreshError = null;
      
      logger.info('Token refreshed successfully', {
        attempt: currentAttempt,
        expiresAt: new Date(this.tokenExpiresAt).toISOString()
      });

      return result;
    } catch (error) {
      this.lastRefreshError = error;
      
      logger.error('Token refresh failed:', {
        attempt: currentAttempt,
        error: error.message,
        maxRetries: this.config.maxRetries
      });

      throw error;
    } finally {
      this.refreshInProgress = false;
    }
  }

  /**
   * Wait for ongoing refresh to complete
   */
  async waitForRefreshCompletion() {
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 100; // 100ms
    let waitTime = 0;

    while (this.refreshInProgress && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
    }

    if (this.refreshInProgress) {
      throw new Error('Token refresh timeout - operation took too long');
    }

    if (this.lastRefreshError) {
      throw this.lastRefreshError;
    }

    return this.tokenCache;
  }

  /**
   * Cache token with expiration metadata
   */
  cacheToken(tokenResult) {
    this.tokenCache = tokenResult.accessToken;
    this.tokenAcquiredAt = Date.now();
    
    // Calculate actual expiration time
    const actualExpiresAt = tokenResult.expiresOn instanceof Date 
      ? tokenResult.expiresOn.getTime() 
      : new Date(tokenResult.expiresOn).getTime();
    
    // Store the actual expiration time
    this.tokenExpiresAt = actualExpiresAt;
    
    // Calculate refresh threshold time (when we should proactively refresh)
    const tokenLifetime = actualExpiresAt - this.tokenAcquiredAt;
    this.refreshThresholdTime = this.tokenAcquiredAt + (tokenLifetime * this.config.refreshThreshold);

    logger.debug('Token cached successfully', {
      acquiredAt: new Date(this.tokenAcquiredAt).toISOString(),
      expiresAt: new Date(this.tokenExpiresAt).toISOString(),
      refreshThreshold: `${this.config.refreshThreshold * 100}%`
    });
  }

  /**
   * Check if current token is valid
   */
  isTokenValid() {
    if (!this.tokenCache || !this.tokenExpiresAt) {
      return false;
    }

    const now = Date.now();
    const isValid = now < this.tokenExpiresAt;
    
    if (!isValid) {
      logger.debug('Token validation failed - token expired', {
        now: new Date(now).toISOString(),
        expiresAt: new Date(this.tokenExpiresAt).toISOString()
      });
    }

    return isValid;
  }

  /**
   * Check if token should be proactively refreshed
   */
  shouldRefreshToken() {
    if (!this.tokenCache || !this.tokenExpiresAt || !this.tokenAcquiredAt) {
      return false;
    }

    const now = Date.now();
    const tokenLifetime = this.tokenExpiresAt - this.tokenAcquiredAt;
    const refreshThresholdTime = this.tokenAcquiredAt + (tokenLifetime * this.config.refreshThreshold);
    const shouldRefresh = now >= refreshThresholdTime;
    
    if (shouldRefresh) {
      logger.debug('Token should be refreshed', {
        now: new Date(now).toISOString(),
        refreshThreshold: new Date(refreshThresholdTime).toISOString()
      });
    }

    return shouldRefresh;
  }

  /**
   * Validate token before critical operations
   */
  async validateTokenForOperation(operationName) {
    logger.debug(`Validating token for operation: ${operationName}`);
    
    try {
      const token = await this.getValidToken();
      
      this.logAuthenticationEvent('token_validated', {
        operation: operationName,
        tokenAge: this.tokenAcquiredAt ? Date.now() - this.tokenAcquiredAt : null,
        timeUntilExpiry: this.tokenExpiresAt ? this.tokenExpiresAt - Date.now() : null
      });

      return token;
    } catch (error) {
      this.logAuthenticationEvent('token_validation_failed', {
        operation: operationName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute fallback authentication strategies
   */
  async executeFallbackStrategy(originalError) {
    logger.warn('Executing fallback authentication strategy', {
      originalError: originalError.message,
      refreshAttempts: this.refreshAttempts
    });

    // Fallback strategy 1: Clear cache and retry
    if (this.refreshAttempts === 1) {
      logger.info('Fallback 1: Clearing token cache and retrying');
      this.clearTokenCache();
      
      try {
        return await this.acquireNewToken();
      } catch (error) {
        logger.error('Fallback 1 failed:', error);
      }
    }

    // Fallback strategy 2: Reinitialize MSAL client
    if (this.refreshAttempts === 2) {
      logger.info('Fallback 2: Reinitializing MSAL client');
      this.reinitializeMsalClient();
      
      try {
        return await this.acquireNewToken();
      } catch (error) {
        logger.error('Fallback 2 failed:', error);
      }
    }

    // Fallback strategy 3: Extended retry with exponential backoff
    if (this.refreshAttempts <= this.config.maxRetries) {
      const delay = Math.min(this.config.retryDelay * Math.pow(2, this.refreshAttempts), 30000);
      logger.info(`Fallback 3: Extended retry after ${delay}ms delay`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        return await this.acquireNewToken();
      } catch (error) {
        logger.error('Fallback 3 failed:', error);
      }
    }

    // All fallback strategies failed
    this.emitEvent('fallbackActivated', { 
      originalError,
      attempts: this.refreshAttempts,
      allStrategiesFailed: true
    });

    throw new Error(`Authentication failed after ${this.refreshAttempts} attempts and all fallback strategies. Original error: ${originalError.message}`);
  }

  /**
   * Clear token cache
   */
  clearTokenCache() {
    logger.debug('Clearing token cache');
    this.tokenCache = null;
    this.tokenExpiresAt = null;
    this.refreshThresholdTime = null;
    this.tokenAcquiredAt = null;
    this.lastRefreshError = null;
  }

  /**
   * Reinitialize MSAL client
   */
  reinitializeMsalClient() {
    logger.debug('Reinitializing MSAL client');
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: this.config.clientId,
        authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
        clientSecret: this.config.clientSecret
      }
    });
  }

  /**
   * Start background token monitoring
   */
  startTokenMonitoring() {
    if (this.monitoringTimer) {
      logger.debug('Token monitoring already started');
      return;
    }

    logger.info('Starting background token monitoring', {
      interval: `${this.config.monitoringInterval / 1000}s`
    });

    this.monitoringTimer = setInterval(async () => {
      try {
        await this.performTokenHealthCheck();
      } catch (error) {
        logger.error('Token health check failed:', error);
      }
    }, this.config.monitoringInterval);

    // Ensure timer doesn't prevent process exit
    this.monitoringTimer.unref();
  }

  /**
   * Stop background token monitoring
   */
  stopTokenMonitoring() {
    if (this.monitoringTimer) {
      logger.info('Stopping background token monitoring');
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * Perform token health check
   */
  async performTokenHealthCheck() {
    logger.debug('Performing token health check');

    try {
      // Check if token needs refresh
      if (this.shouldRefreshToken() && !this.refreshInProgress) {
        logger.info('Health check detected token needs refresh');
        await this.refreshToken();
      }

      // Log token status
      this.logTokenStatus();

    } catch (error) {
      logger.error('Token health check encountered error:', error);
      
      this.emitEvent('authenticationFailed', {
        error: error.message,
        context: 'health_check'
      });
    }
  }

  /**
   * Log current token status
   */
  logTokenStatus() {
    if (!this.tokenCache) {
      logger.debug('Token status: No token cached');
      return;
    }

    const now = Date.now();
    const timeUntilExpiry = this.tokenExpiresAt ? this.tokenExpiresAt - now : null;
    const tokenAge = this.tokenAcquiredAt ? now - this.tokenAcquiredAt : null;

    logger.debug('Token status:', {
      hasToken: !!this.tokenCache,
      isValid: this.isTokenValid(),
      shouldRefresh: this.shouldRefreshToken(),
      timeUntilExpiry: timeUntilExpiry ? `${Math.round(timeUntilExpiry / 1000)}s` : null,
      tokenAge: tokenAge ? `${Math.round(tokenAge / 1000)}s` : null,
      refreshInProgress: this.refreshInProgress,
      refreshAttempts: this.refreshAttempts
    });
  }

  /**
   * Log authentication events with structured data
   */
  logAuthenticationEvent(eventType, data = {}) {
    const eventData = {
      eventType,
      timestamp: new Date().toISOString(),
      clientId: this.config.clientId,
      tenantId: this.config.tenantId,
      ...data
    };

    logger.info(`Authentication event: ${eventType}`, eventData);
  }

  /**
   * Add event listener
   */
  addEventListener(eventType, callback) {
    if (!this.eventListeners[eventType]) {
      this.eventListeners[eventType] = [];
    }
    this.eventListeners[eventType].push(callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(eventType, callback) {
    if (this.eventListeners[eventType]) {
      const index = this.eventListeners[eventType].indexOf(callback);
      if (index > -1) {
        this.eventListeners[eventType].splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  emitEvent(eventType, data) {
    if (this.eventListeners[eventType]) {
      this.eventListeners[eventType].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logger.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Get authentication status and metrics
   */
  getStatus() {
    const now = Date.now();
    return {
      hasToken: !!this.tokenCache,
      isValid: this.isTokenValid(),
      shouldRefresh: this.shouldRefreshToken(),
      refreshInProgress: this.refreshInProgress,
      refreshAttempts: this.refreshAttempts,
      tokenAcquiredAt: this.tokenAcquiredAt ? new Date(this.tokenAcquiredAt).toISOString() : null,
      tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      timeUntilExpiry: this.tokenExpiresAt ? Math.max(0, this.tokenExpiresAt - now) : null,
      tokenAge: this.tokenAcquiredAt ? now - this.tokenAcquiredAt : null,
      lastRefreshError: this.lastRefreshError ? this.lastRefreshError.message : null,
      monitoringActive: !!this.monitoringTimer,
      config: {
        refreshThreshold: this.config.refreshThreshold,
        monitoringInterval: this.config.monitoringInterval,
        maxRetries: this.config.maxRetries
      }
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    logger.info('Destroying AuthenticationManager');
    this.stopTokenMonitoring();
    this.clearTokenCache();
    this.eventListeners = {};
  }
}

module.exports = { AuthenticationManager };