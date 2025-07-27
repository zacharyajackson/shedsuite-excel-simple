#!/usr/bin/env node
// Debug script to test ShedSuite API raw response
require('dotenv').config();

const https = require('https');
const { URL } = require('url');

async function testShedSuiteAPI() {
  try {
    console.log('🧪 Testing ShedSuite API raw response...');
    
    // Configuration
    const baseUrl = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
    const apiPath = process.env.SHEDSUITE_API_PATH || 'api/public';
    const endpoint = process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1';
    const authToken = process.env.SHEDSUITE_API_TOKEN;
    const pageSize = process.env.SHEDSUITE_PAGE_SIZE || 100;
    
    console.log('📋 Configuration:');
    console.log('   - Base URL:', baseUrl);
    console.log('   - API Path:', apiPath);
    console.log('   - Endpoint:', endpoint);
    console.log('   - Page Size:', pageSize);
    console.log('   - Auth Token:', authToken ? `${authToken.substring(0, 20)}...` : 'NOT SET');
    
    if (!authToken) {
      console.error('❌ SHEDSUITE_API_TOKEN is required');
      return;
    }
    
    // Test different page sizes
    const testPageSizes = [10, 50, 100, 500, 1000];
    
    for (const testPageSize of testPageSizes) {
      console.log(`\n🔍 Testing with page size: ${testPageSize}`);
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?page=1&per_page=${testPageSize}&sort_by=id&sort_order=asc`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        console.log(`   - Response type:`, typeof data);
        console.log(`   - Response keys:`, Object.keys(data || {}));
        
        if (Array.isArray(data)) {
          console.log(`   - Array length:`, data.length);
          if (data.length > 0) {
            console.log(`   - First record ID:`, data[0].id);
            console.log(`   - Last record ID:`, data[data.length - 1].id);
          }
        } else if (data && typeof data === 'object') {
          console.log(`   - Object properties:`, Object.keys(data));
          if (data.data && Array.isArray(data.data)) {
            console.log(`   - data array length:`, data.data.length);
          }
          if (data.records && Array.isArray(data.records)) {
            console.log(`   - records array length:`, data.records.length);
          }
          if (data.items && Array.isArray(data.items)) {
            console.log(`   - items array length:`, data.items.length);
          }
          if (data.total !== undefined) {
            console.log(`   - total:`, data.total);
          }
          if (data.count !== undefined) {
            console.log(`   - count:`, data.count);
          }
        }
        
        // Show sample of raw response
        console.log(`   - Raw response sample:`, JSON.stringify(data).substring(0, 500) + '...');
        
      } catch (error) {
        console.error(`   - Error:`, error.message);
      }
    }
    
    // Test without pagination parameters
    console.log(`\n🔍 Testing without pagination parameters...`);
    const urlNoPagination = `${baseUrl}/${apiPath}/${endpoint}`;
    console.log('   - URL:', urlNoPagination.replace(authToken, '***'));
    
    try {
      const data = await makeRequest(urlNoPagination, authToken);
      console.log(`   - Response type:`, typeof data);
      console.log(`   - Response keys:`, Object.keys(data || {}));
      
      if (Array.isArray(data)) {
        console.log(`   - Array length:`, data.length);
      } else if (data && typeof data === 'object') {
        console.log(`   - Object properties:`, Object.keys(data));
        if (data.total !== undefined) {
          console.log(`   - total:`, data.total);
        }
      }
      
    } catch (error) {
      console.error(`   - Error:`, error.message);
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

testShedSuiteAPI(); 