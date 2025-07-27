#!/usr/bin/env node
// Test script to explicitly test pagination
require('dotenv').config();

const https = require('https');
const { URL } = require('url');

async function testShedSuitePagination() {
  try {
    console.log('🧪 Testing ShedSuite API pagination explicitly...');
    
    const baseUrl = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
    const apiPath = process.env.SHEDSUITE_API_PATH || 'api/public';
    const endpoint = process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1';
    const authToken = process.env.SHEDSUITE_API_TOKEN;
    
    if (!authToken) {
      console.error('❌ SHEDSUITE_API_TOKEN is required');
      return;
    }
    
    // Test multiple pages explicitly
    console.log('🔍 Testing multiple pages explicitly...');
    
    const allRecords = [];
    let currentPage = 1;
    let hasMorePages = true;
    const maxPages = 10; // Test up to 10 pages
    
    while (hasMorePages && currentPage <= maxPages) {
      console.log(`\n📄 Fetching page ${currentPage}...`);
      
      const url = `${baseUrl}/${apiPath}/${endpoint}?page=${currentPage}&per_page=100&sort_by=id&sort_order=asc`;
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
          } else if (data.length < 100) {
            console.log(`   - Fewer than 100 records on page ${currentPage}, this might be the last page`);
            // Continue to next page to be sure
            currentPage++;
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
          hasMorePages = false; // Object response usually means no pagination
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
    
    console.log(`\n📊 Pagination Test Results:`);
    console.log(`   - Total pages fetched: ${currentPage - 1}`);
    console.log(`   - Total records collected: ${allRecords.length}`);
    
    if (allRecords.length > 0) {
      console.log(`   - Record ID range: ${allRecords[0].id} to ${allRecords[allRecords.length - 1].id}`);
      
      // Check for duplicates
      const uniqueIds = new Set(allRecords.map(r => r.id));
      console.log(`   - Unique records: ${uniqueIds.size}`);
      if (uniqueIds.size !== allRecords.length) {
        console.log(`   - ⚠️  Duplicate records detected!`);
      }
    }
    
    // Test with different page sizes
    console.log(`\n🔍 Testing with different page sizes...`);
    const testPageSizes = [10, 25, 50, 100];
    
    for (const pageSize of testPageSizes) {
      console.log(`\n   Testing page size: ${pageSize}`);
      
      const testRecords = [];
      let testPage = 1;
      let testHasMore = true;
      
      while (testHasMore && testPage <= 3) { // Test up to 3 pages
        const testUrl = `${baseUrl}/${apiPath}/${endpoint}?page=${testPage}&per_page=${pageSize}&sort_by=id&sort_order=asc`;
        
        try {
          const testData = await makeRequest(testUrl, authToken);
          
          if (Array.isArray(testData)) {
            console.log(`     - Page ${testPage}: ${testData.length} records`);
            testRecords.push(...testData);
            
            if (testData.length === 0 || testData.length < pageSize) {
              testHasMore = false;
            } else {
              testPage++;
            }
          } else {
            testHasMore = false;
          }
          
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          console.log(`     - Error: ${error.message}`);
          testHasMore = false;
        }
      }
      
      console.log(`     - Total records with page size ${pageSize}: ${testRecords.length}`);
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

testShedSuitePagination(); 