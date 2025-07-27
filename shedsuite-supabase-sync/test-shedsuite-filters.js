#!/usr/bin/env node
// Test script to try different API parameters and filters
require('dotenv').config();

const https = require('https');
const { URL } = require('url');

async function testShedSuiteFilters() {
  try {
    console.log('🧪 Testing ShedSuite API with different filters and parameters...');
    
    const baseUrl = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
    const apiPath = process.env.SHEDSUITE_API_PATH || 'api/public';
    const endpoint = process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1';
    const authToken = process.env.SHEDSUITE_API_TOKEN;
    
    if (!authToken) {
      console.error('❌ SHEDSUITE_API_TOKEN is required');
      return;
    }
    
    // Test different endpoints
    const endpoints = [
      'customer-orders/v1',
      'customer-orders',
      'orders/v1',
      'orders',
      'customers/v1',
      'customers'
    ];
    
    for (const testEndpoint of endpoints) {
      console.log(`\n🔍 Testing endpoint: ${testEndpoint}`);
      
      const url = `${baseUrl}/${apiPath}/${testEndpoint}?page=1&per_page=100`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - Sample ID: ${data[0].id}`);
          }
        } else if (data && typeof data === 'object') {
          console.log(`   - Response keys: ${Object.keys(data)}`);
          if (data.total !== undefined) {
            console.log(`   - Total: ${data.total}`);
          }
        }
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test different date ranges
    console.log(`\n🔍 Testing different date ranges...`);
    const dateRanges = [
      { start_date: '2020-01-01', end_date: '2025-12-31' },
      { start_date: '2024-01-01', end_date: '2025-12-31' },
      { start_date: '2025-01-01', end_date: '2025-12-31' },
      { created_after: '2020-01-01' },
      { updated_after: '2020-01-01' },
      { date_ordered_after: '2020-01-01' }
    ];
    
    for (const filters of dateRanges) {
      console.log(`\n   Testing filters:`, filters);
      
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('per_page', '100');
      Object.entries(filters).forEach(([key, value]) => {
        params.append(key, value);
      });
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?${params.toString()}`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
        } else if (data && typeof data === 'object') {
          console.log(`   - Response keys: ${Object.keys(data)}`);
          if (data.total !== undefined) {
            console.log(`   - Total: ${data.total}`);
          }
        }
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test different sorting
    console.log(`\n🔍 Testing different sorting...`);
    const sortOptions = [
      { sort_by: 'id', sort_order: 'desc' },
      { sort_by: 'date_ordered', sort_order: 'desc' },
      { sort_by: 'created_at', sort_order: 'desc' },
      { sort_by: 'updated_at', sort_order: 'desc' }
    ];
    
    for (const sort of sortOptions) {
      console.log(`\n   Testing sort:`, sort);
      
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('per_page', '100');
      Object.entries(sort).forEach(([key, value]) => {
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
      } catch (error) {
        console.log(`   - Error: ${error.message}`);
      }
    }
    
    // Test company-specific filters
    console.log(`\n🔍 Testing company-specific filters...`);
    const companyFilters = [
      { company_id: '23' },
      { dealer_id: '3335' },
      { status: 'unprocessed' },
      { status: 'processed' },
      { order_type: 'Off Lot' }
    ];
    
    for (const filter of companyFilters) {
      console.log(`\n   Testing filter:`, filter);
      
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('per_page', '100');
      Object.entries(filter).forEach(([key, value]) => {
        params.append(key, value);
      });
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?${params.toString()}`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        if (Array.isArray(data)) {
          console.log(`   - Records: ${data.length}`);
        } else if (data && typeof data === 'object') {
          console.log(`   - Response keys: ${Object.keys(data)}`);
          if (data.total !== undefined) {
            console.log(`   - Total: ${data.total}`);
          }
        }
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

testShedSuiteFilters(); 