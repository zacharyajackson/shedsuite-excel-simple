#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
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

async function setupDatabase() {
  log('🗄️  ShedSuite Supabase Database Setup', 'bright');
  log('=' .repeat(60), 'cyan');
  
  // Check if .env file exists
  if (!fs.existsSync('.env')) {
    logError('.env file not found. Please create it from env.example first.');
    process.exit(1);
  }
  
  // Check required environment variables
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missingVars = [];
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    }
  }
  
  if (missingVars.length > 0) {
    logError(`Missing required environment variables: ${missingVars.join(', ')}`);
    logInfo('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
  
  logSuccess('Environment variables are configured correctly');
  
  // Read the migration file
  const migrationPath = path.join(__dirname, 'migrations', '003_complete_fields_schema.sql');
  if (!fs.existsSync(migrationPath)) {
    logError('Migration file not found: migrations/003_complete_fields_schema.sql');
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  logInfo('Migration SQL file loaded successfully');
  
  // Display the SQL that needs to be run
  log('\n📋 Database Setup Instructions:', 'bright');
  log('To set up the database tables in Supabase, follow these steps:');
  log('');
  log('1. Go to your Supabase project dashboard');
  log('2. Navigate to the SQL Editor');
  log('3. Copy and paste the following SQL:');
  log('');
  log('=' .repeat(60), 'cyan');
  log(migrationSQL, 'cyan');
  log('=' .repeat(60), 'cyan');
  log('');
  
  // Also save to a file for easy copying
  const outputFile = 'database-setup.sql';
  fs.writeFileSync(outputFile, migrationSQL);
  logSuccess(`SQL saved to ${outputFile} for easy copying`);
  
  log('\n💡 Alternative Setup Methods:', 'bright');
  log('');
  log('Option 1: Use Supabase CLI (if installed)');
  log('  supabase db push');
  log('');
  log('Option 2: Use the Supabase Dashboard');
  log('  1. Go to https://supabase.com/dashboard');
  log('  2. Select your project');
  log('  3. Go to SQL Editor');
  log('  4. Paste the SQL and run it');
  log('');
  log('Option 3: Use the provided SQL file');
  log(`  Copy the contents of ${outputFile} and run in Supabase SQL Editor`);
  
  log('\n🔍 After running the SQL, you can verify the setup by:');
  log('1. Going to your Supabase project dashboard');
  log('2. Navigating to Table Editor');
  log('3. You should see these tables:');
  log('   - shedsuite_orders (complete table with ALL API fields)');
  log('   - sync_metadata (tracks sync operations)');
  log('4. And these views:');
  log('   - recent_orders');
  log('   - order_summary');
  log('   - customer_summary');
  log('   - dealer_summary');
  log('   - building_summary');
  log('   - state_summary');
  
  log('\n🚀 Once the database is set up, you can test the sync service:');
  log('  node test-service.js');
  
  log('\n' + '=' .repeat(60), 'cyan');
  logSuccess('Database setup instructions completed!');
}

// Run the setup
setupDatabase().catch(error => {
  logError(`Setup failed: ${error.message}`);
  process.exit(1);
}); 