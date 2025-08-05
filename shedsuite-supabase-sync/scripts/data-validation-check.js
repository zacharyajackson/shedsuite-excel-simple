#!/usr/bin/env node

/**
 * Emergency Data Validation Script
 * Purpose: Quickly identify data integrity issues
 * Date: 2025-07-27
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runDataValidation() {
  console.log('🔍 Starting Production Data Validation...\n');
  console.log('📋 Purpose: Analyze discrepancies between ShedSuite export and database export\n');

  // Check environment variables first
  console.log('🔧 Step 0: Environment Configuration Check');
  const requiredEnvVars = {
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  let envOk = true;
  for (const [name, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      console.error(`❌ Missing environment variable: ${name}`);
      envOk = false;
    } else {
      const maskedValue = name.includes('KEY') ? value.substring(0, 10) + '...' : value;
      console.log(`   ✅ ${name}: ${maskedValue}`);
    }
  }

  if (!envOk) {
    console.log('\n💡 Please check your .env file has the correct Supabase credentials');
    return;
  }

  try {
    // Check 1: Basic table info
    console.log('📊 Step 1: Database Connection & Table Analysis');
    
    // First, check if we can connect to the database
    console.log('   Testing database connection...');
    
    const { data: tableInfo, error: tableError, count } = await supabase
      .from('shedsuite_orders')
      .select('id', { count: 'exact', head: true });

    if (tableError) {
      console.error('❌ Error accessing table:', tableError.message);
      console.error('❌ Full error details:', tableError);
      
      // Try to check if table exists
      console.log('\n🔍 Checking if table exists...');
      const { data: tables, error: schemaError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .eq('table_name', 'shedsuite_orders');
        
      if (schemaError) {
        console.error('❌ Cannot access schema information:', schemaError.message);
        console.log('\n💡 Possible issues:');
        console.log('   - Database URL incorrect');
        console.log('   - Service role key invalid');
        console.log('   - Network connection issue');
      } else if (!tables || tables.length === 0) {
        console.error('❌ Table "shedsuite_orders" does not exist');
        console.log('\n💡 Possible solutions:');
        console.log('   - Run database migrations');
        console.log('   - Check table name spelling');
        console.log('   - Verify database schema');
      } else {
        console.log('✅ Table exists, but count query failed');
      }
      return;
    }

    const recordCount = count || 0;
    console.log(`✅ Database connection successful`);
    console.log(`   Total records in database: ${recordCount.toLocaleString()}`);
    console.log(`   Expected from production logs: ~98,100+ records`);
    
    if (recordCount === 0) {
      console.log('⚠️  Database appears to be empty - this suggests sync hasn\'t run or failed');
      return;
    }

    // Check 2: Duplicate analysis
    console.log('\n🔍 Step 2: Duplicate Record Analysis');
    
    let duplicateData;
    try {
      // Try to use a custom RPC function if it exists
      const { data, error } = await supabase.rpc('analyze_duplicates');
      if (error) throw error;
      duplicateData = data;
    } catch (rpcError) {
      // Fallback: manual duplicate check
      console.log('   Using comprehensive duplicate analysis method...');
      console.log('   Analyzing all 98,265+ records for duplicates...');
      
      // Get ALL IDs from the database (no limit)
      const { data, error } = await supabase
        .from('shedsuite_orders')
        .select('id');

      if (error) throw error;

      const idCounts = {};
      data.forEach(record => {
        idCounts[record.id] = (idCounts[record.id] || 0) + 1;
      });

      const duplicates = Object.entries(idCounts)
        .filter(([id, count]) => count > 1)
        .sort((a, b) => b[1] - a[1]);

      duplicateData = {
        total_records: data.length,
        unique_ids: Object.keys(idCounts).length,
        duplicate_count: duplicates.length,
        worst_duplicates: duplicates.slice(0, 10)
      };
    }

    if (duplicateData) {
      console.log(`   Records analyzed: ${duplicateData.total_records || 'Unknown'}`);
      console.log(`   Unique IDs: ${duplicateData.unique_ids || 'Unknown'}`);
      console.log(`   Duplicate IDs: ${duplicateData.duplicate_count || 0}`);
      
      if (duplicateData.worst_duplicates && duplicateData.worst_duplicates.length > 0) {
        console.log('\n   Top duplicate IDs:');
        duplicateData.worst_duplicates.forEach(([id, count]) => {
          console.log(`     ID ${id}: ${count} copies`);
        });
      }
    }

    // Check 3: Recent sync activity
    console.log('\n📅 Step 3: Recent Sync Activity');
    const { data: recentData, error: recentError } = await supabase
      .from('shedsuite_orders')
      .select('sync_timestamp, created_at')
      .order('sync_timestamp', { ascending: false })
      .limit(5);

    if (!recentError && recentData.length > 0) {
      console.log('   Most recent sync timestamps:');
      recentData.forEach((record, index) => {
        console.log(`     ${index + 1}. ${record.sync_timestamp || record.created_at}`);
      });
    }

    // Check 4: Sample record structure
    console.log('\n🔍 Step 4: Sample Record Structure');
    const { data: sampleData, error: sampleError } = await supabase
      .from('shedsuite_orders')
      .select('id, customer_name, order_number, status, total_amount_dollar_amount, sync_timestamp')
      .limit(3);

    if (!sampleError && sampleData.length > 0) {
      console.log('   Sample records:');
      sampleData.forEach((record, index) => {
        console.log(`     ${index + 1}. ID: ${record.id}, Customer: ${record.customer_name}, Order: ${record.order_number}`);
      });
    }

    // Check 5: Missing data patterns
    console.log('\n❓ Step 5: Missing Data Analysis');
    const { data: missingData, error: missingError } = await supabase
      .from('shedsuite_orders')
      .select('*')
      .limit(100);

    if (!missingError && missingData.length > 0) {
      const record = missingData[0];
      const fields = Object.keys(record);
      const nullFields = fields.filter(field => record[field] === null);
      
      console.log(`   Total fields per record: ${fields.length}`);
      console.log(`   Null fields in sample record: ${nullFields.length}`);
      if (nullFields.length > 0 && nullFields.length < 20) {
        console.log(`   Sample null fields: ${nullFields.slice(0, 10).join(', ')}`);
      }
    }

    // Check 6: Data integrity issues
    console.log('\n🚨 Step 6: Data Integrity Issues');
    
    // Check for obvious data type issues
    const { data: integrityData, error: integrityError } = await supabase
      .from('shedsuite_orders')
      .select('id, customer_name, total_amount_dollar_amount, date_ordered')
      .limit(1000);

    if (!integrityError && integrityData.length > 0) {
      const issues = [];
      
      integrityData.forEach(record => {
        if (!record.id) issues.push('Missing ID');
        if (!record.customer_name || record.customer_name.trim() === '') issues.push('Missing customer name');
        if (record.total_amount_dollar_amount !== null && isNaN(record.total_amount_dollar_amount)) {
          issues.push('Invalid total amount');
        }
      });

      const uniqueIssues = [...new Set(issues)];
      if (uniqueIssues.length > 0) {
        console.log('   Data integrity issues found:');
        uniqueIssues.forEach(issue => console.log(`     - ${issue}`));
      } else {
        console.log('   ✅ No obvious data integrity issues found in sample');
      }
    }

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
  }

  console.log('\n🏁 Data validation completed.');
  console.log('\n📋 RECOMMENDATIONS:');
  console.log('   1. Stop all sync processes immediately');
  console.log('   2. Backup current database state');
  console.log('   3. Run duplicate cleanup script');
  console.log('   4. Implement fixed sync logic');
  console.log('   5. Perform controlled full resync');
}

// Run the validation
runDataValidation().catch(console.error);