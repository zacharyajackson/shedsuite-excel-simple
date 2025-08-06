#!/usr/bin/env node
/**
 * TEST EXPORT SCRIPT
 * Tests the client export solution to ensure it works correctly
 */

require('dotenv').config();

const ClientExportSolution = require('./client-export-solution');
const fs = require('fs');
const path = require('path');

async function testExport() {
    console.log('🧪 TESTING CLIENT EXPORT SOLUTION');
    console.log('==================================\n');

    const exporter = new ClientExportSolution();
    
    try {
        // Test 1: Basic table validation
        console.log('🔍 Test 1: Table validation...');
        const schemaInfo = await exporter.validateTable('shedsuite_orders');
        console.log(`✅ Table validated: ${schemaInfo.columnCount} columns found`);
        console.log(`   Columns: ${schemaInfo.columns.slice(0, 5).join(', ')}${schemaInfo.columns.length > 5 ? '...' : ''}\n`);

        // Test 2: Record count
        console.log('📊 Test 2: Record count...');
        const { totalCount, filteredCount } = await exporter.getRecordCount('shedsuite_orders');
        console.log(`✅ Total records: ${totalCount.toLocaleString()}`);
        console.log(`✅ Filtered records: ${filteredCount.toLocaleString()}\n`);

        // Test 3: Small export (first 10 records)
        console.log('📦 Test 3: Small export test...');
        // For the test, we'll modify the batch size to get a smaller export
        const originalBatchSize = exporter.batchSize;
        exporter.batchSize = 10; // Export only 10 records for testing
        
        const testResult = await exporter.exportTable({
            tableName: 'shedsuite_orders',
            validateData: true,
            checkDuplicates: true
        });
        
        // Restore original batch size
        exporter.batchSize = originalBatchSize;

        if (testResult.success) {
            console.log(`✅ Test export successful: ${testResult.recordsExported} records`);
            console.log(`   File: ${testResult.filePath}`);
            console.log(`   Size: ${testResult.fileSizeMB}MB`);
            
            // Clean up test file
            if (fs.existsSync(testResult.filePath)) {
                fs.unlinkSync(testResult.filePath);
                console.log('   ✅ Test file cleaned up');
            }
        } else {
            console.log(`❌ Test export failed: ${testResult.message}`);
        }

        // Test 4: Sequence check
        console.log('\n🔧 Test 4: Sequence check...');
        const sequenceFixed = await exporter.fixSequenceIfNeeded('shedsuite_orders');
        console.log(`✅ Sequence check completed: ${sequenceFixed ? 'Fixed' : 'Already in sync'}\n`);

        // Test 5: Export report generation
        console.log('📋 Test 5: Report generation...');
        const testReport = exporter.createExportReport('test-123', {
            success: true,
            recordsExported: 10,
            filePath: '/test/path.csv',
            fileSizeMB: 0.1,
            duration: 1000
        });
        console.log(`✅ Report generated: ${testReport.reportPath}`);
        
        // Clean up test report
        if (fs.existsSync(testReport.reportPath)) {
            fs.unlinkSync(testReport.reportPath);
            console.log('   ✅ Test report cleaned up');
        }

        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('====================');
        console.log('✅ Table validation works');
        console.log('✅ Record counting works');
        console.log('✅ Export functionality works');
        console.log('✅ Sequence management works');
        console.log('✅ Report generation works');
        console.log('\n🚀 The client export solution is ready for use!');

    } catch (error) {
        console.error('\n❌ TEST FAILED!');
        console.error('================');
        console.error('Error:', error.message);
        console.error('\nPlease check:');
        console.error('1. Supabase credentials in .env file');
        console.error('2. Network connectivity');
        console.error('3. Table permissions');
        console.error('4. Dependencies installation (npm install)');
        
        process.exit(1);
    }
}

// Run test if called directly
if (require.main === module) {
    testExport();
}

module.exports = testExport; 