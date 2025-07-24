const { createClient } = require('@supabase/supabase-js');
const { dbLogger } = require('../utils/logger');

class SupabaseClient {
  constructor() {
    this._client = null;
    this._initialized = false;
    this.config = null;
  }

  _initialize() {
    if (this._initialized) {
      return;
    }

    // Validate required environment variables
    if (!process.env.SUPABASE_URL) {
      throw new Error('SUPABASE_URL is required');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
    }

    this.config = {
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: process.env.SUPABASE_ANON_KEY,
      options: {
        auth: {
          autoRefreshToken: true,
          persistSession: false
        },
        db: {
          schema: 'public'
        },
        global: {
          headers: {
            'X-Client-Info': 'shedsuite-supabase-sync'
          }
        }
      }
    };

    // Create Supabase client
    this._client = createClient(
      this.config.url,
      this.config.serviceRoleKey,
      this.config.options
    );

    dbLogger.info('Supabase client initialized', {
      url: this.config.url,
      hasAnonKey: !!this.config.anonKey
    });

    this._initialized = true;
  }

  get client() {
    this._initialize();
    return this._client;
  }

  // Health check for Supabase connection
  async healthCheck() {
    try {
      this._initialize();
      
      // Test connection by making a simple query
      const { data, error } = await this.client
        .from('shedsuite_orders')
        .select('count')
        .limit(1);

      if (error) {
        throw error;
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        connection: 'active'
      };
    } catch (error) {
      dbLogger.error('Supabase health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        connection: 'failed',
        error: error.message
      };
    }
  }

  // Insert or update customer orders
  async upsertCustomerOrders(orders) {
    try {
      this._initialize();
      
      if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error('Orders must be a non-empty array');
      }

      dbLogger.info('Upserting customer orders', {
        count: orders.length,
        firstOrderId: orders[0]?.id,
        lastOrderId: orders[orders.length - 1]?.id
      });

      const { data, error } = await this.client
        .from('shedsuite_orders')
        .upsert(orders, {
          onConflict: 'id',
          ignoreDuplicates: false
        })
        .select();

      if (error) {
        throw error;
      }

      dbLogger.info('Customer orders upserted successfully', {
        inserted: data.length,
        totalProcessed: orders.length
      });

      return {
        success: true,
        inserted: data.length,
        totalProcessed: orders.length,
        data
      };
    } catch (error) {
      dbLogger.error('Failed to upsert customer orders', {
        error: error.message,
        count: orders.length
      });
      throw error;
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