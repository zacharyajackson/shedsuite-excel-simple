require('dotenv').config();

// Set a reasonable limit for testing
process.env.MAX_RECORDS = '50';

const shedsuite = require('./src/services/shedsuite');

async function testFetch() {
  console.log('🧪 Testing ShedSuite fetch process...');
  
  try {
    console.log('🔌 Testing connection...');
    const recordCount = await shedsuite.getTotalRecordCount();
    console.log(`✅ Connection successful - ${recordCount} records available`);
    
    console.log('🔄 Starting fetch test...');
    const startTime = Date.now();
    
    // Test with a small limit to see what happens
    const records = await shedsuite.fetchAllRecords({ pageSize: 10 });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Fetch test completed: ${records.length} records in ${duration}ms`);
    
    if (records.length > 0) {
      console.log('📋 Sample record:', JSON.stringify(records[0], null, 2));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testFetch(); 