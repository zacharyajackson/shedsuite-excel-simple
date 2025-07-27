#!/usr/bin/env node
// Test script to try different pagination approaches
require('dotenv').config();

const https = require('https');
const { URL } = require('url');

async function testShedSuiteCursor() {
  try {
    console.log('🧪 Testing ShedSuite API with different pagination approaches...');
    
    const baseUrl = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
    const apiPath = process.env.SHEDSUITE_API_PATH || 'api/public';
    const endpoint = process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1';
    const authToken = process.env.SHEDSUITE_API_TOKEN;
    
    if (!authToken) {
      console.error('❌ SHEDSUITE_API_TOKEN is required');
      return;
    }
    
    // Test different sorting to see if we get different records
    console.log('🔍 Testing different sorting approaches...');
    const sortOptions = [
      { sort_by: 'id', sort_order: 'asc' },
      { sort_by: 'id', sort_order: 'desc' },
      { sort_by: 'date_ordered', sort_order: 'asc' },
      { sort_by: 'date_ordered', sort_order: 'desc' },
      { sort_by: 'created_at', sort_order: 'asc' },
      { sort_by: 'created_at', sort_order: 'desc' },
      { sort_by: 'updated_at', sort_order: 'asc' },
      { sort_by: 'updated_at', sort_order: 'desc' }
    ];
    
    for (const sort of sortOptions) {
      console.log(`\n   Testing sort: ${sort.sort_by} ${sort.sort_order}`);
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?page=1&per_page=100&sort_by=${sort.sort_by}&sort_order=${sort.sort_order}`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - First ID: ${data[0].id}`);
            console.log(`   - Last ID: ${data[data.length - 1].id}`);
            console.log(`   - First date: ${data[0].dateOrdered || data[0].created_at || 'N/A'}`);
            console.log(`   - Last date: ${data[data.length - 1].dateOrdered || data[data.length - 1].created_at || 'N/A'}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test cursor-based pagination (if supported)
    console.log('\n🔍 Testing cursor-based pagination...');
    const cursorParams = [
      'cursor',
      'after',
      'before',
      'offset',
      'since_id',
      'max_id'
    ];
    
    for (const cursorParam of cursorParams) {
      console.log(`\n   Testing cursor parameter: ${cursorParam}`);
      
      // Test with the first record ID as cursor
      const url = `${baseUrl}/${apiPath}/${endpoint}?${cursorParam}=412654&per_page=100`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - First ID: ${data[0].id}`);
            console.log(`   - Last ID: ${data[data.length - 1].id}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test with different date ranges to see if we get more records
    console.log('\n🔍 Testing with different date ranges...');
    const dateRanges = [
      { start_date: '2020-01-01', end_date: '2025-12-31' },
      { start_date: '2024-01-01', end_date: '2025-12-31' },
      { start_date: '2025-01-01', end_date: '2025-12-31' },
      { start_date: '2025-07-01', end_date: '2025-12-31' },
      { start_date: '2025-07-27', end_date: '2025-12-31' }
    ];
    
    for (const dateRange of dateRanges) {
      console.log(`\n   Testing date range: ${dateRange.start_date} to ${dateRange.end_date}`);
      
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('per_page', '100');
      params.append('sort_by', 'id');
      params.append('sort_order', 'asc');
      Object.entries(dateRange).forEach(([key, value]) => {
        params.append(key, value);
      });
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?${params.toString()}`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - First ID: ${data[0].id}`);
            console.log(`   - Last ID: ${data[data.length - 1].id}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test with different status filters
    console.log('\n🔍 Testing with different status filters...');
    const statusFilters = [
      { status: 'unprocessed' },
      { status: 'processed' },
      { status: 'delivered' },
      { status: 'cancelled' },
      { status: 'finished' }
    ];
    
    for (const statusFilter of statusFilters) {
      console.log(`\n   Testing status: ${statusFilter.status}`);
      
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('per_page', '100');
      params.append('sort_by', 'id');
      params.append('sort_order', 'asc');
      Object.entries(statusFilter).forEach(([key, value]) => {
        params.append(key, value);
      });
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?${params.toString()}`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - First ID: ${data[0].id}`);
            console.log(`   - Last ID: ${data[data.length - 1].id}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

function makeRequest(url, authToken) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ShedSuite-Supabase-Sync/1.0.0'
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (parseError) {
            reject(new Error(`Failed to parse JSON response: ${parseError.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

testShedSuiteCursor(); 