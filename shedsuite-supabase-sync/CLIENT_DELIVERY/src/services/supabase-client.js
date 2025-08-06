// Import Supabase JavaScript client library for database operations
const { createClient } = require('@supabase/supabase-js');
// Import custom database logger for connection monitoring and debugging
const { dbLogger } = require('../utils/logger');

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
   * Private properties:
   * - _client: The actual Supabase client instance (null until initialized)
   * - _initialized: Flag to prevent multiple initialization attempts
   * - config: Cached configuration object for debugging and reference
   */
  constructor() {
    this._client = null;          // Supabase client instance (lazy-loaded)
    this._initialized = false;    // Initialization state flag
    this.config = null;          // Configuration cache for debugging
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
   * - SUPABASE_ANON_KEY: Anonymous key for public access (optional)
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
    // These environment variables must be set in .env file
    if (!process.env.SUPABASE_URL) {
      throw new Error('SUPABASE_URL is required - check your .env file configuration');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required - check your .env file configuration');
    }

    // Build comprehensive configuration object for Supabase client
    // This configuration optimizes the client for data export operations
    this.config = {
      url: process.env.SUPABASE_URL,                    // Supabase project URL
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,  // Admin access key
      anonKey: process.env.SUPABASE_ANON_KEY,          // Public access key (optional)
      
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
            'X-Client-Info': 'shedsuite-supabase-sync'
          }
        }
      }
    };

    // Create the Supabase client instance with service role authentication
    // Service role key provides full database access needed for export operations
    this._client = createClient(
      this.config.url,           // Project-specific Supabase URL
      this.config.serviceRoleKey, // Service role key for administrative operations
      this.config.options        // Optimized configuration for data operations
    );

    // Log successful initialization with configuration details
    // This helps with debugging connection issues and monitoring
    dbLogger.info('Supabase client initialized', {
      service: 'shedsuite-supabase-sync',     // Service identifier
      url: this.config.url,                   // Database URL (for debugging)
      hasAnonKey: !!this.config.anonKey,      // Whether anon key is configured
      context: 'database'                     // Log context for filtering
    });

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
   * 4. Provides detailed status information for monitoring
   * 
   * Use cases:
   * - Application startup validation
   * - Monitoring and alerting systems
   * - Debugging connection issues
   * - Pre-export connectivity verification
   * 
   * @returns {Promise<Object>} Health check results with status and details
   * @throws {Error} Only for unexpected system errors (connection errors are caught)
   */
  async healthCheck() {
    try {
      this._initialize();  // Ensure client is initialized
      
      // PRIMARY TEST: Use PostgreSQL version() function for connectivity
      // This is a lightweight operation that tests both network and auth
      const { data, error } = await this.client
        .rpc('version')      // Call built-in PostgreSQL version function
        .single();           // Expect single result

      if (error) {
        // FALLBACK TEST: RPC failed, try table access to test basic connectivity
        // This tests table-level permissions and schema access
        const { error: selectError } = await this.client
          .from('shedsuite_orders')    // Known table from the export system
          .select('count')             // Minimal data selection
          .limit(1);                   // Single record to minimize load
          
        if (selectError) {
          // CLEVER CONNECTIVITY TEST: Use intentionally invalid table name
          // If we get "relation does not exist", it means connection works but table is missing
          // If we get auth/network errors, it means deeper connectivity issues
          const { error: connectionError } = await this.client
            .from('_dummy_table_that_does_not_exist')  // Intentionally invalid table
            .select('*')                               // Any selection
            .limit(1);                                 // Minimal query
            
          // SMART ERROR ANALYSIS: Parse error message to determine root cause
          // "relation does not exist" = good connection, missing table
          // Other errors = connectivity, auth, or network issues
          if (connectionError && 
              connectionError.message.includes('relation') && 
              connectionError.message.includes('does not exist')) {
            
            // SUCCESS: Connection works, table just doesn't exist yet
            // This is normal for fresh installations before data migration
            dbLogger.info('Supabase connection healthy - table not yet created', {
              context: 'health-check-table-missing',
              expectedTable: 'shedsuite_orders'
            });
            
            return {
              status: 'healthy',                     // Connection works
              timestamp: new Date().toISOString(),   // Check timestamp
              connection: 'active',                  // Network connectivity good
              note: 'Table shedsuite_orders does not exist yet - normal for new installations',
              testType: 'connection-test-success'    // Test method used
            };
          }
          
          // CRITICAL ERROR: Even dummy table test failed - serious connectivity issue
          throw connectionError;
        }
        
        // PARTIAL SUCCESS: Table query worked but RPC failed
        // This indicates basic connectivity but limited functionality
        dbLogger.warn('Supabase RPC unavailable but basic table access works', {
          rpcError: error.message,
          context: 'health-check-rpc-limited'
        });
        
        return {
          status: 'healthy',                       // Basic functionality works
          timestamp: new Date().toISOString(),     // Check timestamp
          connection: 'active',                    // Network connectivity good
          warning: 'RPC functions unavailable - some advanced features may be limited',
          testType: 'table-access-success'        // Test method used
        };
      }

      // OPTIMAL SUCCESS: RPC function worked perfectly
      // This indicates full Supabase functionality is available
      dbLogger.info('Supabase health check passed - full functionality available', {
        version: data,                       // PostgreSQL version info
        context: 'health-check-optimal',     // Log context
        functionality: 'complete'            // Full feature availability
      });
      
      return {
        status: 'healthy',                   // Perfect health
        timestamp: new Date().toISOString(), // Check timestamp
        connection: 'active',                // Network connectivity excellent
        version: data,                       // Database version info
        testType: 'rpc-success',             // RPC test succeeded
        functionality: 'complete'            // All features available
      };
      
    } catch (error) {
      // CRITICAL FAILURE: Unexpected error during health check
      // This indicates severe system, network, or configuration issues
      dbLogger.error('Supabase health check encountered unexpected system error', { 
        error: error.message,                // Error details
        stack: error.stack,                  // Stack trace for debugging
        context: 'health-check-critical',    // Log context
        errorType: 'unexpected-system-error' // Error classification
      });
      
      return {
        status: 'unhealthy',                 // Failed health status
        timestamp: new Date().toISOString(), // Error timestamp
        connection: 'failed',                // Connection failed
        error: error.message,                // Error message for debugging
        errorType: 'system-error',           // Error classification
        critical: true,                      // Indicates critical system issue
        requiresInvestigation: true          // Needs immediate attention
      };
    }
  }

  // Insert or update customer orders
  async upsertCustomerOrders(orders) {
    try {
      this._initialize();
      
      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Starting upsert with', orders.length, 'orders');
      
      if (!Array.isArray(orders) || orders.length === 0) {
        console.log('🔧 SupabaseClient.upsertCustomerOrders() - No orders to upsert');
        throw new Error('Orders must be a non-empty array');
      }

      // Log sample order
      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Sample order:', JSON.stringify(orders[0], null, 2));
      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Order IDs:', orders.map(o => o.id).slice(0, 5));

      // CRITICAL: Deduplicate within batch to prevent "cannot affect row a second time" error
      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Deduplicating batch...');
      const orderNumbersSeen = new Set();
      const idsSeen = new Set();
      const deduplicatedOrders = [];
      let duplicatesRemoved = 0;
      
      for (const order of orders) {
        const orderNumber = order.order_number;
        const id = order.id;
        
        if (orderNumbersSeen.has(orderNumber)) {
          duplicatesRemoved++;
          console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Removing duplicate order_number in batch: ${orderNumber} (ID: ${id})`);
          continue;
        }
        
        if (idsSeen.has(id)) {
          duplicatesRemoved++;
          console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Removing duplicate ID in batch: ${id} (order: ${orderNumber})`);
          continue;
        }
        
        orderNumbersSeen.add(orderNumber);
        idsSeen.add(id);
        deduplicatedOrders.push(order);
      }
      
      console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Removed ${duplicatesRemoved} duplicates from batch`);
      console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Proceeding with ${deduplicatedOrders.length} unique orders`);
      
      // Use deduplicated orders for the rest of the function
      const finalOrders = deduplicatedOrders;
      
      // If all orders were duplicates, return early
      if (finalOrders.length === 0) {
        console.log('🔧 SupabaseClient.upsertCustomerOrders() - All orders were duplicates, nothing to upsert');
        return {
          success: true,
          inserted: 0,
          totalProcessed: 0
        };
      }

      dbLogger.info('Upserting customer orders', {
        originalCount: orders.length,
        deduplicatedCount: finalOrders.length,
        duplicatesRemoved: duplicatesRemoved,
        firstOrderId: finalOrders[0]?.id,
        lastOrderId: finalOrders[finalOrders.length - 1]?.id
      });

      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Calling Supabase upsert...');
      
      // For large batches, we might want to split them into smaller chunks for better performance
      const chunkSize = 1000; // Process in chunks of 1000 records
      let totalInserted = 0;
      let totalProcessed = 0;
      
      if (finalOrders.length > chunkSize) {
        console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Large batch detected (${finalOrders.length} records), processing in chunks of ${chunkSize}`);
        dbLogger.info('Large batch detected, processing in chunks', {
          totalRecords: finalOrders.length,
          chunkSize: chunkSize,
          chunks: Math.ceil(finalOrders.length / chunkSize)
        });
        
        for (let i = 0; i < finalOrders.length; i += chunkSize) {
          const chunk = finalOrders.slice(i, i + chunkSize);
          console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Processing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(finalOrders.length/chunkSize)} with ${chunk.length} records`);
          
          const { data, error } = await this.client
            .from('shedsuite_orders')
            .upsert(chunk, {
              onConflict: 'order_number',
              ignoreDuplicates: false
            })
            .select();
            
          if (error) {
            console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Chunk ${Math.floor(i/chunkSize) + 1} failed with error:`, error.message);
            throw error;
          }
          
          totalInserted += data.length;
          totalProcessed += chunk.length;
          
          console.log(`🔧 SupabaseClient.upsertCustomerOrders() - Chunk ${Math.floor(i/chunkSize) + 1} completed: inserted=${data.length}, processed=${chunk.length}`);
        }
      } else {
        // Standard upsert for smaller batches
        const { data, error } = await this.client
          .from('shedsuite_orders')
          .upsert(finalOrders, {
            onConflict: 'order_number',
            ignoreDuplicates: false
          })
          .select();

        if (error) {
          console.log('🔧 SupabaseClient.upsertCustomerOrders() - Supabase upsert failed with error:', error.message);
          throw error;
        }

        totalInserted = data.length;
        totalProcessed = finalOrders.length;

        console.log('🔧 SupabaseClient.upsertCustomerOrders() - Supabase upsert successful:', {
          inserted: data.length,
          totalProcessed: finalOrders.length,
          sampleReturnedData: data.length > 0 ? JSON.stringify(data[0], null, 2) : 'none'
        });
        
        // Log detailed upsert results
        if (data.length > 0) {
          console.log('🔧 SupabaseClient.upsertCustomerOrders() - Upsert result details:', {
            totalRecords: finalOrders.length,
            recordsReturned: data.length,
            firstUpsertedRecord: {
              id: data[0].id,
              customerName: data[0].customer_name,
              orderNumber: data[0].order_number,
              status: data[0].status,
              totalAmount: data[0].total_amount_dollar_amount,
              syncTimestamp: data[0].sync_timestamp
            }
          });
        }
        
        // Log summary of what was upserted (production scale)
        const firstFewUpsertedIds = data.slice(0, 5).map(record => record.id);
        const lastFewUpsertedIds = data.slice(-5).map(record => record.id);
        console.log('🔧 SupabaseClient.upsertCustomerOrders() - Upserted record ID range:', {
          totalUpserted: data.length,
          first5Ids: firstFewUpsertedIds,
          last5Ids: lastFewUpsertedIds,
          idRange: data.length > 0 ? `${data[0].id} to ${data[data.length - 1].id}` : 'none'
        });
      }

      dbLogger.info('Customer orders upserted successfully', {
        inserted: totalInserted,
        totalProcessed: totalProcessed
      });

      return {
        success: true,
        inserted: totalInserted,
        totalProcessed: totalProcessed
      };
    } catch (error) {
      console.log('🔧 SupabaseClient.upsertCustomerOrders() - Failed to upsert customer orders with error:', error.message);
      dbLogger.error('Failed to upsert customer orders', {
        error: error.message,
        count: orders.length,
        stack: error.stack
      });
      // Don't throw the error to prevent application shutdown
      return {
        success: false,
        inserted: 0,
        totalProcessed: finalOrders ? finalOrders.length : orders.length,
        error: error.message
      };
    }
  }

  // Batch insert with error handling
  async batchInsert(tableName, records, batchSize = 100) {
    try {
      this._initialize();
      
      const results = [];
      const errors = [];
      
      // Process in batches
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        try {
          const { data, error } = await this.client
            .from(tableName)
            .insert(batch)
            .select();

          if (error) {
            throw error;
          }

          results.push(...data);
          dbLogger.debug(`Batch ${Math.floor(i / batchSize) + 1} inserted`, {
            batchSize: batch.length,
            totalInserted: results.length
          });
        } catch (batchError) {
          dbLogger.error(`Batch ${Math.floor(i / batchSize) + 1} failed`, {
            error: batchError.message,
            batchSize: batch.length
          });
          errors.push({
            batchIndex: Math.floor(i / batchSize),
            error: batchError.message,
            records: batch
          });
        }
      }

      return {
        success: errors.length === 0,
        inserted: results.length,
        totalProcessed: records.length,
        errors: errors.length,
        errorDetails: errors
      };
    } catch (error) {
      dbLogger.error('Batch insert failed', {
        error: error.message,
        tableName,
        recordCount: records.length
      });
      throw error;
    }
  }

  // Get last sync timestamp
  async getLastSyncTimestamp() {
    try {
      this._initialize();
      
      const { data, error } = await this.client
        .from('sync_metadata')
        .select('last_sync_timestamp')
        .order('last_sync_timestamp', { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      return data[0]?.last_sync_timestamp || null;
    } catch (error) {
      dbLogger.error('Failed to get last sync timestamp', { error: error.message });
      return null;
    }
  }

  // Update sync timestamp
  async updateSyncTimestamp(timestamp = new Date()) {
    try {
      this._initialize();
      
      const { data, error } = await this.client
        .from('sync_metadata')
        .upsert({
          id: 1, // Single record for sync metadata
          last_sync_timestamp: timestamp,
          updated_at: new Date()
        }, {
          onConflict: 'id'
        })
        .select();

      if (error) {
        throw error;
      }

      dbLogger.info('Sync timestamp updated', {
        timestamp: timestamp.toISOString()
      });

      return data[0];
    } catch (error) {
      dbLogger.error('Failed to update sync timestamp', { error: error.message });
      throw error;
    }
  }

  // Get sync statistics
  async getSyncStats() {
    try {
      this._initialize();
      
      const { data, error } = await this.client
        .from('shedsuite_orders')
        .select('created_at, updated_at', { count: 'exact' });

      if (error) {
        throw error;
      }

      const totalRecords = data.length;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayRecords = data.filter(record => 
        new Date(record.created_at) >= today
      ).length;

      return {
        totalRecords,
        todayRecords,
        lastUpdated: data.length > 0 ? Math.max(...data.map(r => new Date(r.updated_at))) : null
      };
    } catch (error) {
      dbLogger.error('Failed to get sync stats', { error: error.message });
      throw error;
    }
  }

  // Clean up old records (optional maintenance function)
  async cleanupOldRecords(daysToKeep = 90) {
    try {
      this._initialize();
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const { data, error } = await this.client
        .from('shedsuite_orders')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select();

      if (error) {
        throw error;
      }

      dbLogger.info('Old records cleaned up', {
        deletedCount: data.length,
        cutoffDate: cutoffDate.toISOString()
      });

      return {
        deletedCount: data.length,
        cutoffDate: cutoffDate.toISOString()
      };
    } catch (error) {
      dbLogger.error('Failed to cleanup old records', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new SupabaseClient(); 