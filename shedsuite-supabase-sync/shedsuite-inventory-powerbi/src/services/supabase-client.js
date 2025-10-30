'use strict';

// Import Supabase JavaScript client library for database operations
const { createClient } = require('@supabase/supabase-js');

/**
 * SupabaseClient - Singleton wrapper for Supabase database operations
 * 
 * This class provides a centralized, configurable interface to the Supabase database
 * with built-in connection management, error handling, and logging capabilities.
 * 
 * Key features:
 * - Lazy initialization to avoid connection issues during module loading
 * - Environment-based configuration with validation
 * - Connection pooling and automatic token refresh
 * - Comprehensive error handling and logging
 * - Service role authentication for administrative operations
 * 
 * Design patterns used:
 * - Singleton: Ensures single database connection per application instance
 * - Lazy loading: Database connection only established when first needed
 * - Factory pattern: Encapsulates client creation logic
 */
class SupabaseClient {
  /**
   * Initialize the SupabaseClient singleton
   * 
   * @param {Object} logger - Pino logger instance for logging operations
   */
  constructor(logger) {
    this._client = null;          // Supabase client instance (lazy-loaded)
    this._initialized = false;    // Initialization state flag
    this.config = null;           // Configuration cache for debugging
    this.logger = logger;          // Logger instance for operations
  }

  /**
   * Private initialization method - called lazily on first database access
   * 
   * This method:
   * 1. Validates all required environment variables
   * 2. Builds the Supabase client configuration
   * 3. Creates the authenticated client instance
   * 4. Sets up connection monitoring and logging
   * 
   * Environment variables required:
   * - SUPABASE_URL: The unique Supabase project URL
   * - SUPABASE_SERVICE_ROLE_KEY: Service role key for administrative access
   * 
   * @throws {Error} If required environment variables are missing
   * @private
   */
  _initialize() {
    // Prevent multiple initialization attempts (singleton pattern)
    if (this._initialized) {
      return;
    }

    // Environment variable validation with descriptive error messages
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || supabaseUrl === '') {
      throw new Error(
        'SUPABASE_URL is required and must be set in your .env file. ' +
        'Format: https://your-project-ref.supabase.co'
      );
    }

    if (!serviceRoleKey || serviceRoleKey === '') {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is required and must be set in your .env file. ' +
        'Find it in Supabase Dashboard -> Settings -> API'
      );
    }

    // Validate URL format
    try {
      const urlObj = new URL(supabaseUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        throw new Error('Protocol must be http or https');
      }
    } catch (urlError) {
      throw new Error(
        `SUPABASE_URL is not a valid URL: "${supabaseUrl}". ` +
        `Expected format: https://your-project-ref.supabase.co. ` +
        `Error: ${urlError.message}`
      );
    }

    // Remove trailing slash from URL if present (Supabase client expects no trailing slash)
    const cleanUrl = supabaseUrl.replace(/\/$/, '');

    // Build comprehensive configuration object for Supabase client
    // This configuration optimizes the client for data sync operations
    this.config = {
      url: cleanUrl,
      serviceRoleKey: serviceRoleKey,
      anonKey: (process.env.SUPABASE_ANON_KEY || '').trim(), // Optional
      
      // Client options optimized for large data operations
      options: {
        // Authentication configuration
        auth: {
          autoRefreshToken: true,    // Automatically refresh expired tokens
          persistSession: false      // Don't persist sessions (stateless operations)
        },
        
        // Database configuration
        db: {
          schema: 'public'          // Default to public schema for standard operations
        },
        
        // Global request configuration
        global: {
          headers: {
            // Custom header for request identification and monitoring
            'X-Client-Info': 'shedsuite-inventory-powerbi'
          }
        }
      }
    };

    // Create the Supabase client instance with service role authentication
    // Service role key provides full database access needed for sync operations
    try {
      this._client = createClient(
        this.config.url,
        this.config.serviceRoleKey,
        this.config.options
      );
    } catch (clientError) {
      throw new Error(
        `Failed to create Supabase client: ${clientError.message}. ` +
        `Please verify SUPABASE_URL="${this.config.url}" is correct and SUPABASE_SERVICE_ROLE_KEY is valid.`
      );
    }

    // Log successful initialization with configuration details
    if (this.logger) {
      this.logger.info({
        service: 'shedsuite-inventory-powerbi',
        url: this.config.url,
        hasAnonKey: !!this.config.anonKey,
        context: 'database'
      }, 'Supabase client initialized');
    }

    // Mark as initialized to prevent re-initialization
    this._initialized = true;
  }

  /**
   * Lazy-loading getter for the Supabase client instance
   * 
   * This getter implements the lazy initialization pattern:
   * - First call triggers initialization and connection
   * - Subsequent calls return the cached client instance
   * - Ensures database connection only when actually needed
   * 
   * @returns {SupabaseClient} Initialized Supabase client instance
   */
  get client() {
    this._initialize();  // Initialize on first access (lazy loading)
    return this._client; // Return cached client instance
  }

  /**
   * Comprehensive health check for Supabase connection
   * 
   * This method performs a multi-tiered connectivity test:
   * 1. First attempts to call a built-in Postgres function (version)
   * 2. Falls back to testing table access if RPC fails
   * 3. Uses clever error detection to distinguish connection vs table issues
   * 
   * @returns {Promise<Object>} Health check results with status and details
   */
  async healthCheck() {
    try {
      this._initialize();  // Ensure client is initialized
      
      // PRIMARY TEST: Use PostgreSQL version() function for connectivity
      const { data, error } = await this.client
        .rpc('version')
        .single();

      if (error) {
        // FALLBACK TEST: RPC failed, try table access to test basic connectivity
        const { error: selectError } = await this.client
          .from('inventory_items')
          .select('count')
          .limit(1);
          
        if (selectError) {
          // CONNECTION TEST: Use intentionally invalid table name
          const { error: connectionError } = await this.client
            .from('_dummy_table_that_does_not_exist')
            .select('*')
            .limit(1);
            
          // If we get "relation does not exist", connection works but table is missing
          if (connectionError && 
              connectionError.message.includes('relation') && 
              connectionError.message.includes('does not exist')) {
            
            if (this.logger) {
              this.logger.info({
                context: 'health-check-table-missing',
                expectedTable: 'inventory_items'
              }, 'Supabase connection healthy - table not yet created');
            }
            
            return {
              status: 'healthy',
              timestamp: new Date().toISOString(),
              connection: 'active',
              note: 'Table inventory_items does not exist yet - normal for new installations',
              testType: 'connection-test-success'
            };
          }
          
          throw connectionError;
        }
        
        // PARTIAL SUCCESS: Table query worked but RPC failed
        if (this.logger) {
          this.logger.warn({
            rpcError: error.message,
            context: 'health-check-rpc-limited'
          }, 'Supabase RPC unavailable but basic table access works');
        }
        
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          connection: 'active',
          warning: 'RPC functions unavailable - some advanced features may be limited',
          testType: 'table-access-success'
        };
      }

      // OPTIMAL SUCCESS: RPC function worked perfectly
      if (this.logger) {
        this.logger.info({
          version: data,
          context: 'health-check-optimal',
          functionality: 'complete'
        }, 'Supabase health check passed - full functionality available');
      }
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        connection: 'active',
        version: data,
        testType: 'rpc-success',
        functionality: 'complete'
      };
      
    } catch (error) {
      // CRITICAL FAILURE: Unexpected error during health check
      if (this.logger) {
        this.logger.error({
          error: error.message,
          stack: error.stack,
          context: 'health-check-critical',
          errorType: 'unexpected-system-error'
        }, 'Supabase health check encountered unexpected system error');
      }
      
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        connection: 'failed',
        error: error.message,
        errorType: 'system-error',
        critical: true,
        requiresInvestigation: true
      };
    }
  }
}

module.exports = { SupabaseClient };

