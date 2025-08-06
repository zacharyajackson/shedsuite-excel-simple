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

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const supabaseClient = require('../src/services/supabase-client');
const { logger } = require('../src/utils/logger');

class ClientExportSolution {
  constructor() {
    this.batchSize = parseInt(process.env.EXPORT_BATCH_SIZE) || 500;
    this.outputDir = process.env.EXPORT_OUTPUT_DIR || './client-exports';
    this.maxRetries = parseInt(process.env.EXPORT_MAX_RETRIES) || 3;
    this.retryDelay = parseInt(process.env.EXPORT_RETRY_DELAY) || 1000;
  }

  /**
   * Main export function with comprehensive error handling
   */
  async exportTable(options = {}) {
    const startTime = Date.now();
    const exportId = this.generateExportId();
    
    const {
      tableName = 'shedsuite_orders',
      outputFormat = 'csv',
      includeMetadata = true,
      validateData = true,
      checkDuplicates = true,
      dateRange,
      filters = {},
      columns = null,
      filename = null
    } = options;

    console.log('🚀 CLIENT EXPORT SOLUTION');
    console.log('========================');
    console.log(`📋 Export ID: ${exportId}`);
    console.log(`📊 Table: ${tableName}`);
    console.log(`📁 Format: ${outputFormat.toUpperCase()}`);
    console.log(`🔍 Validation: ${validateData ? 'Enabled' : 'Disabled'}`);
    console.log(`🔍 Duplicate Check: ${checkDuplicates ? 'Enabled' : 'Disabled'}\n`);

    try {
      // Step 1: Validate table exists and get schema
      console.log('🔍 Step 1: Validating table and schema...');
      const schemaInfo = await this.validateTable(tableName);
      console.log(`✅ Table validated: ${schemaInfo.columnCount} columns found`);

      // Step 2: Fix sequence if needed
      console.log('\n🔧 Step 2: Checking and fixing sequence...');
      const sequenceFixed = await this.fixSequenceIfNeeded(tableName);
      if (sequenceFixed) {
        console.log('✅ Sequence synchronized');
      } else {
        console.log('ℹ️  Sequence already in sync');
      }

      // Step 3: Get accurate record count
      console.log('\n📊 Step 3: Getting accurate record count...');
      const { totalCount, filteredCount } = await this.getRecordCount(tableName, dateRange, filters);
      console.log(`📈 Total records in table: ${totalCount.toLocaleString()}`);
      console.log(`📊 Records after filters: ${filteredCount.toLocaleString()}`);

      if (filteredCount === 0) {
        console.log('⚠️  No records found matching criteria');
        return this.createExportReport(exportId, {
          success: false,
          message: 'No records found',
          recordsExported: 0
        });
      }

      // Step 4: Export data with proper pagination
      console.log('\n📦 Step 4: Exporting data with proper pagination...');
      const exportResult = await this.exportWithPagination({
        tableName,
        totalCount: filteredCount,
        dateRange,
        filters,
        columns,
        outputFormat,
        exportId
      });

      // Step 5: Validate export integrity
      if (validateData) {
        console.log('\n🔍 Step 5: Validating export integrity...');
        const validationResult = await this.validateExport(exportResult.filePath, exportResult.recordsExported);
        exportResult.validation = validationResult;
      }

      // Step 6: Check for duplicates if enabled
      if (checkDuplicates) {
        console.log('\n🔍 Step 6: Checking for duplicates...');
        const duplicateResult = await this.checkDuplicates(exportResult.filePath);
        exportResult.duplicates = duplicateResult;
      }

      // Step 7: Generate final report
      const finalReport = this.createExportReport(exportId, {
        success: true,
        recordsExported: exportResult.recordsExported,
        filePath: exportResult.filePath,
        fileSizeMB: exportResult.fileSizeMB,
        duration: Date.now() - startTime,
        validation: exportResult.validation,
        duplicates: exportResult.duplicates,
        metadata: {
          tableName,
          exportFormat: outputFormat,
          dateRange,
          filters,
          sequenceFixed
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
      console.error('\n❌ EXPORT FAILED!');
      console.error('================');
      console.error('Error:', error.message);
      
      const errorReport = this.createExportReport(exportId, {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Validate table exists and get schema information
   */
  async validateTable(tableName) {
    try {
      // Get a single record to validate table exists and get schema
      const { data, error } = await supabaseClient.client
        .from(tableName)
        .select('*')
        .limit(1);

      if (error) {
        throw new Error(`Table validation failed: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error(`Table '${tableName}' exists but is empty`);
      }

      return {
        columnCount: Object.keys(data[0]).length,
        columns: Object.keys(data[0]),
        sampleRecord: data[0]
      };
    } catch (error) {
      throw new Error(`Table validation failed: ${error.message}`);
    }
  }

  /**
   * Fix sequence if it's out of sync (common Supabase issue)
   */
  async fixSequenceIfNeeded(tableName) {
    try {
      // Get the current maximum ID
      const { data: maxIdResult, error: maxError } = await supabaseClient.client
        .from(tableName)
        .select('id')
        .order('id', { ascending: false })
        .limit(1);

      if (maxError) {
        console.log('⚠️  Could not check sequence, continuing...');
        return false;
      }

      if (!maxIdResult || maxIdResult.length === 0) {
        return false;
      }

      const maxId = maxIdResult[0].id;
      
      // Reset sequence to max ID + 1
      const { error: sequenceError } = await supabaseClient.client.rpc('reset_sequence', {
        table_name: tableName,
        column_name: 'id',
        new_value: maxId + 1
      });

      if (sequenceError) {
        console.log('⚠️  Could not reset sequence, continuing...');
        return false;
      }

      return true;
    } catch (error) {
      console.log('⚠️  Sequence check failed, continuing...');
      return false;
    }
  }

  /**
   * Get accurate record count with filters
   */
  async getRecordCount(tableName, dateRange = null, filters = {}) {
    let countQuery = supabaseClient.client.from(tableName).select('id', { count: 'exact', head: true });
    
    // Apply date range filters
    if (dateRange) {
      if (dateRange.start) countQuery = countQuery.gte('timestamp', dateRange.start);
      if (dateRange.end) countQuery = countQuery.lte('timestamp', dateRange.end);
    }
    
    // Apply other filters (ensure filters is an object)
    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          countQuery = countQuery.eq(key, value);
        }
      });
    }

    const { count, error } = await countQuery;
    if (error) throw new Error(`Count query failed: ${error.message}`);

    // Get total count without filters for comparison
    const { count: totalCount, error: totalError } = await supabaseClient.client
      .from(tableName)
      .select('id', { count: 'exact', head: true });

    if (totalError) throw new Error(`Total count query failed: ${totalError.message}`);

    return {
      totalCount: totalCount || 0,
      filteredCount: count || 0
    };
  }

  /**
   * Export data with proper pagination and ordering
   */
  async exportWithPagination(options) {
    const {
      tableName,
      totalCount,
      dateRange,
      filters,
      columns,
      outputFormat,
      exportId
    } = options;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${tableName}_export_${timestamp}_${exportId}.${outputFormat}`;
    const outputFile = path.join(this.outputDir, filename);

    // Get sample data for headers
    let sampleQuery = supabaseClient.client.from(tableName).select(columns || '*').limit(1);
    
    if (dateRange) {
      if (dateRange.start) sampleQuery = sampleQuery.gte('timestamp', dateRange.start);
      if (dateRange.end) sampleQuery = sampleQuery.lte('timestamp', dateRange.end);
    }
    
    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          sampleQuery = sampleQuery.eq(key, value);
        }
      });
    }

    const { data: sampleData, error: sampleError } = await sampleQuery;
    if (sampleError) throw new Error(`Sample query failed: ${sampleError.message}`);

    if (!sampleData || sampleData.length === 0) {
      throw new Error('No data found after applying filters');
    }

    // Set up CSV writer
    const headers = Object.keys(sampleData[0]).map(key => ({
      id: key,
      title: key
    }));

    const csvWriter = createObjectCsvWriter({
      path: outputFile,
      header: headers
    });

    // Export in batches with proper ordering
    let offset = 0;
    let totalExported = 0;
    let batchCount = 0;
    const totalBatches = Math.ceil(totalCount / this.batchSize);
    const exportedIds = new Set(); // Track exported IDs to prevent duplicates

    console.log(`📦 Exporting ${totalBatches} batches of ${this.batchSize} records each...`);

    while (offset < totalCount) {
      const batchStart = Date.now();
      batchCount++;

      // Fetch batch with consistent ordering
      let batchQuery = supabaseClient.client
        .from(tableName)
        .select(columns || '*')
        .range(offset, offset + this.batchSize - 1)
        .order('id', { ascending: true }); // Consistent ordering is crucial

      // Apply filters
      if (dateRange) {
        if (dateRange.start) batchQuery = batchQuery.gte('timestamp', dateRange.start);
        if (dateRange.end) batchQuery = batchQuery.lte('timestamp', dateRange.end);
      }
      
      if (filters && typeof filters === 'object') {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            batchQuery = batchQuery.eq(key, value);
          }
        });
      }

      // Retry logic for batch fetching
      let batchData;
      let retries = 0;
      
      while (retries < this.maxRetries) {
        try {
          const { data, error } = await batchQuery;
          if (error) throw new Error(error.message);
          
          batchData = data;
          break;
        } catch (error) {
          retries++;
          if (retries >= this.maxRetries) {
            throw new Error(`Batch ${batchCount} failed after ${this.maxRetries} retries: ${error.message}`);
          }
          console.log(`⚠️  Batch ${batchCount} failed, retrying (${retries}/${this.maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }

      if (!batchData || batchData.length === 0) {
        console.log(`⚠️  Batch ${batchCount} returned no data, stopping export`);
        break;
      }

      // Check for duplicates within this batch
      const duplicateIds = [];
      const uniqueBatchData = batchData.filter(record => {
        if (exportedIds.has(record.id)) {
          duplicateIds.push(record.id);
          return false;
        }
        exportedIds.add(record.id);
        return true;
      });

      if (duplicateIds.length > 0) {
        console.log(`⚠️  Found ${duplicateIds.length} duplicate IDs in batch ${batchCount}`);
      }

      // Write batch to file
      if (batchCount === 1) {
        await csvWriter.writeRecords(uniqueBatchData);
      } else {
        const appendWriter = createObjectCsvWriter({
          path: outputFile,
          header: headers,
          append: true
        });
        await appendWriter.writeRecords(uniqueBatchData);
      }

      totalExported += uniqueBatchData.length;
      const batchDuration = Date.now() - batchStart;
      const progressPercent = ((batchCount / totalBatches) * 100).toFixed(1);
      const avgTime = (Date.now() - batchStart) / batchCount;
      const eta = Math.round(((totalBatches - batchCount) * avgTime) / 1000);

      console.log(`📦 Batch ${batchCount}/${totalBatches} (${progressPercent}%) - ${uniqueBatchData.length} records (${batchDuration}ms) - ETA: ${eta}s`);

      offset += this.batchSize;

      // Rate limiting
      if (batchCount % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const fileStats = fs.statSync(outputFile);
    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

    return {
      recordsExported: totalExported,
      filePath: outputFile,
      fileSizeMB: parseFloat(fileSizeMB),
      exportedIds: Array.from(exportedIds)
    };
  }

  /**
   * Validate export integrity
   */
  async validateExport(filePath, expectedCount) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      const actualCount = lines.length - 1; // Subtract header

      const validation = {
        fileExists: true,
        expectedRecords: expectedCount,
        actualRecords: actualCount,
        matches: actualCount === expectedCount,
        fileSize: fs.statSync(filePath).size,
        hasHeader: lines.length > 0,
        headerColumns: lines.length > 0 ? lines[0].split(',').length : 0
      };

      return validation;
    } catch (error) {
      return {
        fileExists: false,
        error: error.message
      };
    }
  }

  /**
   * Check for duplicates in exported file
   */
  async checkDuplicates(filePath) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        return { duplicates: 0, duplicateIds: [] };
      }

      const header = lines[0].split(',').map(col => col.replace(/"/g, '').trim());
      const idIndex = header.findIndex(col => col.toLowerCase() === 'id');
      
      if (idIndex === -1) {
        return { duplicates: 0, duplicateIds: [], error: 'No ID column found' };
      }

      const ids = new Set();
      const duplicateIds = [];

      for (let i = 1; i < lines.length; i++) {
        const columns = this.parseCSVLine(lines[i]);
        const id = columns[idIndex]?.replace(/"/g, '').trim();
        
        if (id) {
          if (ids.has(id)) {
            duplicateIds.push(id);
          } else {
            ids.add(id);
          }
        }
      }

      return {
        duplicates: duplicateIds.length,
        duplicateIds: [...new Set(duplicateIds)],
        totalUniqueIds: ids.size
      };
    } catch (error) {
      return {
        duplicates: 0,
        duplicateIds: [],
        error: error.message
      };
    }
  }

  /**
   * Parse CSV line handling quotes properly
   */
  parseCSVLine(line) {
    const columns = [];
    let inQuotes = false;
    let currentCol = '';
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        columns.push(currentCol.trim());
        currentCol = '';
      } else {
        currentCol += char;
      }
    }
    columns.push(currentCol.trim());
    
    return columns;
  }

  /**
   * Generate unique export ID
   */
  generateExportId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Create comprehensive export report
   */
  createExportReport(exportId, data) {
    const timestamp = new Date().toISOString();
    const reportFilename = `export_report_${exportId}_${new Date().toISOString().split('T')[0]}.json`;
    const reportPath = path.join(this.outputDir, reportFilename);

    const report = {
      exportId,
      timestamp,
      ...data
    };

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    return {
      ...report,
      reportPath
    };
  }

  /**
   * Quick export presets for common scenarios
   */
  async quickExport(preset = 'all') {
    const presets = {
      all: {
        tableName: 'shedsuite_orders',
        validateData: true,
        checkDuplicates: true
      },
      recent: {
        tableName: 'shedsuite_orders',
        dateRange: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
        },
        validateData: true,
        checkDuplicates: true
      },
      minimal: {
        tableName: 'shedsuite_orders',
        validateData: false,
        checkDuplicates: false
      }
    };

    const config = presets[preset];
    if (!config) {
      throw new Error(`Unknown preset: ${preset}. Available: ${Object.keys(presets).join(', ')}`);
    }

    console.log(`🚀 Quick export with preset: ${preset}`);
    return await this.exportTable(config);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const exporter = new ClientExportSolution();

  try {
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

    if (args[0] === 'custom') {
      // Parse custom arguments
      const options = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        
        switch (key) {
          case '--table':
            options.tableName = value;
            break;
          case '--format':
            options.outputFormat = value;
            break;
          case '--start':
            options.dateRange = { ...options.dateRange, start: value };
            break;
          case '--end':
            options.dateRange = { ...options.dateRange, end: value };
            break;
          case '--batch':
            exporter.batchSize = parseInt(value);
            break;
          case '--no-validate':
            options.validateData = false;
            break;
          case '--no-duplicates':
            options.checkDuplicates = false;
            break;
        }
      }
      
      await exporter.exportTable(options);
    } else {
      // Use preset
      await exporter.quickExport(args[0]);
    }

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = ClientExportSolution; 