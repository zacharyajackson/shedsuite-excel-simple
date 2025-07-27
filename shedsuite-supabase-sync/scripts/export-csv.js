#!/usr/bin/env node
// Fast CSV export utility for Supabase database
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const supabaseClient = require('../src/services/supabase-client');
const { logger } = require('../src/utils/logger');

class FastCSVExporter {
  constructor() {
    this.batchSize = parseInt(process.env.CSV_BATCH_SIZE) || 1000;
    this.outputDir = process.env.CSV_OUTPUT_DIR || './exports';
    this.tableName = process.env.CSV_TABLE_NAME || 'shedsuite_orders';
  }

  async exportToCSV(options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        tableName = this.tableName,
        batchSize = this.batchSize,
        outputDir = this.outputDir,
        filename,
        dateRange,
        filters = {},
        columns = null
      } = options;

      console.log('🚀 Starting fast CSV export...');
      console.log(`📋 Configuration:`);
      console.log(`   - Table: ${tableName}`);
      console.log(`   - Batch size: ${batchSize}`);
      console.log(`   - Output directory: ${outputDir}`);
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${outputDir}`);
      }

      // Get total count first
      console.log('🔢 Getting total record count...');
      const countStart = Date.now();
      let countQuery = supabaseClient.client.from(tableName).select('id', { count: 'exact', head: true });
      
      // Apply filters to count query
      if (dateRange) {
        if (dateRange.start) countQuery = countQuery.gte('timestamp', dateRange.start);
        if (dateRange.end) countQuery = countQuery.lte('timestamp', dateRange.end);
      }
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          countQuery = countQuery.eq(key, value);
        }
      });

      const { count, error: countError } = await countQuery;
      if (countError) throw new Error(`Count query failed: ${countError.message}`);
      
      const countDuration = Date.now() - countStart;
      console.log(`✅ Total records: ${count?.toLocaleString()} (${countDuration}ms)`);

      if (count === 0) {
        console.log('⚠️  No records found to export');
        return { success: false, message: 'No records found' };
      }

      // Generate filename if not provided
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const defaultFilename = `${tableName}_export_${timestamp}_${count}records.csv`;
      const outputFile = path.join(outputDir, filename || defaultFilename);
      
      console.log(`📝 Exporting to: ${outputFile}`);

      // Get first batch to determine columns
      console.log('🔍 Analyzing data structure...');
      let query = supabaseClient.client.from(tableName).select(columns || '*').limit(1);
      
      // Apply same filters to data query
      if (dateRange) {
        if (dateRange.start) query = query.gte('timestamp', dateRange.start);
        if (dateRange.end) query = query.lte('timestamp', dateRange.end);
      }
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });

      const { data: sampleData, error: sampleError } = await query;
      if (sampleError) throw new Error(`Sample query failed: ${sampleError.message}`);
      
      if (!sampleData || sampleData.length === 0) {
        throw new Error('No data found after applying filters');
      }

      // Set up CSV writer
      const headers = Object.keys(sampleData[0]).map(key => ({
        id: key,
        title: key
      }));
      
      console.log(`📊 Columns to export: ${headers.length}`);
      console.log(`   - ${headers.slice(0, 10).map(h => h.id).join(', ')}${headers.length > 10 ? '...' : ''}`);

      const csvWriter = createObjectCsvWriter({
        path: outputFile,
        header: headers
      });

      // Export in batches
      console.log('\n🔄 Starting batch export...');
      let offset = 0;
      let totalExported = 0;
      let batchCount = 0;
      const totalBatches = Math.ceil(count / batchSize);

      while (offset < count) {
        const batchStart = Date.now();
        batchCount++;
        
        // Fetch batch
        let batchQuery = supabaseClient.client
          .from(tableName)
          .select(columns || '*')
          .range(offset, offset + batchSize - 1)
          .order('id', { ascending: true });

        // Apply filters
        if (dateRange) {
          if (dateRange.start) batchQuery = batchQuery.gte('timestamp', dateRange.start);
          if (dateRange.end) batchQuery = batchQuery.lte('timestamp', dateRange.end);
        }
        
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            batchQuery = batchQuery.eq(key, value);
          }
        });

        const { data: batchData, error: batchError } = await batchQuery;
        if (batchError) throw new Error(`Batch ${batchCount} failed: ${batchError.message}`);

        if (!batchData || batchData.length === 0) {
          console.log(`⚠️  Batch ${batchCount} returned no data, stopping export`);
          break;
        }

        // Write batch to CSV
        if (offset === 0) {
          // Write header and first batch
          await csvWriter.writeRecords(batchData);
        } else {
          // Append subsequent batches (without header)
          const appendWriter = createObjectCsvWriter({
            path: outputFile,
            header: headers,
            append: true
          });
          await appendWriter.writeRecords(batchData);
        }

        totalExported += batchData.length;
        const batchDuration = Date.now() - batchStart;
        const progressPercent = ((batchCount / totalBatches) * 100).toFixed(1);
        const avgTime = (Date.now() - startTime) / batchCount;
        const eta = Math.round(((totalBatches - batchCount) * avgTime) / 1000);

        console.log(`📦 Batch ${batchCount}/${totalBatches} (${progressPercent}%) - ${batchData.length} records (${batchDuration}ms) - ETA: ${eta}s`);

        offset += batchSize;

        // Add small delay to avoid overwhelming the database
        if (batchCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const totalDuration = Date.now() - startTime;
      const fileStats = fs.statSync(outputFile);
      const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

      console.log('\n✅ Export completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   - Records exported: ${totalExported.toLocaleString()}`);
      console.log(`   - File size: ${fileSizeMB}MB`);
      console.log(`   - Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
      console.log(`   - Export rate: ${Math.round(totalExported / (totalDuration / 1000))} records/sec`);
      console.log(`   - Output file: ${outputFile}`);

      return {
        success: true,
        recordsExported: totalExported,
        filePath: outputFile,
        fileSizeMB: parseFloat(fileSizeMB),
        durationSeconds: Math.round(totalDuration / 1000),
        exportRate: Math.round(totalExported / (totalDuration / 1000))
      };

    } catch (error) {
      console.error('❌ Export failed:', error.message);
      logger.error('CSV export failed', {
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Quick export with common presets
  async quickExport(preset = 'all') {
    const presets = {
      all: {
        tableName: 'shedsuite_orders',
        filename: `shedsuite_all_${new Date().toISOString().split('T')[0]}.csv`
      },
      today: {
        tableName: 'shedsuite_orders',
        dateRange: {
          start: new Date().toISOString().split('T')[0] + 'T00:00:00Z'
        },
        filename: `shedsuite_today_${new Date().toISOString().split('T')[0]}.csv`
      },
      thisWeek: {
        tableName: 'shedsuite_orders',
        dateRange: {
          start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        filename: `shedsuite_week_${new Date().toISOString().split('T')[0]}.csv`
      },
      thisMonth: {
        tableName: 'shedsuite_orders',
        dateRange: {
          start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
        },
        filename: `shedsuite_month_${new Date().toISOString().substring(0, 7)}.csv`
      },
      summary: {
        tableName: 'shedsuite_orders',
        columns: 'id,customer_name,order_number,total_amount_dollar_amount,status,date_ordered,timestamp',
        filename: `shedsuite_summary_${new Date().toISOString().split('T')[0]}.csv`
      }
    };

    const config = presets[preset];
    if (!config) {
      console.error(`❌ Unknown preset: ${preset}`);
      console.log(`Available presets: ${Object.keys(presets).join(', ')}`);
      return { success: false, error: 'Unknown preset' };
    }

    console.log(`🎯 Using preset: ${preset}`);
    return await this.exportToCSV(config);
  }
}

// CLI interface
async function main() {
  const exporter = new FastCSVExporter();
  
  const args = process.argv.slice(2);
  const command = args[0] || 'all';
  
  if (command === '--help' || command === '-h') {
    console.log(`
🚀 Fast CSV Exporter for Supabase

Usage:
  node scripts/export-csv.js [preset]
  node scripts/export-csv.js [options]

Presets:
  all         - Export all records (default)
  today       - Export today's records
  thisWeek    - Export this week's records  
  thisMonth   - Export this month's records
  summary     - Export summary columns only

Options:
  --table <name>        - Table name (default: shedsuite_orders)
  --batch <size>        - Batch size (default: 1000)
  --output <dir>        - Output directory (default: ./exports)
  --filename <name>     - Custom filename
  --columns <list>      - Comma-separated column list
  --date-start <date>   - Start date (ISO format)
  --date-end <date>     - End date (ISO format)

Examples:
  npm run export:csv
  npm run export:csv today
  npm run export:csv -- --table shedsuite_orders --batch 2000
  npm run export:csv -- --date-start 2025-01-01 --date-end 2025-01-31
`);
    return;
  }

  // Parse command line arguments
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--table':
        options.tableName = nextArg;
        i++;
        break;
      case '--batch':
        options.batchSize = parseInt(nextArg);
        i++;
        break;
      case '--output':
        options.outputDir = nextArg;
        i++;
        break;
      case '--filename':
        options.filename = nextArg;
        i++;
        break;
      case '--columns':
        options.columns = nextArg;
        i++;
        break;
      case '--date-start':
        options.dateRange = options.dateRange || {};
        options.dateRange.start = nextArg;
        i++;
        break;
      case '--date-end':
        options.dateRange = options.dateRange || {};
        options.dateRange.end = nextArg;
        i++;
        break;
    }
  }

  // Use preset if no specific options provided
  if (Object.keys(options).length === 0) {
    await exporter.quickExport(command);
  } else {
    await exporter.exportToCSV(options);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = FastCSVExporter; 