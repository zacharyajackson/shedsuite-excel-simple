#!/usr/bin/env node

/**
 * Simple health check test script
 * Run with: node test-health.js
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

function testHealthCheck() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: '/health',
      method: 'GET',
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const healthData = JSON.parse(data);
          console.log('Health Check Response:');
          console.log('Status Code:', res.statusCode);
          console.log('Response:', JSON.stringify(healthData, null, 2));
          
          if (res.statusCode === 200) {
            console.log('✅ Health check passed!');
            resolve(healthData);
          } else if (res.statusCode === 503 && healthData.status === 'degraded') {
            console.log('✅ Health check passed (degraded - expected when external services not configured)!');
            resolve(healthData);
          } else {
            console.log('❌ Health check failed with status:', res.statusCode);
            reject(new Error(`Health check failed with status ${res.statusCode}`));
          }
        } catch (error) {
          console.log('❌ Failed to parse health check response:', error.message);
          console.log('Raw response:', data);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.log('❌ Health check request failed:', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      console.log('❌ Health check request timed out');
      req.destroy();
      reject(new Error('Health check request timed out'));
    });

    req.end();
  });
}

function testReadiness() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: '/ready',
      method: 'GET',
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const readyData = JSON.parse(data);
          console.log('\nReadiness Check Response:');
          console.log('Status Code:', res.statusCode);
          console.log('Response:', JSON.stringify(readyData, null, 2));
          
          if (res.statusCode === 200) {
            console.log('✅ Readiness check passed!');
            resolve(readyData);
          } else {
            console.log('❌ Readiness check failed with status:', res.statusCode);
            reject(new Error(`Readiness check failed with status ${res.statusCode}`));
          }
        } catch (error) {
          console.log('❌ Failed to parse readiness check response:', error.message);
          console.log('Raw response:', data);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.log('❌ Readiness check request failed:', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      console.log('❌ Readiness check request timed out');
      req.destroy();
      reject(new Error('Readiness check request timed out'));
    });

    req.end();
  });
}

async function runTests() {
  console.log(`Testing health endpoints on ${HOST}:${PORT}...\n`);
  
  try {
    await testHealthCheck();
    await testReadiness();
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } catch (error) {
    console.log('\n💥 Tests failed:', error.message);
    process.exit(1);
  }
}

// Run tests
runTests(); 