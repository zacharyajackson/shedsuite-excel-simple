/**
 * Update spreadsheet with comprehensive progress monitoring and reporting
 * 
 * This module provides an implementation of the Excel spreadsheet update
 * process with detailed progress monitoring, ETA calculations, and
 * comprehensive reporting. It also includes recovery and rollback mechanisms
 * for handling failures and interrupted operations.
 */

const path = require('path');
const { logger } = require('./logger');
const { ProgressMonitor } = require('./progress-monitor');
const { RecoveryManager } = require('./recovery-manager');
require('./recovery-manager-part2'); // Load part 2 methods

/**
 * Update spreadsheet with comprehensive progress monitoring and reporting
 * @param {Object} excelService - Instance of ExcelService
 * @param {Array} records - Records to update
 * @param {Object} options - Options for the operation
 * @returns {Promise<Object>} - Operation result with detailed metrics
 */
async function updateSpreadsheetWithMonitoring(excelService, records, options = {}) {
  const operationId = options.operationId || `excel_update_${Date.now()}`;
  const resumeOperation = options.resumeOperation || false;
  const displayDashboard = options.displayDashboard !== false;
  const stateDir = options.stateDir || path.join(process.cwd(), 'state');
  const recoveryDir = options.recoveryDir || path.join(process.cwd(), 'recovery');
  const snapshotDir = options.snapshotDir || path.join(process.cwd(), 'snapshots');
  const enableRecovery = options.enableRecovery !== false;
  
  // Initialize progress monitor
  const progressMonitor = new ProgressMonitor({
    operationId,
    operationType: 'excel_update',
    displayDashboard,
    stalledThresholdMs: parseInt(process.env.EXCEL_STALLED_THRESHOLD) || 5 * 60 * 1000, // 5 minutes
    progressUpdateIntervalMs: parseInt(process.env.EXCEL_PROGRESS_UPDATE_INTERVAL) || 3000, // 3 seconds
    stateDir,
    detailedMetrics: true,
    alertOnStalled: true
  });
  
  // Initialize recovery manager if recovery is enabled
  let recoveryManager = null;
  if (enableRecovery) {
    recoveryManager = new RecoveryManager({
      recoveryDir,
      snapshotDir,
      stateDir,
      auditLogPath: path.join(process.cwd(), 'logs', 'recovery-audit.log')
    });
    await recoveryManager.initialize();
  }
  
  logger.info('Starting Excel spreadsheet update with comprehensive monitoring:', {
    totalRecords: records.length,
    operationId,
    resumeOperation,
    worksheetName: excelService.worksheetName,
    displayDashboard
  });

  if (!records || records.length === 0) {
    logger.warn('No records to update');
    return { success: true, recordsProcessed: 0 };
  }

  try {
    // Start monitoring
    const totalRecords = records.length;
    const batchSize = excelService.getAdaptiveBatchSize(totalRecords);
    const totalBatches = Math.ceil(totalRecords / batchSize);
    
    await progressMonitor.start({
      totalRecords,
      totalBatches,
      batchSize,
      maxRetries: excelService.config.maxRetries,
      timeoutMs: excelService.apiOptimizer.getTimeoutForOperation ? 
        excelService.apiOptimizer.getTimeoutForOperation('write') : 60000,
      metadata: {
        worksheetName: excelService.worksheetName,
        workbookId: excelService.workbookId,
        workbookSizeCategory: excelService.determineWorkbookSizeCategory(totalRecords)
      }
    });
    
    // Update phase to initialization
    progressMonitor.updatePhase('initializing', 'Setting up Excel client and preparing workbook');
    
    // If resuming operation and recovery is enabled, validate state before proceeding
    if (resumeOperation && enableRecovery && recoveryManager) {
      progressMonitor.updatePhase('validating', 'Validating previous operation state before resuming');
      
      const validationResult = await recoveryManager.validateStateBeforeResume(operationId);
      
      if (!validationResult.isValid || !validationResult.canResume) {
        const error = new Error(`Cannot resume operation: ${validationResult.message}`);
        error.validationResult = validationResult;
        throw error;
      }
      
      if (validationResult.requiresIntervention) {
        progressMonitor.recordWarning({
          message: 'Operation requires manual intervention before resuming',
          category: 'state_validation',
          details: validationResult.message
        });
        
        // Generate recovery instructions
        await recoveryManager.generateRecoveryInstructions(operationId, {
          type: 'manual_intervention_required'
        });
      }
      
      // Log recovery information
      logger.info('Resuming operation from previous state', {
        operationId,
        nextBatchIndex: validationResult.state.nextBatchIndex,
        processedRecords: validationResult.state.processedRecords,
        remainingRecords: validationResult.state.remainingRecords,
        progressPercentage: validationResult.state.progressPercentage
      });
    }
    
    // Initialize client and get site ID
    await excelService.initializeClient();
    const siteId = await excelService.getSiteId();
    
    // Create snapshot before making changes if recovery is enabled
    let snapshotInfo = null;
    if (enableRecovery && recoveryManager && !resumeOperation) {
      progressMonitor.updatePhase('snapshot', 'Creating data snapshot before making changes');
      try {
        snapshotInfo = await recoveryManager.createSnapshot(excelService, operationId, {
          totalRecords,
          batchSize,
          workbookSizeCategory: excelService.determineWorkbookSizeCategory(totalRecords)
        });
        
        logger.info('Created pre-operation snapshot', {
          operationId,
          snapshotId: snapshotInfo.snapshotId,
          rowCount: snapshotInfo.rowCount
        });
      } catch (snapshotError) {
        // Log warning but continue with operation
        logger.warn('Failed to create pre-operation snapshot', {
          operationId,
          error: snapshotError.message
        });
        
        progressMonitor.recordWarning({
          message: 'Failed to create pre-operation snapshot - rollback will not be available',
          category: 'snapshot_creation',
          details: snapshotError.message
        });
      }
    }
    
    // Clear existing data if not resuming
    if (!resumeOperation) {
      progressMonitor.updatePhase('clearing', 'Clearing existing spreadsheet data');
      const clearingWorked = await excelService.clearWorksheetOptimized(siteId);
      
      if (!clearingWorked) {
        progressMonitor.recordWarning({
          message: 'Clearing failed due to workbook size - will overwrite existing data starting from row 2',
          category: 'workbook_size'
        });
      }
    }
    
    // Start from row 2 (assuming row 1 has headers)
    let currentRow = 2;
    
    // Determine workbook size category for adaptive settings
    const workbookSizeCategory = excelService.determineWorkbookSizeCategory(totalRecords);
    
    // Update phase to processing
    progressMonitor.updatePhase('processing', 'Processing data batches');
    
    // For very large datasets, use batch API
    if (totalRecords > 100000) {
      progressMonitor.updatePhase('processing', 'Processing very large dataset using batch API');
      
      try {
        const result = await updateUsingMonitoredBatchAPI(
          excelService, 
          records, 
          siteId, 
          currentRow, 
          progressMonitor
        );
        
        // Complete monitoring with success
        const summary = await progressMonitor.complete({
          batchApiUsed: true,
          successRate: result.successRate
        });
        
        return {
          success: result.success,
          operationId,
          recordsProcessed: totalRecords,
          totalRecords,
          duration: summary.performance.totalRuntimeMs,
          summary
        };
      } catch (error) {
        // Fail monitoring with error
        const summary = await progressMonitor.fail(error);
        
        throw error;
      }
    }
    
    // Process batches with monitoring
    for (let i = 0; i < totalRecords; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const batchStart = i;
      const batchEnd = Math.min(batchStart + batchSize, totalRecords);
      const batchRecords = records.slice(batchStart, batchEnd);
      const formattedRows = excelService.formatRecordsForExcel(batchRecords);
      
      const startRow = currentRow;
      const endRow = currentRow + formattedRows.length - 1;
      const range = `A${startRow}:CA${endRow}`;
      
      const batchStartTime = Date.now();
      const batchNumber = batchIndex + 1;
      
      progressMonitor.updatePhase('processing', `Processing batch ${batchNumber}/${totalBatches} (rows ${startRow}-${endRow})`);
      
      try {
        // Use direct range operation with enhanced API optimizer
        await excelService.apiOptimizer.executeDirectRangeOperation(
          excelService.client,
          siteId,
          excelService.workbookId,
          excelService.worksheetName,
          range,
          'write',
          formattedRows,
          {
            priority: 2, // Higher priority for write operations
            operationType: 'write',
            context: {
              operation: 'updateSpreadsheetWithMonitoring',
              batchNumber,
              totalBatches,
              operationId,
              workbookSize: workbookSizeCategory
            }
          }
        );
        
        const batchEndTime = Date.now();
        const batchDuration = batchEndTime - batchStartTime;
        const networkLatency = excelService.apiOptimizer.getLastOperationLatency ? 
          excelService.apiOptimizer.getLastOperationLatency() : 0;
        
        // Update progress with batch metrics
        await progressMonitor.updateProgress(batchIndex, {
          recordsProcessed: formattedRows.length,
          rowPosition: endRow + 1,
          batchSize: formattedRows.length,
          startTime: batchStartTime,
          endTime: batchEndTime,
          networkLatency,
          metadata: {
            range,
            recordsPerSecond: Math.round((formattedRows.length / batchDuration) * 1000)
          }
        });
        
        currentRow = endRow + 1;
      } catch (batchError) {
        // Record batch failure
        await progressMonitor.recordFailure(batchIndex, batchError, 0);
        
        // If we get the file size error, try the batch API approach
        if (batchError.code === 'OpenWorkbookTooLarge') {
          progressMonitor.updatePhase('switching', 'Workbook too large for direct updates, switching to batch API approach');
          
          try {
            const result = await updateUsingMonitoredBatchAPI(
              excelService,
              records.slice(i), 
              siteId, 
              currentRow, 
              progressMonitor,
              batchIndex
            );
            
            // Complete monitoring with partial success
            const summary = await progressMonitor.complete({
              batchApiUsed: true,
              partialProcessing: true,
              recordsProcessedBeforeSwitch: i,
              successRate: result.successRate
            });
            
            return {
              success: result.success,
              operationId,
              recordsProcessed: totalRecords,
              totalRecords,
              duration: summary.performance.totalRuntimeMs,
              summary
            };
          } catch (error) {
            // Fail monitoring with error
            const summary = await progressMonitor.fail(error);
            
            throw error;
          }
        }
        
        // If we get a timeout error, try with smaller batch size
        if (batchError.code === 'OPERATION_TIMEOUT' || batchError.code === 'RequestTimeout') {
          progressMonitor.updatePhase('adapting', 'Timeout detected, adapting batch size');
          progressMonitor.recordWarning({
            message: 'Timeout error detected, retrying with smaller batch size',
            category: 'timeout'
          });
          
          // Reduce batch size by half for this chunk
          const reducedBatchSize = Math.max(10, Math.floor(batchSize / 2));
          
          // Process this chunk with smaller batches
          for (let j = batchStart; j < batchEnd; j += reducedBatchSize) {
            const subBatchStart = j;
            const subBatchEnd = Math.min(subBatchStart + reducedBatchSize, batchEnd);
            const subBatchRecords = records.slice(subBatchStart, subBatchEnd);
            const subFormattedRows = excelService.formatRecordsForExcel(subBatchRecords);
            
            const subStartRow = currentRow;
            const subEndRow = currentRow + subFormattedRows.length - 1;
            const subRange = `A${subStartRow}:CA${subEndRow}`;
            
            const subBatchStartTime = Date.now();
            
            progressMonitor.updatePhase('adapting', `Processing sub-batch with reduced size ${reducedBatchSize} (rows ${subStartRow}-${subEndRow})`);
            
            try {
              await excelService.apiOptimizer.executeDirectRangeOperation(
                excelService.client,
                siteId,
                excelService.workbookId,
                excelService.worksheetName,
                subRange,
                'write',
                subFormattedRows,
                {
                  priority: 3, // Higher priority for retry operations
                  operationType: 'write',
                  context: {
                    operation: 'updateSpreadsheetWithMonitoring_retry',
                    isRetry: true,
                    operationId,
                    workbookSize: workbookSizeCategory
                  }
                }
              );
              
              const subBatchEndTime = Date.now();
              const subBatchDuration = subBatchEndTime - subBatchStartTime;
              const subNetworkLatency = excelService.apiOptimizer.getLastOperationLatency ? 
                excelService.apiOptimizer.getLastOperationLatency() : 0;
              
              // Calculate sub-batch index
              const subBatchIndex = batchIndex + ((j - batchStart) / reducedBatchSize) * 0.1;
              
              // Update progress with sub-batch metrics
              await progressMonitor.updateProgress(subBatchIndex, {
                recordsProcessed: subFormattedRows.length,
                rowPosition: subEndRow + 1,
                batchSize: subFormattedRows.length,
                startTime: subBatchStartTime,
                endTime: subBatchEndTime,
                networkLatency: subNetworkLatency,
                metadata: {
                  range: subRange,
                  isSubBatch: true,
                  originalBatchIndex: batchIndex,
                  recordsPerSecond: Math.round((subFormattedRows.length / subBatchDuration) * 1000)
                }
              });
              
              currentRow = subEndRow + 1;
            } catch (subBatchError) {
              // Record sub-batch failure
              await progressMonitor.recordFailure(subBatchIndex, subBatchError, 1);
              
              // If we still get errors with reduced batch size, throw
              throw subBatchError;
            }
          }
          
          // Continue with the next main batch
          continue;
        }
        
        // For other errors, fail the operation
        const summary = await progressMonitor.fail(batchError);
        throw batchError;
      }
    }
    
    // Complete monitoring with success
    progressMonitor.updatePhase('completed', 'Excel spreadsheet update completed successfully');
    const summary = await progressMonitor.complete();
    
    return {
      success: true,
      operationId,
      recordsProcessed: totalRecords,
      totalRecords,
      duration: summary.performance.totalRuntimeMs,
      summary
    };
  } catch (error) {
    // If monitoring was started, fail it with error
    if (progressMonitor.status.isRunning) {
      await progressMonitor.fail(error);
    }
    
    logger.error('Excel spreadsheet update with monitoring failed:', {
      operationId,
      error: error.message,
      stack: error.stack
    });
    
    // Handle rollback if recovery is enabled and we have a snapshot
    if (enableRecovery && recoveryManager && snapshotInfo) {
      try {
        logger.info('Attempting rollback due to operation failure', {
          operationId,
          snapshotId: snapshotInfo.snapshotId,
          errorMessage: error.message
        });
        
        progressMonitor.updatePhase('rollback', 'Rolling back changes due to operation failure');
        
        // Perform rollback
        const rollbackResult = await recoveryManager.rollback(excelService, snapshotInfo.snapshotId, {
          reason: 'operation_failure',
          force: true // Force rollback without creating another snapshot
        });
        
        logger.info('Rollback completed successfully', {
          operationId,
          snapshotId: snapshotInfo.snapshotId,
          rollbackType: rollbackResult.rollbackType,
          rowsRestored: rollbackResult.rowsRestored
        });
        
        // Generate recovery instructions
        await recoveryManager.generateRecoveryInstructions(operationId, {
          type: error.code || 'unknown_error'
        });
        
        // Enhance error with rollback information
        error.rollbackPerformed = true;
        error.rollbackResult = rollbackResult;
      } catch (rollbackError) {
        logger.error('Rollback failed after operation error', {
          operationId,
          snapshotId: snapshotInfo.snapshotId,
          originalError: error.message,
          rollbackError: rollbackError.message
        });
        
        // Enhance error with rollback failure information
        error.rollbackAttempted = true;
        error.rollbackFailed = true;
        error.rollbackError = rollbackError.message;
      }
    }
    
    throw error;
  }
}

/**
 * Update using batch API with progress monitoring
 * @private
 */
async function updateUsingMonitoredBatchAPI(excelService, records, siteId, startingRow, progressMonitor, startBatchIndex = 0) {
  progressMonitor.updatePhase('batch_api', 'Using batch API for efficient processing');
  
  try {
    // Format all records
    const allFormattedRows = excelService.formatRecordsForExcel(records);
    
    // Determine workbook size category for adaptive settings
    const workbookSizeCategory = excelService.determineWorkbookSizeCategory(records.length);
    
    // Use adaptive settings based on workbook size
    const rowsPerOperation = excelService.getAdaptiveRowsPerOperation(workbookSizeCategory);
    
    // Create batch operations
    let currentRow = startingRow;
    const batchOperations = [];
    
    for (let i = 0; i < allFormattedRows.length; i += rowsPerOperation) {
      const rowBatch = allFormattedRows.slice(i, i + rowsPerOperation);
      const startRow = currentRow;
      const endRow = currentRow + rowBatch.length - 1;
      const range = `A${startRow}:CA${endRow}`;
      
      const operation = {
        id: `batch_${i}_${startRow}_${endRow}`,
        method: 'PATCH',
        url: `/sites/${siteId}/drive/items/${excelService.workbookId}/workbook/worksheets/${excelService.worksheetName}/range(address='${range}')`,
        body: {
          values: rowBatch
        },
        headers: {
          'Content-Type': 'application/json'
        }
      };
      
      batchOperations.push(operation);
      currentRow = endRow + 1;
    }
    
    // Update progress monitor with batch API details
    progressMonitor.updatePhase('batch_api', `Executing ${batchOperations.length} batch operations`);
    
    // Track batch API progress
    let completedOperations = 0;
    const totalOperations = batchOperations.length;
    const operationsPerBatch = Math.ceil(totalOperations / 10); // Divide into 10 logical batches for progress tracking
    
    // Use the enhanced executeBatch method with progress tracking
    const batchResults = await excelService.apiOptimizer.executeBatch(
      batchOperations,
      {
        batchSize: excelService.getAdaptiveBatchSize(records.length) / 2,
        priority: 2,
        enableAdaptiveBatchSizing: true,
        minBatchSize: 5,
        maxBatchSize: 30,
        retryFailedBatches: true,
        context: {
          operation: 'updateUsingMonitoredBatchAPI',
          totalOperations,
          totalRows: allFormattedRows.length,
          workbookSize: workbookSizeCategory
        },
        progressCallback: async (completed, total) => {
          // Only update progress when significant change occurs
          if (completed > completedOperations) {
            const batchIndex = startBatchIndex + Math.floor(completed / operationsPerBatch);
            const recordsProcessed = Math.min(records.length, Math.floor((completed / total) * records.length));
            
            await progressMonitor.updateProgress(batchIndex, {
              recordsProcessed,
              rowPosition: startingRow + recordsProcessed,
              metadata: {
                batchApiProgress: `${completed}/${total} operations`,
                completionPercentage: Math.round((completed / total) * 100)
              }
            });
            
            completedOperations = completed;
          }
        }
      }
    );
    
    // Analyze results
    const successfulOperations = batchResults.filter(r => r.status >= 200 && r.status < 300).length;
    const failedOperations = batchResults.filter(r => r.status >= 400).length;
    const successRate = successfulOperations / batchOperations.length;
    
    progressMonitor.updatePhase(
      successRate >= 0.95 ? 'completed' : 'completed_with_errors',
      `Batch API completed with ${Math.round(successRate * 100)}% success rate`
    );
    
    // Record any failures
    if (failedOperations > 0) {
      progressMonitor.recordWarning({
        message: `${failedOperations} batch operations failed (${Math.round((failedOperations / batchOperations.length) * 100)}%)`,
        category: 'batch_api_failures'
      });
    }
    
    return {
      success: successRate >= 0.95,
      successRate,
      successfulOperations,
      failedOperations,
      totalOperations
    };
  } catch (error) {
    progressMonitor.recordFailure(startBatchIndex, error, 0);
    throw error;
  }
}

module.exports = { updateSpreadsheetWithMonitoring };