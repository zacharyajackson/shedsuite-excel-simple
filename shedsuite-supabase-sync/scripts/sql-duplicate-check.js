#!/usr/bin/env node

/**
 * SQL-Based Duplicate Check - Most Efficient Method
 * Uses direct SQL to check for duplicates across ALL records
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sqlDuplicateCheck() {
  console.log('🔍 SQL-BASED COMPREHENSIVE DUPLICATE CHECK\n');

  try {
    // Step 1: Get total count
    console.log('📊 Getting total record count...');
    const { count, error: countError } = await supabase
      .from('shedsuite_orders')
      .select('id', { count: 'exact', head: true });

    if (countError) throw countError;
    console.log(`   Total records: ${count.toLocaleString()}`);

    // Step 2: Use SQL to find duplicates directly
    console.log('\n🔍 Running SQL query to find duplicates...');
    
    const duplicateQuery = `
      SELECT 
        id,
        COUNT(*) as duplicate_count
      FROM shedsuite_orders 
      GROUP BY id 
      HAVING COUNT(*) > 1 
      ORDER BY COUNT(*) DESC
      LIMIT 100;
    `;

    let duplicates = [];
    let dupError = null;
    
    try {
      // Try SQL RPC approach first
      const { data, error } = await supabase.rpc('exec_sql', { query: duplicateQuery });
      if (error) throw error;
      duplicates = data || [];
    } catch (rpcError) {
      // Fallback: use the PostgREST approach
      console.log('   RPC not available, using PostgREST query method...');
      
      try {
        // Get ALL IDs using pagination to bypass 1000 record limit
        console.log('   Fetching ALL records using pagination...');
        let allIds = [];
        let from = 0;
        const batchSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
          const { data: batch, error } = await supabase
            .from('shedsuite_orders')
            .select('id, order_number')
            .range(from, from + batchSize - 1);

          if (error) throw error;

          if (batch && batch.length > 0) {
            allIds = allIds.concat(batch);
            console.log(`     Fetched: ${allIds.length.toLocaleString()} / ${count.toLocaleString()} records`);
            from += batchSize;
            hasMore = batch.length === batchSize;
          } else {
            hasMore = false;
          }
        }
        
        console.log(`   Analyzing ${allIds.length.toLocaleString()} records for duplicates...`);
        
        // Count occurrences for both ID and order_number
        const idCounts = {};
        const orderNumberCounts = {};
        
        allIds.forEach(record => {
          // Count ID duplicates
          idCounts[record.id] = (idCounts[record.id] || 0) + 1;
          
          // Count order_number duplicates
          if (record.order_number) {
            orderNumberCounts[record.order_number] = (orderNumberCounts[record.order_number] || 0) + 1;
          }
        });
        
        // Find ID duplicates
        const idDuplicates = [];
        for (const [id, count] of Object.entries(idCounts)) {
          if (count > 1) {
            idDuplicates.push({ field: 'id', value: id, duplicate_count: count });
          }
        }
        
        // Find order_number duplicates
        const orderDuplicates = [];
        for (const [orderNumber, count] of Object.entries(orderNumberCounts)) {
          if (count > 1) {
            orderDuplicates.push({ field: 'order_number', value: orderNumber, duplicate_count: count });
          }
        }
        
        // Combine duplicates (prioritize by count)
        duplicates = [...idDuplicates, ...orderDuplicates].sort((a, b) => b.duplicate_count - a.duplicate_count);
        
        // Store both analyses for reporting
        duplicates.idDuplicates = idDuplicates;
        duplicates.orderDuplicates = orderDuplicates;
        duplicates.totalRecordsAnalyzed = allIds.length;
        duplicates.uniqueIds = Object.keys(idCounts).length;
        duplicates.uniqueOrderNumbers = Object.keys(orderNumberCounts).length;
        
      } catch (fallbackError) {
        dupError = fallbackError;
      }
    }

    if (dupError) throw dupError;

    // Step 3: Get unique count using SQL
    console.log('\n📊 Getting unique ID count...');
    
    const uniqueQuery = `
      SELECT COUNT(DISTINCT id) as unique_count
      FROM shedsuite_orders;
    `;

    let uniqueResult = null;
    let uniqueError = null;
    
    try {
      // Try SQL RPC approach first
      const { data, error } = await supabase.rpc('exec_sql', { query: uniqueQuery });
      if (error) throw error;
      uniqueResult = data;
    } catch (rpcError) {
      // Fallback: calculate manually
      try {
        const { data: allIds, error } = await supabase
          .from('shedsuite_orders')
          .select('id');
          
        if (error) throw error;
        
        const uniqueIds = new Set(allIds.map(r => r.id));
        uniqueResult = [{ unique_count: uniqueIds.size }];
      } catch (fallbackError) {
        uniqueError = fallbackError;
      }
    }

    const uniqueCount = uniqueResult && uniqueResult[0] ? uniqueResult[0].unique_count : (duplicates.uniqueIds || 'Unknown');

    // Step 4: Report results
    console.log('\n📊 COMPREHENSIVE DUPLICATE ANALYSIS:');
    console.log(`   Total records analyzed: ${duplicates.totalRecordsAnalyzed || count}`);
    console.log(`   Unique IDs: ${duplicates.uniqueIds ? duplicates.uniqueIds.toLocaleString() : uniqueCount}`);
    console.log(`   Unique Order Numbers: ${duplicates.uniqueOrderNumbers ? duplicates.uniqueOrderNumbers.toLocaleString() : 'Unknown'}`);
    
    // Report ID duplicates
    const idDups = duplicates.idDuplicates || [];
    const orderDups = duplicates.orderDuplicates || [];
    
    console.log(`\n🔍 ID DUPLICATE ANALYSIS:`);
    if (idDups.length > 0) {
      console.log(`   ❌ ID duplicates found: ${idDups.length.toLocaleString()}`);
      console.log('   Top duplicate IDs:');
      idDups.slice(0, 10).forEach((dup, index) => {
        console.log(`     ${index + 1}. ID "${dup.value}": ${dup.duplicate_count} copies`);
      });
    } else {
      console.log(`   ✅ No ID duplicates found`);
    }
    
    console.log(`\n🔍 ORDER NUMBER DUPLICATE ANALYSIS:`);
    if (orderDups.length > 0) {
      console.log(`   ❌ Order number duplicates found: ${orderDups.length.toLocaleString()}`);
      console.log('   Top duplicate order numbers:');
      orderDups.slice(0, 10).forEach((dup, index) => {
        console.log(`     ${index + 1}. Order "${dup.value}": ${dup.duplicate_count} copies`);
      });
      
      // Get details for the worst order number duplicate
      const worstOrderDup = orderDups[0];
      console.log(`\n🔍 Details for most duplicated order number "${worstOrderDup.value}":`);
      
      const { data: samples, error: sampleError } = await supabase
        .from('shedsuite_orders')
        .select('id, customer_name, order_number, sync_timestamp, created_at')
        .eq('order_number', worstOrderDup.value)
        .limit(10);

      if (!sampleError && samples && samples.length > 0) {
        samples.forEach((record, index) => {
          console.log(`     ${index + 1}. ID: ${record.id} - ${record.customer_name}`);
          console.log(`        Synced: ${record.sync_timestamp}`);
        });
      }
    } else {
      console.log(`   ✅ No order number duplicates found`);
    }

    // Overall summary
    if (idDups.length === 0 && orderDups.length === 0) {
      console.log('\n✅ NO DUPLICATES FOUND!');
      console.log('   Every record has unique ID and order number.');
      console.log('   Database integrity is perfect.');
      console.log('   The "33,000 duplicates" reported are NOT in the database.');
    } else {
      console.log('\n❌ DUPLICATES DETECTED!');
      console.log(`   Total duplicate IDs: ${idDups.length}`);
      console.log(`   Total duplicate order numbers: ${orderDups.length}`);
      console.log('   This explains the discrepancy you\'re seeing!');
    }

    // Step 5: Additional analysis
    console.log('\n📈 ADDITIONAL VERIFICATION:');
    
    if (count === uniqueCount) {
      console.log('   ✅ Total records = Unique IDs (Perfect integrity)');
    } else {
      console.log(`   ❌ Mismatch: ${count} total vs ${uniqueCount} unique (${count - uniqueCount} duplicates)`);
    }

    // Check for primary key constraint
    console.log('\n🔍 Checking database constraints...');
    try {
      const { data: constraints, error: constraintError } = await supabase
        .rpc('exec_sql', { 
          query: `
            SELECT constraint_name, constraint_type 
            FROM information_schema.table_constraints 
            WHERE table_name = 'shedsuite_orders' AND constraint_type = 'PRIMARY KEY';
          `
        });

      if (!constraintError && constraints && constraints.length > 0) {
        console.log('   ✅ Primary key constraint exists on table');
        console.log('   ✅ Database should prevent true duplicates');
      } else {
        console.log('   ⚠️  Could not verify primary key constraint');
      }
    } catch (e) {
      console.log('   ⚠️  Could not check constraints (RPC not available)');
    }

  } catch (error) {
    console.error('❌ Error during SQL duplicate check:', error.message);
  }
}

// Run the SQL-based check
sqlDuplicateCheck().catch(console.error);