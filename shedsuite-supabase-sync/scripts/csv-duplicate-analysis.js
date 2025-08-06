#!/usr/bin/env node

/**
 * COMPREHENSIVE CSV DUPLICATE ANALYSIS
 * Analyzes the actual CSV export to validate database state
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 COMPREHENSIVE CSV DUPLICATE ANALYSIS');
console.log('=====================================\n');

const csvPath = path.join(__dirname, '..', 'client-exports/shedsuite_full_export_2025-08-05.csv');

if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found at:', csvPath);
    console.error('Please ensure the CSV export is in the correct location.');
    process.exit(1);
}

console.log('📂 Reading CSV file:', csvPath);

try {
    // Read the CSV file
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    console.log('📊 CSV File Statistics:');
    console.log(`   Total lines: ${lines.length}`);
    console.log(`   Header line: ${lines[0] ? 'Present' : 'Missing'}`);
    console.log(`   Data rows: ${lines.length - 1}\n`);
    
    if (lines.length < 2) {
        console.error('❌ CSV file appears to be empty or invalid');
        process.exit(1);
    }
    
    // Parse header to find column indices
    const header = lines[0].split(',').map(col => col.replace(/"/g, '').trim());
    const idIndex = header.findIndex(col => col.toLowerCase() === 'id');
    const orderNumberIndex = header.findIndex(col => col.toLowerCase() === 'order_number');
    const customerNameIndex = header.findIndex(col => col.toLowerCase() === 'customer_name');
    const syncTimestampIndex = header.findIndex(col => col.toLowerCase() === 'sync_timestamp');
    
    console.log('🔍 Column Analysis:');
    console.log(`   ID column index: ${idIndex} (${idIndex >= 0 ? '✅ Found' : '❌ Missing'})`);
    console.log(`   Order Number column index: ${orderNumberIndex} (${orderNumberIndex >= 0 ? '✅ Found' : '❌ Missing'})`);
    console.log(`   Customer Name column index: ${customerNameIndex} (${customerNameIndex >= 0 ? '✅ Found' : '❌ Missing'})`);
    console.log(`   Sync Timestamp column index: ${syncTimestampIndex} (${syncTimestampIndex >= 0 ? '✅ Found' : '❌ Missing'})\n`);
    
    if (idIndex === -1 || orderNumberIndex === -1) {
        console.error('❌ Required columns (id, order_number) not found in CSV');
        console.error('Available columns:', header);
        process.exit(1);
    }
    
    // Parse data rows
    console.log('📊 Parsing data rows...');
    const records = [];
    const parseErrors = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
            // Simple CSV parsing (handles basic cases)
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
            columns.push(currentCol.trim()); // Add last column
            
            if (columns.length >= Math.max(idIndex, orderNumberIndex) + 1) {
                const record = {
                    lineNumber: i + 1,
                    id: columns[idIndex]?.replace(/"/g, '').trim(),
                    orderNumber: columns[orderNumberIndex]?.replace(/"/g, '').trim(),
                    customerName: customerNameIndex >= 0 ? columns[customerNameIndex]?.replace(/"/g, '').trim() : '',
                    syncTimestamp: syncTimestampIndex >= 0 ? columns[syncTimestampIndex]?.replace(/"/g, '').trim() : ''
                };
                
                if (record.id && record.orderNumber) {
                    records.push(record);
                } else {
                    parseErrors.push({
                        lineNumber: i + 1,
                        reason: 'Missing ID or Order Number',
                        line: line.substring(0, 100) + '...'
                    });
                }
            } else {
                parseErrors.push({
                    lineNumber: i + 1,
                    reason: `Insufficient columns (${columns.length})`,
                    line: line.substring(0, 100) + '...'
                });
            }
        } catch (error) {
            parseErrors.push({
                lineNumber: i + 1,
                reason: error.message,
                line: line.substring(0, 100) + '...'
            });
        }
    }
    
    console.log(`✅ Successfully parsed ${records.length} records`);
    if (parseErrors.length > 0) {
        console.log(`⚠️  ${parseErrors.length} parsing errors encountered`);
        if (parseErrors.length <= 10) {
            parseErrors.forEach(error => {
                console.log(`   Line ${error.lineNumber}: ${error.reason}`);
            });
        }
    }
    console.log();
    
    // Duplicate Analysis
    console.log('🔍 DUPLICATE ANALYSIS:');
    console.log('======================\n');
    
    // ID duplicates
    const idCounts = {};
    const orderNumberCounts = {};
    
    records.forEach(record => {
        idCounts[record.id] = (idCounts[record.id] || 0) + 1;
        orderNumberCounts[record.orderNumber] = (orderNumberCounts[record.orderNumber] || 0) + 1;
    });
    
    const duplicateIds = Object.entries(idCounts).filter(([id, count]) => count > 1);
    const duplicateOrderNumbers = Object.entries(orderNumberCounts).filter(([orderNumber, count]) => count > 1);
    
    console.log('📊 SUMMARY STATISTICS:');
    console.log(`   Total records analyzed: ${records.length}`);
    console.log(`   Unique IDs: ${Object.keys(idCounts).length}`);
    console.log(`   Unique Order Numbers: ${Object.keys(orderNumberCounts).length}`);
    console.log(`   Duplicate IDs found: ${duplicateIds.length}`);
    console.log(`   Duplicate Order Numbers found: ${duplicateOrderNumbers.length}\n`);
    
    // Detailed duplicate analysis
    if (duplicateIds.length > 0) {
        console.log('🚨 ID DUPLICATES DETECTED:');
        console.log(`   Total duplicate ID entries: ${duplicateIds.length}`);
        console.log('   Top 10 duplicate IDs:');
        duplicateIds
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([id, count], index) => {
                console.log(`     ${index + 1}. ID "${id}": ${count} occurrences`);
                
                // Show details for this duplicate
                const duplicateRecords = records.filter(r => r.id === id);
                duplicateRecords.forEach((record, i) => {
                    console.log(`        ${i + 1}. Line ${record.lineNumber}: ${record.customerName} (${record.orderNumber}) - ${record.syncTimestamp}`);
                });
            });
        console.log();
    } else {
        console.log('✅ NO ID DUPLICATES FOUND\n');
    }
    
    if (duplicateOrderNumbers.length > 0) {
        console.log('🚨 ORDER NUMBER DUPLICATES DETECTED:');
        console.log(`   Total duplicate order number entries: ${duplicateOrderNumbers.length}`);
        console.log('   Top 10 duplicate order numbers:');
        duplicateOrderNumbers
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([orderNumber, count], index) => {
                console.log(`     ${index + 1}. Order "${orderNumber}": ${count} occurrences`);
                
                // Show details for this duplicate
                const duplicateRecords = records.filter(r => r.orderNumber === orderNumber);
                duplicateRecords.forEach((record, i) => {
                    console.log(`        ${i + 1}. Line ${record.lineNumber}: ID ${record.id} - ${record.customerName} - ${record.syncTimestamp}`);
                });
            });
        console.log();
    } else {
        console.log('✅ NO ORDER NUMBER DUPLICATES FOUND\n');
    }
    
    // Cross-validation
    console.log('🔍 CROSS-VALIDATION:');
    console.log('====================\n');
    
    const totalDuplicateIdRecords = duplicateIds.reduce((sum, [, count]) => sum + (count - 1), 0);
    const totalDuplicateOrderRecords = duplicateOrderNumbers.reduce((sum, [, count]) => sum + (count - 1), 0);
    
    console.log(`   Records that are ID duplicates: ${totalDuplicateIdRecords}`);
    console.log(`   Records that are order number duplicates: ${totalDuplicateOrderRecords}`);
    console.log(`   Expected unique records after cleanup: ${records.length - Math.max(totalDuplicateIdRecords, totalDuplicateOrderRecords)}\n`);
    
    // Check specific cases mentioned in the issue
    console.log('🎯 SPECIFIC ISSUE VALIDATION:');
    console.log('=============================\n');
    
    // Check FF-67197 specifically
    const ff67197Records = records.filter(r => r.orderNumber === 'FF-67197');
    console.log(`   FF-67197 occurrences: ${ff67197Records.length}`);
    if (ff67197Records.length > 0) {
        ff67197Records.forEach((record, i) => {
            console.log(`     ${i + 1}. Line ${record.lineNumber}: ID ${record.id} - ${record.customerName} - ${record.syncTimestamp}`);
        });
    }
    console.log();
    
    // Final assessment
    console.log('🏁 FINAL ASSESSMENT:');
    console.log('====================\n');
    
    if (duplicateIds.length === 0 && duplicateOrderNumbers.length === 0) {
        console.log('✅ CLEAN DATABASE: No duplicates detected in CSV export');
        console.log('✅ The cleanup operation was successful!');
        console.log('✅ Safe to add unique constraints and resume sync operations');
    } else {
        console.log('❌ DUPLICATES STILL EXIST: Further cleanup required');
        console.log(`❌ ${duplicateIds.length} duplicate ID patterns found`);
        console.log(`❌ ${duplicateOrderNumbers.length} duplicate order number patterns found`);
        console.log('❌ Additional cleanup steps needed before resuming sync');
    }
    
} catch (error) {
    console.error('❌ Error analyzing CSV file:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}