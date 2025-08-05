#!/usr/bin/env node

/**
 * Comprehensive Duplicate Check - ALL Records
 * Purpose: Check every single record for duplicates
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fullDuplicateCheck() {
  console.log('🔍 COMPREHENSIVE DUPLICATE CHECK - ALL RECORDS\n');

  try {
    // Step 1: Get total count
    const { count, error: countError } = await supabase
      .from('shedsuite_orders')
      .select('id', { count: 'exact', head: true });

    if (countError) throw countError;

    console.log(`📊 Total records in database: ${count.toLocaleString()}`);
    console.log('⏳ This will check EVERY record for duplicates...\n');

    // Step 2: Get ALL IDs from database using pagination
    console.log('📥 Fetching all record IDs using pagination...');
    const startTime = Date.now();
    
    let allRecords = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: batch, error: fetchError } = await supabase
        .from('shedsuite_orders')
        .select('id')
        .range(from, from + batchSize - 1);

      if (fetchError) throw fetchError;

      if (batch && batch.length > 0) {
        allRecords = allRecords.concat(batch);
        console.log(`   Fetched batch: ${allRecords.length.toLocaleString()} / ${count.toLocaleString()} records`);
        from += batchSize;
        hasMore = batch.length === batchSize; // Continue if we got a full batch
      } else {
        hasMore = false;
      }
    }

    const fetchDuration = Date.now() - startTime;
    console.log(`✅ Fetched ${allRecords.length.toLocaleString()} total records in ${fetchDuration}ms`);

    // Step 3: Analyze for duplicates
    console.log('\n🔍 Analyzing for duplicate IDs...');
    const analyzeStart = Date.now();
    
    const idCounts = {};
    const duplicateIds = [];

    allRecords.forEach(record => {
      const id = record.id;
      if (idCounts[id]) {
        idCounts[id]++;
        if (idCounts[id] === 2) {
          // First time we see this as a duplicate
          duplicateIds.push(id);
        }
      } else {
        idCounts[id] = 1;
      }
    });

    const analyzeDuration = Date.now() - analyzeStart;
    console.log(`✅ Analysis completed in ${analyzeDuration}ms`);

    // Step 4: Report results
    console.log('\n📊 DUPLICATE ANALYSIS RESULTS:');
    console.log(`   Total records examined: ${allRecords.length.toLocaleString()}`);
    console.log(`   Unique IDs found: ${Object.keys(idCounts).length.toLocaleString()}`);
    console.log(`   Duplicate IDs found: ${duplicateIds.length.toLocaleString()}`);
    console.log(`   Total duplicate records: ${allRecords.length - Object.keys(idCounts).length}`);

    if (duplicateIds.length > 0) {
      console.log('\n❌ DUPLICATES DETECTED!');
      
      // Get details for the worst duplicates
      const duplicateDetails = duplicateIds
        .map(id => ({ id, count: idCounts[id] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20); // Top 20 worst duplicates

      console.log('\n🚨 Top Duplicate IDs:');
      duplicateDetails.forEach((dup, index) => {
        console.log(`   ${index + 1}. ID "${dup.id}": ${dup.count} copies`);
      });

      // Get sample records for the worst duplicate
      if (duplicateDetails.length > 0) {
        const worstId = duplicateDetails[0].id;
        console.log(`\n🔍 Sample records for duplicate ID "${worstId}":`);
        
        const { data: sampleDuplicates, error: sampleError } = await supabase
          .from('shedsuite_orders')
          .select('id, customer_name, order_number, sync_timestamp, created_at')
          .eq('id', worstId)
          .limit(5);

        if (!sampleError && sampleDuplicates.length > 0) {
          sampleDuplicates.forEach((record, index) => {
            console.log(`     ${index + 1}. ${record.customer_name} (${record.order_number}) - Synced: ${record.sync_timestamp}`);
          });
        }
      }

    } else {
      console.log('\n✅ NO DUPLICATES FOUND!');
      console.log('   Every record has a unique ID.');
      console.log('   Database integrity is perfect.');
    }

    // Step 5: Additional statistics
    console.log('\n📈 ADDITIONAL STATISTICS:');
    
    // ID format analysis
    const numericIds = Object.keys(idCounts).filter(id => /^\d+$/.test(id));
    const nonNumericIds = Object.keys(idCounts).filter(id => !/^\d+$/.test(id));
    
    console.log(`   Numeric IDs: ${numericIds.length.toLocaleString()}`);
    console.log(`   Non-numeric IDs: ${nonNumericIds.length.toLocaleString()}`);

    if (nonNumericIds.length > 0) {
      console.log(`   Sample non-numeric IDs: ${nonNumericIds.slice(0, 5).join(', ')}`);
    }

    // ID range analysis (for numeric IDs only)
    if (numericIds.length > 0) {
      const numericValues = numericIds.map(id => parseInt(id)).sort((a, b) => a - b);
      console.log(`   Numeric ID range: ${numericValues[0]} to ${numericValues[numericValues.length - 1]}`);
      
      // Check for gaps in sequence
      const gaps = [];
      for (let i = 1; i < numericValues.length && gaps.length < 10; i++) {
        if (numericValues[i] - numericValues[i-1] > 1) {
          gaps.push(`${numericValues[i-1]} to ${numericValues[i]}`);
        }
      }
      
      if (gaps.length > 0) {
        console.log(`   Sample ID gaps: ${gaps.slice(0, 5).join(', ')}`);
      }
    }

    console.log(`\n⏱️  Total analysis time: ${Date.now() - startTime}ms`);

  } catch (error) {
    console.error('❌ Error during duplicate check:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the comprehensive check
fullDuplicateCheck().catch(console.error);