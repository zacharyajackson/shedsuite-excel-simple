#!/usr/bin/env node

/**
 * Railway Log Export Script
 * Exports complete deployment logs from Railway using their API
 */

const fs = require('fs');
const path = require('path');

async function exportRailwayLogs() {
  console.log('🚂 Railway Log Export Tool');
  console.log('========================');
  
  // Railway project details from status
  const projectId = 'b975e338-5238-48b3-b21c-3b3c701a3249';
  const serviceId = '11de0dea-0e1a-4934-827c-083de48373c9';
  const deploymentId = '51ae16bb-8030-4344-8d52-1b86401c4380';
  const environmentId = 'b2efaef8-e364-401f-807f-ecc914929bf9';
  
  console.log('📋 Project Info:');
  console.log(`   Project ID: ${projectId}`);
  console.log(`   Service ID: ${serviceId}`);
  console.log(`   Deployment ID: ${deploymentId}`);
  console.log(`   Environment: production`);
  
  // Instructions for manual export
  console.log('\n🔧 Manual Export Methods:');
  console.log('\n1. Railway Dashboard Method:');
  console.log('   • Go to: https://railway.app/project/' + projectId);
  console.log('   • Navigate to: Deployments → Latest Deployment');
  console.log('   • Click on "View Logs" and scroll to load all logs');
  console.log('   • Use browser dev tools to export logs');
  
  console.log('\n2. Railway CLI Batch Export:');
  console.log('   railway logs --deployment --json | head -10000 > logs/batch1.json');
  console.log('   railway logs --deployment --json | tail -10000 > logs/batch2.json');
  
  console.log('\n3. Alternative: Use Railway REST API (requires token):');
  console.log('   curl -H "Authorization: Bearer YOUR_TOKEN" \\');
  console.log('   "https://backboard.railway.app/graphql" \\');
  console.log('   -d \'{"query":"query { deploymentLogs(deploymentId: \\"' + deploymentId + '\\") { ... } }"}\' \\');
  console.log('   > logs/railway-api-logs.json');
  
  // Create a comprehensive log summary from existing files
  console.log('\n📁 Combining Existing Log Files...');
  
  const logsDir = path.join(process.cwd(), 'logs');
  const logFiles = fs.readdirSync(logsDir).filter(file => 
    file.includes('railway') && file.endsWith('.json')
  );
  
  console.log(`Found ${logFiles.length} Railway log files:`);
  logFiles.forEach(file => {
    const stats = fs.statSync(path.join(logsDir, file));
    console.log(`   • ${file} (${(stats.size / 1024).toFixed(1)}KB)`);
  });
  
  // Combine all Railway JSON logs
  const combinedLogs = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  for (const file of logFiles) {
    try {
      const filePath = path.join(logsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Parse each line as JSON
      const lines = content.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line);
          combinedLogs.push(logEntry);
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Error reading ${file}: ${error.message}`);
    }
  }
  
  // Sort by timestamp
  combinedLogs.sort((a, b) => {
    const timeA = new Date(a.timestamp || 0);
    const timeB = new Date(b.timestamp || 0);
    return timeA - timeB;
  });
  
  // Export combined logs
  const outputFile = path.join(logsDir, `railway-combined-logs-${timestamp}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(combinedLogs, null, 2));
  
  console.log(`\n✅ Combined ${combinedLogs.length} log entries`);
  console.log(`📄 Exported to: ${outputFile}`);
  
  // Generate log summary
  const summary = {
    exportTimestamp: new Date().toISOString(),
    totalLogEntries: combinedLogs.length,
    timeRange: {
      start: combinedLogs[0]?.timestamp || 'Unknown',
      end: combinedLogs[combinedLogs.length - 1]?.timestamp || 'Unknown'
    },
    logLevels: {},
    sourceFiles: logFiles,
    projectInfo: {
      projectId,
      serviceId,
      deploymentId,
      environmentId
    }
  };
  
  // Count log levels
  combinedLogs.forEach(log => {
    const level = log.level || 'unknown';
    summary.logLevels[level] = (summary.logLevels[level] || 0) + 1;
  });
  
  const summaryFile = path.join(logsDir, `railway-log-summary-${timestamp}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  
  console.log(`📊 Summary saved to: ${summaryFile}`);
  console.log('\n📈 Log Statistics:');
  console.log(`   Time Range: ${summary.timeRange.start} to ${summary.timeRange.end}`);
  Object.entries(summary.logLevels).forEach(([level, count]) => {
    console.log(`   ${level}: ${count} entries`);
  });
  
  return {
    combinedFile: outputFile,
    summaryFile: summaryFile,
    totalEntries: combinedLogs.length
  };
}

// Run the export
if (require.main === module) {
  exportRailwayLogs()
    .then(result => {
      console.log('\n🎉 Log export completed successfully!');
      console.log(`📁 Combined logs: ${result.combinedFile}`);
      console.log(`📊 Summary: ${result.summaryFile}`);
      console.log(`📈 Total entries: ${result.totalEntries}`);
    })
    .catch(error => {
      console.error('❌ Export failed:', error.message);
      process.exit(1);
    });
}

module.exports = { exportRailwayLogs }; 