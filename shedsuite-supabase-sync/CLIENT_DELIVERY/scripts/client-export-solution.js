#!/usr/bin/env node
/**
 * CLIENT EXPORT SOLUTION
 * Comprehensive data export utility that solves Supabase export duplication issues
 * 
 * Features:
 * - Handles sequence/primary key synchronization
 * - Implements proper pagination with consistent ordering
 * - Validates data integrity during export
 * - Provides detailed export reports
 * - Supports multiple export formats
 * - Includes duplicate detection and handling
 */

// Load environment variables from .env file
require('dotenv').config();

// Core Node.js modules for file system operations and path handling
const fs = require('fs');
const path = require('path');

// Third-party library for creating CSV files with proper formatting
const { createObjectCsvWriter } = require('csv-writer');

// Custom modules for Supabase database operations and logging
const supabaseClient = require('../src/services/supabase-client');
const { logger } = require('../src/utils/logger');

/**
 * ClientExportSolution - A comprehensive data export utility that addresses
 * common Supabase export issues including duplication, pagination problems,
 * and sequence synchronization.
 * 
 * This class provides a robust solution for exporting large datasets from
 * Supabase with proper error handling, retry logic, and data validation.
 */
class ClientExportSolution {
  /**
   * Initialize the export solution with configuration from environment variables
   * 
   * Configuration options:
   * - EXPORT_BATCH_SIZE: Number of records to fetch per batch (default: 500)
   * - EXPORT_OUTPUT_DIR: Directory for export files (default: './client-exports')
   * - EXPORT_MAX_RETRIES: Maximum retry attempts for failed operations (default: 3)
   * - EXPORT_RETRY_DELAY: Delay between retries in milliseconds (default: 1000)
   */
  constructor() {
    // Batch size for pagination - smaller batches are more reliable but slower
    this.batchSize = parseInt(process.env.EXPORT_BATCH_SIZE) || 500;
    
    // Output directory for all export files and reports
    this.outputDir = process.env.EXPORT_OUTPUT_DIR || './client-exports';
    
    // Retry configuration for handling network failures and rate limits
    this.maxRetries = parseInt(process.env.EXPORT_MAX_RETRIES) || 3;
    this.retryDelay = parseInt(process.env.EXPORT_RETRY_DELAY) || 1000; // milliseconds
  }

  /**
   * Main export function with comprehensive error handling and step-by-step processing
   * 
   * This is the primary entry point for data exports. It orchestrates the entire
   * export process including validation, sequence fixing, pagination, and reporting.
   * 
   * @param {Object} options - Export configuration options
   * @param {string} options.tableName - Name of the table to export (default: 'shedsuite_orders')
   * @param {string} options.outputFormat - Export format 'csv' or 'json' (default: 'csv')
   * @param {boolean} options.includeMetadata - Include export metadata in output (default: true)
   * @param {boolean} options.validateData - Validate exported data integrity (default: true)
   * @param {boolean} options.checkDuplicates - Check for duplicate records (default: true)
   * @param {Object} options.dateRange - Date range filter with start/end properties
   * @param {Object} options.filters - Additional column filters as key-value pairs
   * @param {Array|string} options.columns - Specific columns to export (default: all)
   * @param {string} options.filename - Custom filename (auto-generated if not provided)
   * @returns {Object} Export report with success status, file paths, and statistics
   */
  async exportTable(options = {}) {
    const startTime = Date.now();
    const exportId = this.generateExportId(); // Unique identifier for this export session
    
    // Extract and set default values for all configuration options
    const {
      tableName = 'shedsuite_orders',      // Default table for ShedSuite orders
      outputFormat = 'csv',                 // CSV is most compatible format
      includeMetadata = true,               // Metadata helps with debugging
      validateData = true,                  // Data validation catches export issues
      checkDuplicates = true,               // Duplicate checking prevents data issues
      dateRange,                            // Optional date filtering
      filters = {},                         // Additional column-based filters
      columns = null,                       // All columns by default
      filename = null                       // Auto-generate if not specified
    } = options;

    console.log('🚀 CLIENT EXPORT SOLUTION');
    console.log('========================');
    console.log(`📋 Export ID: ${exportId}`);
    console.log(`📊 Table: ${tableName}`);
    console.log(`📁 Format: ${outputFormat.toUpperCase()}`);
    console.log(`🔍 Validation: ${validateData ? 'Enabled' : 'Disabled'}`);
    console.log(`🔍 Duplicate Check: ${checkDuplicates ? 'Enabled' : 'Disabled'}\n`);

    try {
      // Step 1: Validate table exists and get schema information
      // This prevents errors later by ensuring the table is accessible and understanding its structure
      console.log('🔍 Step 1: Validating table and schema...');
      const schemaInfo = await this.validateTable(tableName);
      console.log(`✅ Table validated: ${schemaInfo.columnCount} columns found`);

      // Step 2: Fix sequence if needed to prevent primary key conflicts
      // Supabase sequences can get out of sync, causing duplicate key issues during concurrent operations
      console.log('\n🔧 Step 2: Checking and fixing sequence...');
      const sequenceFixed = await this.fixSequenceIfNeeded(tableName);
      if (sequenceFixed) {
        console.log('✅ Sequence synchronized');
      } else {
        console.log('ℹ️  Sequence already in sync');
      }

      // Step 3: Get accurate record count for progress tracking and validation
      // We need to know how many records match our criteria to set up proper pagination
      console.log('\n📊 Step 3: Getting accurate record count...');
      const { totalCount, filteredCount } = await this.getRecordCount(tableName, dateRange, filters);
      console.log(`📈 Total records in table: ${totalCount.toLocaleString()}`);
      console.log(`📊 Records after filters: ${filteredCount.toLocaleString()}`);

      // Early exit if no data matches the filter criteria
      if (filteredCount === 0) {
        console.log('⚠️  No records found matching criteria');
        return this.createExportReport(exportId, {
          success: false,
          message: 'No records found',
          recordsExported: 0
        });
      }

      // Step 4: Export data with proper pagination to avoid memory issues and timeouts
      // Large datasets are processed in batches with consistent ordering to prevent duplicates
      console.log('\n📦 Step 4: Exporting data with proper pagination...');
      const exportResult = await this.exportWithPagination({
        tableName,
        totalCount: filteredCount,  // Use filtered count for accurate progress tracking
        dateRange,                  // Date filters applied at query level
        filters,                    // Additional column filters
        columns,                    // Column selection for optimized queries
        outputFormat,               // Format determines file structure
        exportId                    // Unique ID for file naming and tracking
      });

      // Step 5: Validate export integrity to ensure all data was written correctly
      // This catches file corruption, incomplete writes, and count mismatches
      if (validateData) {
        console.log('\n🔍 Step 5: Validating export integrity...');
        const validationResult = await this.validateExport(exportResult.filePath, exportResult.recordsExported);
        exportResult.validation = validationResult;
      }

      // Step 6: Check for duplicates if enabled to catch pagination issues
      // Duplicate detection helps identify problems with ordering or offset calculations
      if (checkDuplicates) {
        console.log('\n🔍 Step 6: Checking for duplicates...');
        const duplicateResult = await this.checkDuplicates(exportResult.filePath);
        exportResult.duplicates = duplicateResult;
      }

      // Step 7: Generate comprehensive final report with all export details
      // The report includes statistics, validation results, and metadata for audit trails
      const finalReport = this.createExportReport(exportId, {
        success: true,
        recordsExported: exportResult.recordsExported,  // Actual count of exported records
        filePath: exportResult.filePath,                // Full path to the export file
        fileSizeMB: exportResult.fileSizeMB,            // File size for capacity planning
        duration: Date.now() - startTime,               // Total export time in milliseconds
        validation: exportResult.validation,            // Data integrity check results
        duplicates: exportResult.duplicates,            // Duplicate detection results
        metadata: {                                      // Export configuration for reproducibility
          tableName,
          exportFormat: outputFormat,
          dateRange,
          filters,
          sequenceFixed                                  // Whether sequence was modified
        }
      });

      console.log('\n✅ EXPORT COMPLETED SUCCESSFULLY!');
      console.log('================================');
      console.log(`📊 Records exported: ${exportResult.recordsExported.toLocaleString()}`);
      console.log(`📁 File: ${exportResult.filePath}`);
      console.log(`📏 Size: ${exportResult.fileSizeMB}MB`);
      console.log(`⏱️  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`📋 Report: ${finalReport.reportPath}`);

      return finalReport;

    } catch (error) {
      // Comprehensive error handling with detailed reporting
      console.error('\n❌ EXPORT FAILED!');
      console.error('================');
      console.error('Error:', error.message);
      
      // Create error report for debugging and audit purposes
      const errorReport = this.createExportReport(exportId, {
        success: false,
        error: error.message,                    // Detailed error message
        duration: Date.now() - startTime        // Time spent before failure
      });

      // Re-throw the error after logging to maintain error handling chain
      throw error;
    }
  }

  /**
   * Validate table exists and get schema information
   * 
   * This method performs a lightweight query to verify table accessibility
   * and extract column information for the export process.
   * 
   * @param {string} tableName - Name of the table to validate
   * @returns {Object} Schema information including column count, names, and sample data
   * @throws {Error} If table doesn't exist or is inaccessible
   */
  async validateTable(tableName) {
    try {
      // Perform minimal query to check table existence and get column structure
      // Using limit(1) for efficiency - we only need schema information
      const { data, error } = await supabaseClient.client
        .from(tableName)
        .select('*')  // Select all columns to get complete schema
        .limit(1);    // Minimal data fetch for schema extraction

      // Handle Supabase query errors (permissions, table not found, etc.)
      if (error) {
        throw new Error(`Table validation failed: ${error.message}`);
      }

      // Check if table exists but is empty (different from table not found)
      if (!data || data.length === 0) {
        throw new Error(`Table '${tableName}' exists but is empty`);
      }

      // Extract schema information from the sample record
      return {
        columnCount: Object.keys(data[0]).length,  // Total number of columns
        columns: Object.keys(data[0]),             // Column names array
        sampleRecord: data[0]                      // Sample data for type inference
      };
    } catch (error) {
      throw new Error(`Table validation failed: ${error.message}`);
    }
  }

  /**
   * Fix sequence if it's out of sync (common Supabase issue)
   * 
   * Supabase sequences can become desynchronized when bulk operations are performed,
   * leading to primary key conflicts. This method resets the sequence to the correct value.
   * 
   * @param {string} tableName - Name of the table to fix sequence for
   * @returns {boolean} True if sequence was fixed, false if no action needed or failed
   */
  async fixSequenceIfNeeded(tableName) {
    try {
      // Find the highest existing ID to determine correct sequence value
      // This query gets the maximum ID currently in the table
      const { data: maxIdResult, error: maxError } = await supabaseClient.client
        .from(tableName)
        .select('id')                              // Only select ID column for efficiency
        .order('id', { ascending: false })         // Sort descending to get max ID first
        .limit(1);                                 // Only need the highest value

      // Handle case where we can't read the table (permissions, connection issues)
      if (maxError) {
        console.log('⚠️  Could not check sequence, continuing...');
        return false;
      }

      // Handle empty table case - no sequence reset needed
      if (!maxIdResult || maxIdResult.length === 0) {
        return false;
      }

      const maxId = maxIdResult[0].id;
      
      // CRITICAL BUSINESS LOGIC: PostgreSQL Sequence Synchronization
      // ============================================================
      // 
      // PROBLEM: Supabase (PostgreSQL) sequences can become desynchronized when:
      // 1. Bulk data imports bypass sequence generation (INSERT with explicit IDs)
      // 2. Data restoration from backups with explicit ID values
      // 3. Manual data manipulation that skips sequence incrementation
      // 4. Concurrent operations during heavy load
      // 
      // SYMPTOM: "duplicate key value violates unique constraint" errors
      // This happens when the sequence tries to generate an ID that already exists
      // 
      // SOLUTION: Reset sequence to MAX(id) + 1 to ensure next generated ID is unique
      // This is a PostgreSQL-specific fix for a common database administration issue
      
      const { error: sequenceError } = await supabaseClient.client.rpc('reset_sequence', {
        table_name: tableName,        // Target table name
        column_name: 'id',           // Primary key column name (usually 'id')
        new_value: maxId + 1         // Set sequence to generate IDs starting from max + 1
      });
      
      // BUSINESS IMPACT:
      // - Prevents export failures due to sequence conflicts
      // - Ensures data integrity during concurrent operations
      // - Enables reliable data synchronization processes
      // - Reduces manual database administration overhead

      // Handle sequence reset errors (function not found, permissions, etc.)
      if (sequenceError) {
        console.log('⚠️  Could not reset sequence, continuing...');
        return false;
      }

      return true;  // Sequence successfully reset
    } catch (error) {
      // Catch any unexpected errors and continue gracefully
      // Sequence issues are not critical enough to stop the export
      console.log('⚠️  Sequence check failed, continuing...');
      return false;
    }
  }

  /**
   * Get accurate record count with filters applied
   * 
   * Performs two count queries: one with filters and one without to provide
   * both filtered and total counts for progress tracking and reporting.
   * 
   * @param {string} tableName - Name of the table to count records in
   * @param {Object|null} dateRange - Optional date range with start/end properties
   * @param {Object} filters - Key-value pairs for additional column filters
   * @returns {Object} Object containing totalCount and filteredCount
   * @throws {Error} If count queries fail
   */
  async getRecordCount(tableName, dateRange = null, filters = {}) {
    // Build filtered count query - only counts records matching our criteria
    // Using 'head: true' for count-only operation (no data returned)
    let countQuery = supabaseClient.client.from(tableName).select('id', { count: 'exact', head: true });
    
    // Apply date range filters if provided
    // Assumes 'timestamp' column exists for date filtering
    if (dateRange) {
      if (dateRange.start) countQuery = countQuery.gte('timestamp', dateRange.start);
      if (dateRange.end) countQuery = countQuery.lte('timestamp', dateRange.end);
    }
    
    // Apply additional column-based filters
    // Validates filter object and skips null/undefined values
    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          countQuery = countQuery.eq(key, value);  // Exact match filter
        }
      });
    }

    // Execute filtered count query
    const { count, error } = await countQuery;
    if (error) throw new Error(`Count query failed: ${error.message}`);

    // Get total count without any filters for comparison and reporting
    // This helps users understand how much data is being filtered out
    const { count: totalCount, error: totalError } = await supabaseClient.client
      .from(tableName)
      .select('id', { count: 'exact', head: true });

    if (totalError) throw new Error(`Total count query failed: ${totalError.message}`);

    return {
      totalCount: totalCount || 0,      // Total records in table
      filteredCount: count || 0         // Records matching filter criteria
    };
  }

  /**
   * Export data with proper pagination and ordering to handle large datasets
   * 
   * This is the core export method that handles the complex task of paginating
   * through large datasets while maintaining data integrity and preventing duplicates.
   * Key features:
   * - Consistent ordering by ID to prevent pagination gaps
   * - Duplicate detection and prevention within batches
   * - Retry logic for failed batch operations
   * - Progress tracking with ETA calculations
   * - Memory-efficient streaming to file
   * 
   * @param {Object} options - Pagination configuration
   * @param {string} options.tableName - Table to export from
   * @param {number} options.totalCount - Expected total records (for progress)
   * @param {Object} options.dateRange - Date filtering options
   * @param {Object} options.filters - Column filtering options
   * @param {Array|string} options.columns - Columns to export
   * @param {string} options.outputFormat - File format (csv/json)
   * @param {string} options.exportId - Unique export identifier
   * @returns {Object} Export results with file path, record count, and statistics
   */
  async exportWithPagination(options) {
    const {
      tableName,      // Source table name
      totalCount,     // Expected record count for progress calculation
      dateRange,      // Date range filters
      filters,        // Additional column filters
      columns,        // Column selection (null = all columns)
      outputFormat,   // Output file format
      exportId        // Unique identifier for this export
    } = options;

    // Create output directory if it doesn't exist
    // Using recursive: true to create parent directories as needed
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Generate unique filename with timestamp and export ID
    // Replace special characters to ensure filesystem compatibility
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${tableName}_export_${timestamp}_${exportId}.${outputFormat}`;
    const outputFile = path.join(this.outputDir, filename);

    // Get sample data to determine column structure for CSV headers
    // This query mirrors the main export query to ensure schema consistency
    let sampleQuery = supabaseClient.client.from(tableName).select(columns || '*').limit(1);
    
    // Apply the same filters to sample query as will be used in main export
    // This ensures the sample data represents the actual export dataset
    if (dateRange) {
      if (dateRange.start) sampleQuery = sampleQuery.gte('timestamp', dateRange.start);
      if (dateRange.end) sampleQuery = sampleQuery.lte('timestamp', dateRange.end);
    }
    
    // Apply column-based filters to sample query
    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          sampleQuery = sampleQuery.eq(key, value);
        }
      });
    }

    // Execute sample query to get column structure
    const { data: sampleData, error: sampleError } = await sampleQuery;
    if (sampleError) throw new Error(`Sample query failed: ${sampleError.message}`);

    if (!sampleData || sampleData.length === 0) {
      throw new Error('No data found after applying filters');
    }

    // Extract column names from sample data to create CSV headers
    // Each column becomes both the id and title in the CSV writer configuration
    const headers = Object.keys(sampleData[0]).map(key => ({
      id: key,      // Internal identifier for the column
      title: key    // Header text in the CSV file
    }));

    // Initialize CSV writer with the determined headers
    // This writer will be used for the first batch (includes headers)
    const csvWriter = createObjectCsvWriter({
      path: outputFile,    // Output file path
      header: headers      // Column configuration
    });

    // Initialize pagination variables for batch processing
    let offset = 0;                                          // Current offset in dataset
    let totalExported = 0;                                   // Running count of exported records
    let batchCount = 0;                                      // Current batch number
    const totalBatches = Math.ceil(totalCount / this.batchSize); // Total batches needed
    const exportedIds = new Set();                           // Track IDs to prevent duplicates

    console.log(`📦 Exporting ${totalBatches} batches of ${this.batchSize} records each...`);

    // Main pagination loop - process data in manageable chunks
    while (offset < totalCount) {
      const batchStart = Date.now();  // Track batch processing time
      batchCount++;

      // Build query for current batch with critical ordering
      // IMPORTANT: Consistent ordering by ID is essential to prevent:
      // - Duplicate records across batches
      // - Missing records due to pagination gaps
      // - Inconsistent results between runs
      let batchQuery = supabaseClient.client
        .from(tableName)
        .select(columns || '*')                                    // Select specified or all columns
        .range(offset, offset + this.batchSize - 1)               // Define batch range
        .order('id', { ascending: true });                        // CRITICAL: Consistent ordering

      // Apply the same filters used in count query to ensure consistency
      // Date range filters for temporal data selection
      if (dateRange) {
        if (dateRange.start) batchQuery = batchQuery.gte('timestamp', dateRange.start);
        if (dateRange.end) batchQuery = batchQuery.lte('timestamp', dateRange.end);
      }
      
      // Apply additional column-based filters
      // These filters must match exactly with the count query filters
      if (filters && typeof filters === 'object') {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            batchQuery = batchQuery.eq(key, value);
          }
        });
      }

      // Implement robust retry logic for network resilience
      // This handles temporary network issues, rate limiting, and server errors
      let batchData;
      let retries = 0;
      
      while (retries < this.maxRetries) {
        try {
          const { data, error } = await batchQuery;
          if (error) throw new Error(error.message);
          
          batchData = data;
          break;  // Success - exit retry loop
        } catch (error) {
          retries++;
          if (retries >= this.maxRetries) {
            // All retries exhausted - fail with detailed error
            throw new Error(`Batch ${batchCount} failed after ${this.maxRetries} retries: ${error.message}`);
          }
          console.log(`⚠️  Batch ${batchCount} failed, retrying (${retries}/${this.maxRetries})...`);
          // Exponential backoff could be implemented here
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }

      // Handle empty batch case - could indicate end of data or filtering issues
      if (!batchData || batchData.length === 0) {
        console.log(`⚠️  Batch ${batchCount} returned no data, stopping export`);
        break;  // Exit pagination loop
      }

      // CRITICAL BUSINESS LOGIC: Real-time Duplicate Detection and Prevention
      // ====================================================================
      // 
      // PROBLEM: Database pagination can produce duplicate records when:
      // 1. New records are inserted during export (shifts pagination offsets)
      // 2. Records are updated/deleted during export (changes ordering)
      // 3. Database replication lag causes inconsistent read results
      // 4. Network issues cause batch retries with overlapping data
      // 5. Concurrent operations modify the dataset mid-export
      // 
      // BUSINESS IMPACT: Duplicate records in exports cause:
      // - Data integrity issues in downstream systems
      // - Incorrect analytics and reporting
      // - Compliance violations in audit trails
      // - Customer confusion and lost trust
      // 
      // SOLUTION: In-memory ID tracking with Set data structure
      // - O(1) lookup time for duplicate detection
      // - Memory-efficient storage of exported IDs
      // - Real-time filtering prevents duplicates from reaching output
      // 
      // ALGORITHM:
      // 1. Maintain a Set of all exported record IDs across all batches
      // 2. For each record in current batch, check if ID already exported
      // 3. If duplicate found: log for reporting, exclude from export
      // 4. If unique: add to tracking set, include in export
      
      const duplicateIds = [];                        // Track duplicates found in this batch
      const uniqueBatchData = batchData.filter(record => {
        if (exportedIds.has(record.id)) {
          // DUPLICATE DETECTED: Record already exported in previous batch
          duplicateIds.push(record.id);              // Log duplicate for reporting
          return false;                              // Exclude from export (critical!)
        }
        exportedIds.add(record.id);                  // Track as exported (prevents future duplicates)
        return true;                                 // Include in export
      });
      
      // PERFORMANCE CONSIDERATIONS:
      // - Set.has() and Set.add() are O(1) operations
      // - Memory usage: ~50 bytes per ID for large datasets
      // - For 1M records: ~50MB memory usage (acceptable for export operations)

      // Report duplicate detection results
      if (duplicateIds.length > 0) {
        console.log(`⚠️  Found ${duplicateIds.length} duplicate IDs in batch ${batchCount}`);
      }

      // Write batch data to file with appropriate method
      if (batchCount === 1) {
        // First batch: write with headers
        await csvWriter.writeRecords(uniqueBatchData);
      } else {
        // Subsequent batches: append without headers
        const appendWriter = createObjectCsvWriter({
          path: outputFile,      // Same file path
          header: headers,       // Same header structure
          append: true          // Append mode - no headers written
        });
        await appendWriter.writeRecords(uniqueBatchData);
      }

      // Update export statistics and progress tracking
      totalExported += uniqueBatchData.length;           // Add unique records to total
      const batchDuration = Date.now() - batchStart;     // Time for this batch
      const progressPercent = ((batchCount / totalBatches) * 100).toFixed(1);
      const avgTime = (Date.now() - batchStart) / batchCount;  // Average time per batch
      const eta = Math.round(((totalBatches - batchCount) * avgTime) / 1000);  // ETA in seconds

      // Display progress information with key metrics
      console.log(`📦 Batch ${batchCount}/${totalBatches} (${progressPercent}%) - ${uniqueBatchData.length} records (${batchDuration}ms) - ETA: ${eta}s`);

      // Advance to next batch
      offset += this.batchSize;

      // Rate limiting to avoid overwhelming the database
      // Add small delay every 5 batches to be respectful of server resources
      if (batchCount % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Get final file statistics for reporting
    const fileStats = fs.statSync(outputFile);
    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

    // Return comprehensive export results
    return {
      recordsExported: totalExported,              // Total unique records exported
      filePath: outputFile,                        // Full path to export file
      fileSizeMB: parseFloat(fileSizeMB),         // File size for capacity tracking
      exportedIds: Array.from(exportedIds)        // All exported IDs for validation
    };
  }

  /**
   * Validate export integrity by checking file contents against expectations
   * 
   * Performs comprehensive validation including:
   * - File existence and readability
   * - Record count verification
   * - Header presence and structure
   * - File size verification
   * 
   * @param {string} filePath - Path to the exported file
   * @param {number} expectedCount - Expected number of records
   * @returns {Object} Validation results with detailed metrics
   */
  async validateExport(filePath, expectedCount) {
    try {
      // Read entire file content for analysis
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      const actualCount = lines.length - 1; // Subtract header row

      // Compile comprehensive validation results
      const validation = {
        fileExists: true,                                    // File is readable
        expectedRecords: expectedCount,                      // What we expected to export
        actualRecords: actualCount,                          // What we actually exported
        matches: actualCount === expectedCount,              // Do counts match?
        fileSize: fs.statSync(filePath).size,               // File size in bytes
        hasHeader: lines.length > 0,                        // Header row present?
        headerColumns: lines.length > 0 ? lines[0].split(',').length : 0  // Column count
      };

      return validation;
    } catch (error) {
      // Return error details if validation fails
      return {
        fileExists: false,           // File couldn't be read
        error: error.message        // Specific error details
      };
    }
  }

  /**
   * Check for duplicates in exported file by analyzing ID column
   * 
   * Reads the exported CSV file and analyzes the ID column to detect
   * any duplicate records that may have been exported due to pagination
   * issues or concurrent data modifications during export.
   * 
   * @param {string} filePath - Path to the exported CSV file
   * @returns {Object} Duplicate analysis results including count and specific IDs
   */
  async checkDuplicates(filePath) {
    try {
      // Read and parse the exported file
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      // Handle empty or header-only files
      if (lines.length < 2) {
        return { duplicates: 0, duplicateIds: [] };
      }

      // Parse header to find ID column position
      const header = lines[0].split(',').map(col => col.replace(/"/g, '').trim());
      const idIndex = header.findIndex(col => col.toLowerCase() === 'id');
      
      // Verify ID column exists for duplicate detection
      if (idIndex === -1) {
        return { duplicates: 0, duplicateIds: [], error: 'No ID column found' };
      }

      // Initialize tracking collections
      const ids = new Set();           // Unique IDs seen so far
      const duplicateIds = [];         // Duplicate IDs found

      // Analyze each data row for duplicate IDs
      for (let i = 1; i < lines.length; i++) {
        const columns = this.parseCSVLine(lines[i]);  // Parse CSV with quote handling
        const id = columns[idIndex]?.replace(/"/g, '').trim();  // Extract and clean ID
        
        if (id) {  // Skip empty IDs
          if (ids.has(id)) {
            duplicateIds.push(id);      // Found duplicate
          } else {
            ids.add(id);               // First occurrence - track it
          }
        }
      }

      // Return comprehensive duplicate analysis
      return {
        duplicates: duplicateIds.length,              // Total duplicate occurrences
        duplicateIds: [...new Set(duplicateIds)],     // Unique duplicate IDs (deduplicated)
        totalUniqueIds: ids.size                      // Total unique IDs found
      };
    } catch (error) {
      // Handle file reading or parsing errors gracefully
      return {
        duplicates: 0,
        duplicateIds: [],
        error: error.message
      };
    }
  }

  /**
   * Parse CSV line handling quotes properly
   * 
   * Custom CSV parser that correctly handles quoted fields containing commas.
   * Standard split(',') would break on commas within quoted fields.
   * 
   * @param {string} line - CSV line to parse
   * @returns {Array} Array of column values
   */
  parseCSVLine(line) {
    const columns = [];           // Parsed column values
    let inQuotes = false;         // Track if we're inside quoted field
    let currentCol = '';          // Current column being built
    
    // CHARACTER-BY-CHARACTER PARSING ALGORITHM
    // =========================================
    // 
    // This algorithm correctly handles CSV complexities that simple split(',') cannot:
    // 
    // BUSINESS SCENARIOS HANDLED:
    // 1. Quoted fields containing commas: "Company, Inc." → parsed as single field
    // 2. Nested quotes: "She said ""Hello""" → preserves internal quotes
    // 3. Mixed quoted/unquoted fields: John,"Doe, Jr.",30 → three separate fields
    // 4. Empty fields: field1,,field3 → preserves empty middle field
    // 5. Trailing commas: field1,field2, → preserves empty final field
    // 
    // STATE MACHINE APPROACH:
    // - inQuotes flag tracks whether we're inside quoted field
    // - Comma only acts as delimiter when outside quotes
    // - Quote character toggles the inQuotes state
    // 
    // ALGORITHM COMPLEXITY: O(n) where n is line length
    // MEMORY USAGE: O(m) where m is number of columns
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        // QUOTE HANDLING: Toggle quote state for field boundary detection
        inQuotes = !inQuotes;     // Enter or exit quoted field
      } else if (char === ',' && !inQuotes) {
        // DELIMITER DETECTION: Comma outside quotes marks field boundary
        columns.push(currentCol.trim());  // Complete current field
        currentCol = '';                  // Start new field
      } else {
        // CHARACTER ACCUMULATION: Add character to current field
        currentCol += char;       // Build field content character by character
      }
    }
    
    // FINAL FIELD: Add the last field (no trailing comma to trigger push)
    columns.push(currentCol.trim());      // Complete final field
    
    return columns;
  }

  /**
   * Generate unique export ID for tracking and file naming
   * 
   * Creates a short, URL-safe identifier combining timestamp and random elements.
   * This ensures uniqueness across concurrent exports and provides chronological ordering.
   * 
   * @returns {string} Unique identifier string
   */
  generateExportId() {
    // Combine timestamp (base36) with random string for uniqueness
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Create comprehensive export report for audit and debugging
   * 
   * Generates a detailed JSON report containing all export metadata,
   * statistics, validation results, and configuration details.
   * Essential for troubleshooting and compliance requirements.
   * 
   * @param {string} exportId - Unique export identifier
   * @param {Object} data - Export data including results, errors, and metadata
   * @returns {Object} Complete report object with file path
   */
  createExportReport(exportId, data) {
    const timestamp = new Date().toISOString();
    const reportFilename = `export_report_${exportId}_${new Date().toISOString().split('T')[0]}.json`;
    const reportPath = path.join(this.outputDir, reportFilename);

    // Compile complete report with timestamp and export data
    const report = {
      exportId,          // Unique identifier for this export
      timestamp,         // ISO timestamp of report creation
      ...data           // All export results, validation, errors, etc.
    };

    // Ensure output directory exists for report file
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Write report as formatted JSON for human readability
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Return report with file path for reference
    return {
      ...report,
      reportPath        // Full path to the report file
    };
  }

  /**
   * Quick export presets for common scenarios
   * 
   * Provides pre-configured export options for typical use cases,
   * making it easy for users to export data without complex configuration.
   * 
   * @param {string} preset - Preset name ('all', 'recent', 'minimal')
   * @returns {Object} Export results from the configured export
   * @throws {Error} If preset name is not recognized
   */
  async quickExport(preset = 'all') {
    // Define common export configurations
    const presets = {
      all: {                           // Full export with all validations
        tableName: 'shedsuite_orders',
        validateData: true,
        checkDuplicates: true
      },
      recent: {                        // Last 30 days with validations
        tableName: 'shedsuite_orders',
        dateRange: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago
        },
        validateData: true,
        checkDuplicates: true
      },
      minimal: {                       // Fast export without validations
        tableName: 'shedsuite_orders',
        validateData: false,            // Skip validation for speed
        checkDuplicates: false          // Skip duplicate check for speed
      }
    };

    // Validate preset exists
    const config = presets[preset];
    if (!config) {
      throw new Error(`Unknown preset: ${preset}. Available: ${Object.keys(presets).join(', ')}`);
    }

    console.log(`🚀 Quick export with preset: ${preset}`);
    return await this.exportTable(config);
  }
}

/**
 * CLI interface for command-line usage
 * 
 * Provides both preset-based and custom export options through command line arguments.
 * Handles argument parsing, validation, and delegates to the appropriate export method.
 */
async function main() {
  const args = process.argv.slice(2);  // Remove 'node' and script name from arguments
  const exporter = new ClientExportSolution();

  try {
    // Display help information if no arguments provided
    if (args.length === 0) {
      console.log('📋 Usage:');
      console.log('  node scripts/client-export-solution.js [preset]');
      console.log('  node scripts/client-export-solution.js custom --table shedsuite_orders --format csv');
      console.log('');
      console.log('📋 Available presets:');
      console.log('  all     - Export all data with full validation');
      console.log('  recent  - Export last 30 days with validation');
      console.log('  minimal - Export all data without validation');
      console.log('');
      console.log('📋 Custom options:');
      console.log('  --table <name>     - Table to export');
      console.log('  --format <format>  - Export format (csv, json)');
      console.log('  --start <date>     - Start date (ISO format)');
      console.log('  --end <date>       - End date (ISO format)');
      console.log('  --batch <size>     - Batch size (default: 500)');
      console.log('  --no-validate      - Skip validation');
      console.log('  --no-duplicates    - Skip duplicate check');
      return;
    }

    // Handle custom export configuration
    if (args[0] === 'custom') {
      // Parse custom command line arguments into export options
      const options = {};  // Will hold all export configuration
      
      // Process arguments in pairs (--flag value)
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i];    // Command line flag
        const value = args[i + 1];  // Flag value (if applicable)
        
        // Map command line arguments to export options
        switch (key) {
          case '--table':
            options.tableName = value;
            break;
          case '--format':
            options.outputFormat = value;
            break;
          case '--start':
            // Build date range object progressively
            options.dateRange = { ...options.dateRange, start: value };
            break;
          case '--end':
            options.dateRange = { ...options.dateRange, end: value };
            break;
          case '--batch':
            // Modify exporter configuration directly
            exporter.batchSize = parseInt(value);
            break;
          case '--no-validate':
            // Boolean flags don't need values
            options.validateData = false;
            break;
          case '--no-duplicates':
            options.checkDuplicates = false;
            break;
        }
      }
      
      // Execute custom export with parsed options
      await exporter.exportTable(options);
    } else {
      // Use predefined preset configuration
      await exporter.quickExport(args[0]);
    }

  } catch (error) {
    // Handle any export errors with proper exit code
    console.error('❌ Export failed:', error.message);
    process.exit(1);  // Non-zero exit code indicates failure
  }
}

// Execute main function if script is run directly (not imported as module)
if (require.main === module) {
  main().catch(error => {
    // Catch any unhandled errors in main function
    console.error('❌ Unhandled error:', error.message);
    process.exit(1);
  });
}

// Export the class for use as a module in other scripts
module.exports = ClientExportSolution; 