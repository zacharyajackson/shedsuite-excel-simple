#!/usr/bin/env node

// Test script to verify logging is working
require('dotenv').config();

const { logger, syncLogger } = require('./src/utils/logger');

console.log('🧪 Testing logging functionality...');

// Test basic logging
logger.info('Test info message', { test: true, timestamp: new Date().toISOString() });
logger.warn('Test warning message', { test: true, timestamp: new Date().toISOString() });
logger.error('Test error message', { test: true, timestamp: new Date().toISOString() });

// Test sync logging
syncLogger.info('Test sync info message', { test: true, timestamp: new Date().toISOString() });
syncLogger.warn('Test sync warning message', { test: true, timestamp: new Date().toISOString() });
syncLogger.error('Test sync error message', { test: true, timestamp: new Date().toISOString() });

// Test console output
console.log('✅ Console logging test completed');
console.log('📝 Check if you can see the log messages above');
console.log('🔍 In production, these should appear in Railway logs');

// Test environment
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('📊 Log level:', process.env.LOG_LEVEL || 'info');