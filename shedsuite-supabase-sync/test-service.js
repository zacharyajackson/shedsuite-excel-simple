#!/usr/bin/env node

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 30000; // 30 seconds

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Test functions
async function testHealthEndpoint() {
  try {
    logInfo('Testing health endpoint...');
    const response = await axios.get(`${BASE_URL}/health`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Health endpoint is working');
      log(`   Status: ${response.data.status}`);
      log(`   Uptime: ${response.data.uptime}s`);
      log(`   Environment: ${response.data.environment}`);
      return true;
    } else {
      logError(`Health endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Health endpoint test failed: ${error.message}`);
    return false;
  }
}

async function testDetailedHealthEndpoint() {
  try {
    logInfo('Testing detailed health endpoint...');
    const response = await axios.get(`${BASE_URL}/api/health/detailed`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Detailed health endpoint is working');
      log(`   Overall Status: ${response.data.status}`);
      log(`   Response Time: ${response.data.responseTime}ms`);
      
      if (response.data.services) {
        log('   Services:');
        Object.entries(response.data.services).forEach(([service, status]) => {
          const statusColor = status.status === 'healthy' ? 'green' : 'red';
          log(`     ${service}: ${status.status}`, statusColor);
        });
      }
      return true;
    } else {
      logError(`Detailed health endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Detailed health endpoint test failed: ${error.message}`);
    return false;
  }
}

async function testSyncStatusEndpoint() {
  try {
    logInfo('Testing sync status endpoint...');
    const response = await axios.get(`${BASE_URL}/api/sync/status`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Sync status endpoint is working');
      if (response.data.success && response.data.data) {
        const status = response.data.data;
        log(`   Is Running: ${status.isRunning}`);
        log(`   Last Sync Time: ${status.lastSyncTime || 'Never'}`);
        log(`   Scheduled Sync Enabled: ${status.config?.scheduledSyncEnabled || 'Unknown'}`);
      }
      return true;
    } else {
      logError(`Sync status endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Sync status endpoint test failed: ${error.message}`);
    return false;
  }
}

async function testSyncConfigEndpoint() {
  try {
    logInfo('Testing sync config endpoint...');
    const response = await axios.get(`${BASE_URL}/api/sync/config`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Sync config endpoint is working');
      if (response.data.success && response.data.data) {
        const config = response.data.data;
        log(`   Sync Interval: ${config.syncInterval} minutes`);
        log(`   Batch Size: ${config.batchSize}`);
        log(`   Max Retries: ${config.maxRetries}`);
        log(`   Scheduled Sync Enabled: ${config.scheduledSyncEnabled}`);
      }
      return true;
    } else {
      logError(`Sync config endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Sync config endpoint test failed: ${error.message}`);
    return false;
  }
}

async function testConnectionsEndpoint() {
  try {
    logInfo('Testing connections endpoint...');
    const response = await axios.get(`${BASE_URL}/api/sync/test-connections`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Connections test endpoint is working');
      log(`   Message: ${response.data.message}`);
      return true;
    } else {
      logError(`Connections test endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Connections test endpoint failed: ${error.message}`);
    return false;
  }
}

async function testManualSyncTrigger() {
  try {
    logInfo('Testing manual sync trigger (this will start a sync operation)...');
    const response = await axios.post(`${BASE_URL}/api/sync/trigger`, {
      fullSync: false,
      filters: {}
    }, { 
      timeout: TEST_TIMEOUT,
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.status === 200) {
      logSuccess('Manual sync trigger endpoint is working');
      log(`   Message: ${response.data.message}`);
      return true;
    } else {
      logError(`Manual sync trigger endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Manual sync trigger test failed: ${error.message}`);
    return false;
  }
}

async function testMetricsEndpoint() {
  try {
    logInfo('Testing metrics endpoint...');
    const response = await axios.get(`${BASE_URL}/api/health/metrics`, { timeout: TEST_TIMEOUT });
    
    if (response.status === 200) {
      logSuccess('Metrics endpoint is working');
      log(`   Uptime: ${response.data.uptime_seconds}s`);
      log(`   Memory Heap Used: ${Math.round(response.data.memory_heap_used_bytes / 1024 / 1024)}MB`);
      log(`   Sync Total Count: ${response.data.sync_total_count || 0}`);
      return true;
    } else {
      logError(`Metrics endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Metrics endpoint test failed: ${error.message}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  log('🚀 Starting ShedSuite Supabase Sync Service Tests', 'bright');
  log('=' .repeat(60), 'cyan');
  
  const tests = [
    { name: 'Health Endpoint', fn: testHealthEndpoint },
    { name: 'Detailed Health Endpoint', fn: testDetailedHealthEndpoint },
    { name: 'Sync Status Endpoint', fn: testSyncStatusEndpoint },
    { name: 'Sync Config Endpoint', fn: testSyncConfigEndpoint },
    { name: 'Connections Test Endpoint', fn: testConnectionsEndpoint },
    { name: 'Metrics Endpoint', fn: testMetricsEndpoint },
    { name: 'Manual Sync Trigger', fn: testManualSyncTrigger }
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  for (const test of tests) {
    log(`\n📋 Running: ${test.name}`, 'bright');
    try {
      const result = await test.fn();
      if (result) {
        passedTests++;
      }
    } catch (error) {
      logError(`Test ${test.name} threw an error: ${error.message}`);
    }
  }
  
  log('\n' + '=' .repeat(60), 'cyan');
  log('📊 Test Results Summary', 'bright');
  log(`   Passed: ${passedTests}/${totalTests}`, passedTests === totalTests ? 'green' : 'yellow');
  
  if (passedTests === totalTests) {
    logSuccess('All tests passed! The service is working correctly.');
  } else {
    logWarning(`${totalTests - passedTests} test(s) failed. Check the configuration and try again.`);
  }
  
  log('\n💡 Next Steps:', 'bright');
  log('   1. Check the .env file configuration');
  log('   2. Verify ShedSuite API credentials');
  log('   3. Verify Supabase connection settings');
  log('   4. Check the logs in the logs/ directory');
}

// Check if service is running
async function checkServiceStatus() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  log('🔍 Checking if service is running...', 'bright');
  
  const isRunning = await checkServiceStatus();
  if (!isRunning) {
    logError('Service is not running on http://localhost:3000');
    logInfo('Please start the service first:');
    log('   npm start');
    log('   or');
    log('   npm run dev');
    process.exit(1);
  }
  
  logSuccess('Service is running! Starting tests...\n');
  await runTests();
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  log('ShedSuite Supabase Sync Service Test Script', 'bright');
  log('');
  log('Usage: node test-service.js [options]', 'cyan');
  log('');
  log('Options:');
  log('  --help, -h     Show this help message');
  log('  --url <url>    Test against a different URL (default: http://localhost:3001)');
  log('');
  log('Make sure the service is running before executing this script.');
  process.exit(0);
}

// Check for custom URL
const urlIndex = process.argv.indexOf('--url');
if (urlIndex !== -1 && process.argv[urlIndex + 1]) {
  BASE_URL = process.argv[urlIndex + 1];
  log(`Using custom URL: ${BASE_URL}`, 'yellow');
}

// Run the tests
main().catch(error => {
  logError(`Test script failed: ${error.message}`);
  process.exit(1);
}); 