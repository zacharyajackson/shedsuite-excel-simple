require('dotenv').config();

// Disable initial sync for testing
process.env.SKIP_INITIAL_SYNC = 'true';

console.log('🧪 Starting application with initial sync disabled...');
console.log('📊 This will start the server without the long initial sync process');
console.log('🔗 You can then test individual endpoints manually');

const { app, server } = require('./src/index.js');

// The server will start without the initial sync
console.log('✅ Application started without initial sync');
console.log('🌐 Server should be running on port 3000');
console.log('📋 You can test endpoints like:');
console.log('   - GET http://localhost:3000/health');
console.log('   - GET http://localhost:3000/ready');
console.log('   - POST http://localhost:3000/api/export (for manual exports)'); 