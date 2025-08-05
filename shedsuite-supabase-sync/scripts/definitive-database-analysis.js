#!/usr/bin/env node

/**
 * DEFINITIVE DATABASE DUPLICATE ANALYSIS & CLEANUP
 * This script will:
 * 1. Get the exact Supabase table schema
 * 2. Fetch ALL records programmatically (no SQL limits)
 * 3. Apply the EXACT same logic as CSV analysis
 * 4. Clean up duplicates definitively
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('🔍 DEFINITIVE DATABASE DUPLICATE ANALYSIS & CLEANUP');
console.log('=====================================================\n');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
    try {
        console.log('📋 Step 1: Getting table schema...');
        
        // Get table structure - skip RPC and go directly to sample data
        let schemaData = null;
        let schemaError = null;

        console.log('📊 Getting table structure from sample record...');
        
        // Get a sample record to understand structure
        const { data: sampleData, error: sampleError } = await supabase
                .from('shedsuite_orders')
                .select('*')
                .limit(1);
                
        if (sampleError) {
            throw new Error(`Failed to get sample data: ${sampleError.message}`);
        }
        
        if (sampleData && sampleData.length > 0) {
            const columns = Object.keys(sampleData[0]);
            console.log('📊 Table columns found:', columns.length);
            console.log('   Key columns: id, order_number, customer_name, sync_timestamp');
            
            // Verify required columns exist
            const requiredColumns = ['id', 'order_number', 'customer_name', 'sync_timestamp'];
            const missingColumns = requiredColumns.filter(col => !columns.includes(col));
            
            if (missingColumns.length > 0) {
                throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
            }
            
            console.log('✅ All required columns present\n');
        }

        console.log('📊 Step 2: Getting total record count...');
        
        // Get total count
        const { count, error: countError } = await supabase
            .from('shedsuite_orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            throw new Error(`Failed to get count: ${countError.message}`);
        }

        console.log(`   Total records in database: ${count}\n`);

        console.log('📥 Step 3: Fetching ALL records programmatically...');
        console.log('   (This may take a while for large datasets)\n');
        
        // Fetch ALL records in batches to avoid memory issues
        const allRecords = [];
        const batchSize = 1000;
        let lastId = 0;
        let batchNumber = 1;
        
        while (true) {
            console.log(`   Fetching batch ${batchNumber} (starting from ID > ${lastId})...`);
            
            const { data: batchData, error: batchError } = await supabase
                .from('shedsuite_orders')
                .select('id, order_number, customer_name, sync_timestamp, created_at')
                .gt('id', lastId.toString())
                .order('id', { ascending: true })
                .limit(batchSize);

            if (batchError) {
                throw new Error(`Failed to fetch batch: ${batchError.message}`);
            }

            if (!batchData || batchData.length === 0) {
                console.log('   No more records to fetch.\n');
                break;
            }

            allRecords.push(...batchData);
            lastId = parseInt(batchData[batchData.length - 1].id);
            
            console.log(`   Fetched ${batchData.length} records (total so far: ${allRecords.length})`);
            
            // Safety check to prevent infinite loops
            if (batchData.length < batchSize) {
                console.log('   Reached end of data.\n');
                break;
            }
            
            batchNumber++;
            
            // Prevent memory overload for very large datasets
            if (allRecords.length > 200000) {
                console.log('⚠️  Large dataset detected, processing in chunks...');
                break;
            }
        }

        console.log(`✅ Fetched ${allRecords.length} total records\n`);

        console.log('🔍 Step 4: Analyzing for duplicates (same logic as CSV)...');
        
        // Apply EXACT same logic as CSV analysis
        const idCounts = {};
        const orderNumberCounts = {};
        
        allRecords.forEach(record => {
            const id = record.id.toString().trim();
            const orderNumber = record.order_number ? record.order_number.toString().trim() : '';
            
            idCounts[id] = (idCounts[id] || 0) + 1;
            if (orderNumber) {
                orderNumberCounts[orderNumber] = (orderNumberCounts[orderNumber] || 0) + 1;
            }
        });

        const duplicateIds = Object.entries(idCounts).filter(([id, count]) => count > 1);
        const duplicateOrderNumbers = Object.entries(orderNumberCounts).filter(([orderNumber, count]) => count > 1);

        console.log('📊 DEFINITIVE ANALYSIS RESULTS:');
        console.log('===============================');
        console.log(`   Total records analyzed: ${allRecords.length}`);
        console.log(`   Unique IDs: ${Object.keys(idCounts).length}`);
        console.log(`   Unique Order Numbers: ${Object.keys(orderNumberCounts).length}`);
        console.log(`   Duplicate ID patterns: ${duplicateIds.length}`);
        console.log(`   Duplicate Order Number patterns: ${duplicateOrderNumbers.length}`);
        
        const totalDuplicateIdRecords = duplicateIds.reduce((sum, [, count]) => sum + (count - 1), 0);
        const totalDuplicateOrderRecords = duplicateOrderNumbers.reduce((sum, [, count]) => sum + (count - 1), 0);
        
        console.log(`   Total duplicate ID records: ${totalDuplicateIdRecords}`);
        console.log(`   Total duplicate Order Number records: ${totalDuplicateOrderRecords}\n`);

        // Show specific duplicates
        if (duplicateIds.length > 0) {
            console.log('🚨 ID DUPLICATES FOUND:');
            duplicateIds.slice(0, 10).forEach(([id, count], index) => {
                console.log(`   ${index + 1}. ID "${id}": ${count} occurrences`);
                
                const duplicateRecords = allRecords.filter(r => r.id.toString().trim() === id);
                duplicateRecords.forEach((record, i) => {
                    console.log(`      ${i + 1}. ${record.customer_name} (${record.order_number}) - ${record.sync_timestamp}`);
                });
            });
            console.log();
        }

        if (duplicateOrderNumbers.length > 0) {
            console.log('🚨 ORDER NUMBER DUPLICATES FOUND:');
            duplicateOrderNumbers.slice(0, 10).forEach(([orderNumber, count], index) => {
                console.log(`   ${index + 1}. Order "${orderNumber}": ${count} occurrences`);
                
                const duplicateRecords = allRecords.filter(r => 
                    r.order_number && r.order_number.toString().trim() === orderNumber
                );
                duplicateRecords.forEach((record, i) => {
                    console.log(`      ${i + 1}. ID ${record.id} - ${record.customer_name} - ${record.sync_timestamp}`);
                });
            });
            console.log();
        }

        // Check the specific case we've been tracking
        console.log('🎯 SPECIFIC CASE CHECK:');
        const id6675Records = allRecords.filter(r => r.id.toString().trim() === '6675');
        console.log(`   ID "6675" occurrences: ${id6675Records.length}`);
        id6675Records.forEach((record, i) => {
            console.log(`     ${i + 1}. ${record.customer_name} (${record.order_number}) - ${record.sync_timestamp}`);
        });
        console.log();

        // Final determination
        if (duplicateIds.length === 0 && duplicateOrderNumbers.length === 0) {
            console.log('✅ DATABASE IS CLEAN: No duplicates found');
            console.log('✅ Ready for unique constraints and production use');
        } else {
            console.log('❌ DUPLICATES CONFIRMED: Database needs cleanup');
            console.log(`❌ ${duplicateIds.length} duplicate ID patterns need resolution`);
            console.log(`❌ ${duplicateOrderNumbers.length} duplicate order number patterns need resolution`);
            
            console.log('\n🛠️  CLEANUP REQUIRED:');
            console.log('   Run cleanup operations to remove duplicates before adding constraints');
        }

    } catch (error) {
        console.error('❌ Error during analysis:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

main();