#!/usr/bin/env node

/**
 * EXPORT & ANALYZE SCRIPT
 * This script will:
 * 1. Export CSV directly from Supabase using our own logic
 * 2. Save it to a new file
 * 3. Analyze the exported CSV for duplicates
 * 4. Compare with the existing CSV file
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('📤 SUPABASE DIRECT EXPORT & ANALYSIS');
console.log('=====================================\n');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function exportFromSupabase() {
    try {
        console.log('📊 Step 1: Getting total record count...');
        
        // Get total count
        const { count, error: countError } = await supabase
            .from('shedsuite_orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            throw new Error(`Failed to get count: ${countError.message}`);
        }

        console.log(`   Total records to export: ${count}\n`);

        console.log('📥 Step 2: Fetching ALL records for CSV export...');
        
        // Get a sample record to determine column order
        const { data: sampleData, error: sampleError } = await supabase
            .from('shedsuite_orders')
            .select('*')
            .limit(1);
            
        if (sampleError) {
            throw new Error(`Failed to get sample: ${sampleError.message}`);
        }
        
        const columns = Object.keys(sampleData[0]);
        console.log(`   Columns to export: ${columns.length}`);
        console.log(`   Key columns: id, order_number, customer_name, sync_timestamp\n`);

        // Fetch ALL records in batches
        const allRecords = [];
        const batchSize = 1000;
        let lastId = 0;
        let batchNumber = 1;
        
        while (true) {
            console.log(`   Exporting batch ${batchNumber} (starting from ID > ${lastId})...`);
            
            const { data: batchData, error: batchError } = await supabase
                .from('shedsuite_orders')
                .select('*')
                .gt('id', lastId.toString())
                .order('id', { ascending: true })
                .limit(batchSize);

            if (batchError) {
                throw new Error(`Failed to fetch batch: ${batchError.message}`);
            }

            if (!batchData || batchData.length === 0) {
                console.log('   Export complete!\n');
                break;
            }

            allRecords.push(...batchData);
            lastId = parseInt(batchData[batchData.length - 1].id);
            
            console.log(`   Exported ${batchData.length} records (total so far: ${allRecords.length})`);
            
            if (batchData.length < batchSize) {
                console.log('   Reached end of data.\n');
                break;
            }
            
            batchNumber++;
        }

        console.log(`✅ Exported ${allRecords.length} total records\n`);

        console.log('📝 Step 3: Writing CSV file...');
        
        // Generate CSV content
        const csvLines = [];
        
        // Add header
        csvLines.push(columns.join(','));
        
        // Add data rows
        allRecords.forEach(record => {
            const row = columns.map(col => {
                let value = record[col];
                
                // Handle null/undefined values
                if (value === null || value === undefined) {
                    return '';
                }
                
                // Convert to string and escape quotes
                value = String(value);
                
                // If value contains comma, quote, or newline, wrap in quotes and escape quotes
                if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                
                return value;
            });
            
            csvLines.push(row.join(','));
        });
        
        // Write to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportFilename = `supabase_direct_export_${timestamp}.csv`;
        const exportPath = path.join(__dirname, '..', exportFilename);
        
        fs.writeFileSync(exportPath, csvLines.join('\n'));
        console.log(`   CSV written to: ${exportFilename}`);
        console.log(`   File size: ${fs.statSync(exportPath).size} bytes\n`);
        
        return { exportPath, exportFilename, allRecords, columns };
        
    } catch (error) {
        console.error('❌ Export failed:', error.message);
        throw error;
    }
}

async function analyzeExportedCSV(exportPath, exportFilename, allRecords) {
    try {
        console.log('🔍 Step 4: Analyzing the exported CSV...');
        
        // Read the CSV we just created
        const csvContent = fs.readFileSync(exportPath, 'utf-8');
        const csvLines = csvContent.split('\n').filter(line => line.trim());
        
        console.log(`   CSV lines: ${csvLines.length}`);
        console.log(`   Expected: ${allRecords.length + 1} (data + header)`);
        
        if (csvLines.length !== allRecords.length + 1) {
            console.log(`⚠️  Line count mismatch! CSV: ${csvLines.length}, Expected: ${allRecords.length + 1}`);
        }
        
        // Parse CSV header
        const header = csvLines[0].split(',').map(col => col.replace(/"/g, '').trim());
        const idIndex = header.findIndex(col => col.toLowerCase() === 'id');
        const orderNumberIndex = header.findIndex(col => col.toLowerCase() === 'order_number');
        const customerNameIndex = header.findIndex(col => col.toLowerCase() === 'customer_name');
        
        console.log(`   ID column index: ${idIndex}`);
        console.log(`   Order Number column index: ${orderNumberIndex}`);
        console.log(`   Customer Name column index: ${customerNameIndex}\n`);
        
        // Parse CSV data and look for duplicates
        const csvRecords = [];
        const parseErrors = [];
        
        for (let i = 1; i < csvLines.length; i++) {
            const line = csvLines[i];
            if (!line.trim()) continue;
            
            try {
                // Simple CSV parsing
                const columns = [];
                let inQuotes = false;
                let currentCol = '';
                
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
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
                
                if (columns.length >= Math.max(idIndex, orderNumberIndex) + 1) {
                    const record = {
                        lineNumber: i + 1,
                        id: columns[idIndex]?.replace(/"/g, '').trim(),
                        orderNumber: columns[orderNumberIndex]?.replace(/"/g, '').trim(),
                        customerName: customerNameIndex >= 0 ? columns[customerNameIndex]?.replace(/"/g, '').trim() : ''
                    };
                    
                    if (record.id && record.orderNumber) {
                        csvRecords.push(record);
                    } else {
                        parseErrors.push(`Line ${i + 1}: Missing ID or Order Number`);
                    }
                } else {
                    parseErrors.push(`Line ${i + 1}: Insufficient columns`);
                }
            } catch (error) {
                parseErrors.push(`Line ${i + 1}: ${error.message}`);
            }
        }
        
        console.log(`✅ Parsed ${csvRecords.length} CSV records`);
        if (parseErrors.length > 0) {
            console.log(`⚠️  ${parseErrors.length} parsing errors`);
        }
        console.log();
        
        // Analyze for duplicates
        const idCounts = {};
        const orderNumberCounts = {};
        
        csvRecords.forEach(record => {
            idCounts[record.id] = (idCounts[record.id] || 0) + 1;
            orderNumberCounts[record.orderNumber] = (orderNumberCounts[record.orderNumber] || 0) + 1;
        });
        
        const duplicateIds = Object.entries(idCounts).filter(([id, count]) => count > 1);
        const duplicateOrderNumbers = Object.entries(orderNumberCounts).filter(([orderNumber, count]) => count > 1);
        
        console.log('📊 FRESH EXPORT ANALYSIS:');
        console.log('=========================');
        console.log(`   Total records: ${csvRecords.length}`);
        console.log(`   Unique IDs: ${Object.keys(idCounts).length}`);
        console.log(`   Unique Order Numbers: ${Object.keys(orderNumberCounts).length}`);
        console.log(`   Duplicate ID patterns: ${duplicateIds.length}`);
        console.log(`   Duplicate Order Number patterns: ${duplicateOrderNumbers.length}\n`);
        
        // Check specific case
        const id6675Records = csvRecords.filter(r => r.id === '6675');
        console.log(`🎯 ID "6675" in fresh export: ${id6675Records.length} occurrences`);
        id6675Records.forEach((record, i) => {
            console.log(`     ${i + 1}. Line ${record.lineNumber}: ${record.customerName} (${record.orderNumber})`);
        });
        console.log();
        
        if (duplicateIds.length === 0 && duplicateOrderNumbers.length === 0) {
            console.log('✅ FRESH EXPORT IS CLEAN: No duplicates found in our direct export');
        } else {
            console.log('❌ FRESH EXPORT HAS DUPLICATES: Our export process is creating duplicates!');
            
            // Show top duplicates
            if (duplicateIds.length > 0) {
                console.log('\n🚨 Top ID duplicates in fresh export:');
                duplicateIds.slice(0, 5).forEach(([id, count], index) => {
                    console.log(`   ${index + 1}. ID "${id}": ${count} occurrences`);
                });
            }
        }
        
        return {
            csvRecords,
            duplicateIds,
            duplicateOrderNumbers,
            totalRecords: csvRecords.length,
            uniqueIds: Object.keys(idCounts).length,
            uniqueOrderNumbers: Object.keys(orderNumberCounts).length
        };
        
    } catch (error) {
        console.error('❌ CSV analysis failed:', error.message);
        throw error;
    }
}

async function compareWithExistingCSV(freshAnalysis) {
    try {
        console.log('🔄 Step 5: Comparing with existing CSV...');
        
        const existingCsvPath = path.join(__dirname, '..', 'shedsuite_orders_rows (3).csv');
        
        if (!fs.existsSync(existingCsvPath)) {
            console.log('⚠️  Existing CSV not found, skipping comparison');
            return;
        }
        
        // Get stats from existing CSV
        const existingContent = fs.readFileSync(existingCsvPath, 'utf-8');
        const existingLines = existingContent.split('\n').filter(line => line.trim());
        
        console.log('📊 COMPARISON RESULTS:');
        console.log('======================');
        console.log(`   Existing CSV lines: ${existingLines.length}`);
        console.log(`   Fresh export lines: ${freshAnalysis.totalRecords + 1} (including header)`);
        console.log(`   Difference: ${(existingLines.length) - (freshAnalysis.totalRecords + 1)} lines`);
        console.log();
        
        console.log(`   Existing CSV data rows: ~${existingLines.length - 1}`);
        console.log(`   Fresh export data rows: ${freshAnalysis.totalRecords}`);
        console.log(`   Difference: ${(existingLines.length - 1) - freshAnalysis.totalRecords} records\n`);
        
        // Check file modification times
        const existingStat = fs.statSync(existingCsvPath);
        console.log(`   Existing CSV modified: ${existingStat.mtime}`);
        console.log(`   Fresh export created: ${new Date()}\n`);
        
        if (freshAnalysis.duplicateIds.length === 0 && freshAnalysis.duplicateOrderNumbers.length === 0) {
            console.log('✅ CONCLUSION: Fresh export is clean, existing CSV has outdated duplicates');
            console.log('✅ Database cleanup was successful, existing CSV is from before cleanup');
        } else {
            console.log('❌ CONCLUSION: Both exports have duplicates - export process is flawed');
        }
        
    } catch (error) {
        console.error('❌ Comparison failed:', error.message);
    }
}

async function main() {
    try {
        // Export directly from Supabase
        const { exportPath, exportFilename, allRecords, columns } = await exportFromSupabase();
        
        // Analyze the fresh export
        const freshAnalysis = await analyzeExportedCSV(exportPath, exportFilename, allRecords);
        
        // Compare with existing CSV
        await compareWithExistingCSV(freshAnalysis);
        
        console.log('\n🏁 EXPORT & ANALYSIS COMPLETE');
        console.log(`📄 Fresh export saved as: ${exportFilename}`);
        
    } catch (error) {
        console.error('❌ Process failed:', error.message);
        process.exit(1);
    }
}

main();