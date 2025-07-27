#!/usr/bin/env node
// Test script to verify the corrected ShedSuite API with proper pagination
require('dotenv').config();

const https = require('https');
const { URL } = require('url');

async function testShedSuiteCorrected() {
  try {
    console.log('🧪 Testing ShedSuite API with corrected pagination parameters...');
    
    const baseUrl = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
    const apiPath = process.env.SHEDSUITE_API_PATH || 'api/public';
    const endpoint = process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1';
    const authToken = process.env.SHEDSUITE_API_TOKEN;
    
    if (!authToken) {
      console.error('❌ SHEDSUITE_API_TOKEN is required');
      return;
    }
    
    // Test with the correct pagination parameters (limit and offset)
    console.log('🔍 Testing with correct pagination (limit/offset)...');
    
    const allRecords = [];
    let currentPage = 1;
    let hasMorePages = true;
    const pageSize = 100;
    const maxPages = 10;
    
    while (hasMorePages && currentPage <= maxPages) {
      console.log(`\n📄 Fetching page ${currentPage} with limit/offset...`);
      
      const offset = (currentPage - 1) * pageSize;
      const url = `${baseUrl}/${apiPath}/${endpoint}?limit=${pageSize}&offset=${offset}&sortBy=id&sortOrder=asc`;
      console.log('   - URL:', url.replace(authToken, '***'));
      
      try {
        const data = await makeRequest(url, authToken);
        
        if (Array.isArray(data)) {
          console.log(`   - Records on this page: ${data.length}`);
          if (data.length > 0) {
            console.log(`   - First ID on page: ${data[0].id}`);
            console.log(`   - Last ID on page: ${data[data.length - 1].id}`);
          }
          
          allRecords.push(...data);
          console.log(`   - Total records so far: ${allRecords.length}`);
          
          // Check if we should continue to next page
          if (data.length === 0) {
            console.log(`   - No records on page ${currentPage}, stopping pagination`);
            hasMorePages = false;
          } else if (data.length < pageSize) {
            console.log(`   - Fewer than ${pageSize} records on page ${currentPage}, this is the last page`);
            hasMorePages = false;
          } else {
            console.log(`   - Full page of records, continuing to next page`);
            currentPage++;
          }
        } else if (data && typeof data === 'object') {
          console.log(`   - Response is object, keys: ${Object.keys(data)}`);
          if (data.total !== undefined) {
            console.log(`   - Total records available: ${data.total}`);
          }
          if (data.data && Array.isArray(data.data)) {
            console.log(`   - Records in data array: ${data.data.length}`);
            allRecords.push(...data.data);
          }
          hasMorePages = false;
        }
        
        // Add delay between requests
        if (hasMorePages) {
          console.log('   - Waiting 100ms before next request...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(`   - Error fetching page ${currentPage}:`, error.message);
        hasMorePages = false;
      }
    }
    
    console.log(`\n📊 Corrected Pagination Test Results:`);
    console.log(`   - Total pages fetched: ${currentPage - 1}`);
    console.log(`   - Total records collected: ${allRecords.length}`);
    
    if (allRecords.length > 0) {
      console.log(`   - Record ID range: ${allRecords[0].id} to ${allRecords[allRecords.length - 1].id}`);
      
      // Check for duplicates
      const uniqueIds = new Set(allRecords.map(r => r.id));
      console.log(`   - Unique records: ${uniqueIds.size}`);
      if (uniqueIds.size !== allRecords.length) {
        console.log(`   - ⚠️  Duplicate records detected!`);
      } else {
        console.log(`   - ✅ No duplicates detected!`);
      }
    }
    
    // Compare with old pagination method
    console.log(`\n🔍 Comparing with old pagination method (page/per_page)...`);
    const oldUrl = `${baseUrl}/${apiPath}/${endpoint}?page=1&per_page=${pageSize}&sort_by=id&sort_order=asc`;
    console.log('   - Old URL:', oldUrl.replace(authToken, '***'));
    
    try {
      const oldData = await makeRequest(oldUrl, authToken);
      if (Array.isArray(oldData)) {
        console.log(`   - Old method records: ${oldData.length}`);
        if (oldData.length > 0) {
          console.log(`   - Old method first ID: ${oldData[0].id}`);
          console.log(`   - Old method last ID: ${oldData[oldData.length - 1].id}`);
        }
      }
    } catch (error) {
      console.log(`   - Old method error: ${error.message}`);
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

testShedSuiteCorrected(); 