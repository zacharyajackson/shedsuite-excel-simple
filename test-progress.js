require('dotenv').config();

// Set a small limit for testing progress
process.env.INITIAL_SYNC_LIMIT = '1000';

const shedsuite = require('./src/services/shedsuite');

async function testProgress() {
  console.log('🧪 Testing ShedSuite fetch with progress tracking...');
  
  try {
    console.log('🔌 Testing connection...');
    const recordCount = await shedsuite.getTotalRecordCount();
    console.log(`✅ Connection successful - ${recordCount} records available`);
    
    console.log('🔄 Starting fetch test with progress tracking...');
    const startTime = Date.now();
    
    // Test with a small limit to see progress
    const records = await shedsuite.fetchAllRecords({ 
      maxRecords: 1000,
      pageSize: 100
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Fetch test completed: ${records.length} records in ${duration}ms`);
    
    if (records.length > 0) {
      console.log('📋 Sample record ID:', records[0].id);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testProgress(); 