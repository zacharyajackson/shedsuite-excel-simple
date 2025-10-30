'use strict';

const { SupabaseClient } = require('../services/supabase-client');

/**
 * InventoryClient - Supabase-based client for inventory operations
 * 
 * This class provides a Supabase-backed interface for inventory sync operations,
 * maintaining compatibility with the existing interface while leveraging Supabase's
 * powerful query capabilities.
 */
class InventoryClient {
  constructor(config, logger) {
    this.logger = logger;
    this.supabaseClient = new SupabaseClient(logger);
    this.initialized = false;
  }

  /**
   * Initialize the client and ensure the inventory_items table exists
   * 
   * Note: Table creation should be done via Supabase dashboard or migrations.
   * This method attempts to create the table but will continue if it fails.
   */
  async init() {
    if (this.initialized) return;
    
    // Ensure Supabase client is initialized
    const client = this.supabaseClient.client;
    
    // Note: Supabase doesn't support CREATE TABLE via RPC by default
    // Table should be created via Supabase dashboard SQL editor or migrations
    // We'll just mark as initialized - table should already exist
    if (this.logger) {
      this.logger.debug({
        context: 'table-init',
        note: 'Ensure inventory_items table exists in Supabase. See table schema in comments below.'
      }, 'Initializing inventory client');

      // Log the expected table schema for reference
      this.logger.debug({
        schema: `
          CREATE TABLE IF NOT EXISTS inventory_items (
            inventory_id text PRIMARY KEY,
            sku text,
            status text,
            location text,
            width_inches bigint,
            length_inches bigint,
            height_inches bigint,
            color text,
            material text,
            price double precision,
            cost double precision,
            created_at timestamptz,
            updated_at timestamptz,
            is_available boolean,
            vendor_name text,
            model text,
            synced_at timestamptz
          );
        `
      }, 'Expected table schema');
    }

    this.initialized = true;
  }

  /**
   * Convert inventory row object to database format
   */
  static toDbRow(row) {
    return {
      inventory_id: row.inventoryId ?? null,
      sku: row.sku ?? null,
      status: row.status ?? null,
      location: row.location ?? null,
      width_inches: row.widthInches ?? null,
      length_inches: row.lengthInches ?? null,
      height_inches: row.heightInches ?? null,
      color: row.color ?? null,
      material: row.material ?? null,
      price: row.price ?? null,
      cost: row.cost ?? null,
      created_at: row.createdAt ?? null,
      updated_at: row.updatedAt ?? null,
      is_available: row.isAvailable ?? null,
      vendor_name: row.vendorName ?? null,
      model: row.model ?? null,
      synced_at: null // Will be set during upsert
    };
  }

  /**
   * Upsert inventory rows into Supabase
   * 
   * Uses Supabase's upsert with onConflict to handle inserts and updates efficiently.
   */
  async upsertInventoryRows(rows, batchSize = 1000, runTimestampIso) {
    await this.init();
    
    if (!rows || rows.length === 0) {
      return { inserted: 0, batches: 0 };
    }

    const client = this.supabaseClient.client;
    let inserted = 0;
    let batches = 0;

    // Process in batches
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      
      // Convert to database format and add synced_at timestamp
      const dbRows = slice.map(row => {
        const dbRow = InventoryClient.toDbRow(row);
        dbRow.synced_at = runTimestampIso;
        return dbRow;
      });

      // Use Supabase upsert with conflict resolution on inventory_id
      const { data, error } = await client
        .from('inventory_items')
        .upsert(dbRows, {
          onConflict: 'inventory_id',
          ignoreDuplicates: false
        })
        .select();

      if (error) {
        if (this.logger) {
          this.logger.error({
            error: error.message,
            errorCode: error.code,
            errorDetails: error.details,
            batchIndex: batches + 1,
            batchSize: dbRows.length,
            context: 'inventory-upsert'
          }, 'Failed to upsert inventory batch');
        }
        throw error;
      }

      inserted += data ? data.length : slice.length;
      batches += 1;

      if (this.logger && batches % 10 === 0) {
        this.logger.debug({
          batches,
          totalInserted: inserted,
          batchSize: dbRows.length
        }, 'Inventory upsert progress');
      }
    }

    if (this.logger) {
      this.logger.info({
        totalInserted: inserted,
        batches,
        totalRows: rows.length
      }, 'Inventory upsert completed');
    }

    return { inserted, batches };
  }

  /**
   * Delete inventory items that were not synced in the current run
   * 
   * This ensures the database reflects only items that exist in the current sync.
   * Uses Supabase filters to delete items where synced_at is NULL or doesn't match.
   */
  async deleteNotSynced(currentRunIso) {
    await this.init();
    
    const client = this.supabaseClient.client;

    // Delete items where synced_at is NULL or doesn't match current run
    // Using separate queries for NULL and not-equal conditions since OR with timestamps
    // can be problematic with Supabase PostgREST filter syntax
    // We'll do two separate delete operations and sum the results
    
    let totalDeleted = 0;
    
    // First: Delete items where synced_at is NULL
    const { data: nullData, error: nullError } = await client
      .from('inventory_items')
      .delete()
      .is('synced_at', null)
      .select();
    
    if (nullError) {
      if (this.logger) {
        this.logger.error({
          error: nullError.message,
          errorCode: nullError.code,
          context: 'inventory-delete-null'
        }, 'Failed to delete items with NULL synced_at');
      }
      throw nullError;
    }
    
    totalDeleted += nullData ? nullData.length : 0;
    
    // Second: Delete items where synced_at doesn't match current run
    // Use .neq() for not equal comparison
    const { data: neqData, error: neqError } = await client
      .from('inventory_items')
      .delete()
      .neq('synced_at', currentRunIso)
      .select();
    
    if (neqError) {
      if (this.logger) {
        this.logger.error({
          error: neqError.message,
          errorCode: neqError.code,
          context: 'inventory-delete-neq'
        }, 'Failed to delete items with mismatched synced_at');
      }
      throw neqError;
    }
    
    totalDeleted += neqData ? neqData.length : 0;
    
    const data = [...(nullData || []), ...(neqData || [])];

    // Note: We've already handled errors above, so we can just use the totalDeleted count

    if (this.logger) {
      if (totalDeleted > 0) {
        this.logger.info({
          deletedCount: totalDeleted,
          currentRunIso,
          nullCount: nullData ? nullData.length : 0,
          neqCount: neqData ? neqData.length : 0
        }, `Deleted ${totalDeleted} inventory items not in current sync`);
      } else {
        this.logger.debug({
          currentRunIso
        }, 'No unsynced items to delete - database is in sync');
      }
    }

    return totalDeleted;
  }
}

/**
 * Create a Supabase-based inventory client
 * 
 * @param {Object} config - Configuration object with Supabase settings
 * @param {Object} logger - Pino logger instance
 * @returns {InventoryClient} Configured inventory client instance
 */
function createPostgresClient(config, logger) {
  // Support both SUPABASE_URL and DATABASE_URL for backward compatibility
  const hasSupabaseUrl = process.env.SUPABASE_URL && process.env.SUPABASE_URL.trim() !== '';
  const hasDatabaseUrl = config.state.databaseUrl && config.state.databaseUrl.trim() !== '';

  if (!hasSupabaseUrl && !hasDatabaseUrl) {
    throw new Error(
      'SUPABASE_URL or DATABASE_URL is required for Supabase/Postgres sink. ' +
      'Please set SUPABASE_URL in your .env file (format: https://your-project.supabase.co) ' +
      'and SUPABASE_SERVICE_ROLE_KEY from Supabase Dashboard -> Settings -> API'
    );
  }

  // If SUPABASE_URL is not set but DATABASE_URL is, extract URL from connection string
  // This allows migration from raw PostgreSQL connection string to Supabase
  if (!hasSupabaseUrl && hasDatabaseUrl) {
    // Extract Supabase project URL from PostgreSQL connection string
    // Format: postgresql://user:pass@host:port/database
    // Supabase host format: xyzabc123.supabase.co
    const dbUrl = config.state.databaseUrl;
    const match = dbUrl.match(/@([^:]+):\d+/);
    if (match) {
      const host = match[1];
      // Construct Supabase URL (assuming standard Supabase format)
      // If host contains .supabase.co, extract the project ref
      if (host.includes('.supabase.co')) {
        const projectRef = host.split('.')[0];
        process.env.SUPABASE_URL = `https://${projectRef}.supabase.co`;
        
        if (logger) {
          logger.warn({
            extractedUrl: process.env.SUPABASE_URL,
            context: 'supabase-config'
          }, 'Extracted SUPABASE_URL from DATABASE_URL - consider setting SUPABASE_URL directly in .env file');
        }
      } else {
        throw new Error(
          `Could not extract Supabase URL from DATABASE_URL. ` +
          `Host "${host}" does not match expected Supabase format (xxx.supabase.co). ` +
          `Please set SUPABASE_URL directly in your .env file.`
        );
      }
    } else {
      throw new Error(
        `Could not parse DATABASE_URL to extract Supabase URL. ` +
        `Please set SUPABASE_URL directly in your .env file (format: https://your-project.supabase.co)`
      );
    }
  }

  // Ensure SUPABASE_SERVICE_ROLE_KEY is set
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.trim() === '') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required. ' +
      'Find it in Supabase Dashboard -> Settings -> API -> service_role (secret)'
    );
  }

  return new InventoryClient(config, logger);
}

module.exports = { createPostgresClient };

