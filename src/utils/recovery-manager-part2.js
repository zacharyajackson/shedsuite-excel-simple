/**
 * Recovery and Rollback Manager - Part 2
 * 
 * Additional methods for the RecoveryManager class.
 */

const { RecoveryManager } = require('./recovery-manager');
const { ERROR_TYPES } = require('./error-handler');

/**
 * Validate state before resuming interrupted operations
 * @param {string} operationId - Operation ID to validate
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} - Validation result
 */
RecoveryManager.prototype.validateStateBeforeResume = async function(operationId, options = {}) {
  try {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { logger } = require('./logger');
    const { ProgressState } = require('./progress-state');

    logger.info('Validating state before resuming operation', {
      operationId,
      options
    });
    
    // Load progress state
    this.progressState = new ProgressState({
      stateDir: this.config.stateDir
    });
    
    const state = await this.progressState.loadState(operationId);
    
    if (!state) {
      throw new Error(`No state found for operation ${operationId}`);
    }
    
    // Perform validation
    const validationResult = await this.progressState.validateState(state);
    
    if (!validationResult.isValid) {
      logger.error('State validation failed', {
        operationId,
        errors: validationResult.errors
      });
      
      // Log audit entry
      await this.logAuditEntry('state_validation_failed', {
        operationId,
        errors: validationResult.errors
      });
      
      return {
        isValid: false,
        canResume: false,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        recoveryRecommendation: 'rollback_to_snapshot',
        message: 'State validation failed. Recommend rollback to last snapshot.'
      };
    }
    
    // Check for warnings
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      logger.warn('State validation warnings', {
        operationId,
        warnings: validationResult.warnings
      });
      
      // Log audit entry
      await this.logAuditEntry('state_validation_warnings', {
        operationId,
        warnings: validationResult.warnings
      });
    }
    
    // Get recovery info
    const recoveryInfo = this.progressState.getRecoveryInfo();
    
    // Check if operation can be resumed
    if (!recoveryInfo.canResume) {
      return {
        isValid: true,
        canResume: false,
        message: 'Operation is already completed and cannot be resumed.',
        state: recoveryInfo
      };
    }
    
    // Check for failed batches
    const hasCriticalFailures = recoveryInfo.failedBatches.some(batch => 
      batch.lastError && 
      (batch.lastError.code === 'DATA_CORRUPTION' || 
       batch.lastError.name === 'DATA_CORRUPTION' ||
       batch.retryCount >= 3)
    );
    
    if (hasCriticalFailures) {
      logger.warn('Critical failures detected in state', {
        operationId,
        failedBatches: recoveryInfo.failedBatches.length
      });
      
      return {
        isValid: true,
        canResume: true,
        requiresIntervention: true,
        message: 'Critical failures detected. Manual intervention recommended before resuming.',
        state: recoveryInfo,
        recoveryRecommendation: 'manual_intervention'
      };
    }
    
    // State is valid and can be resumed
    return {
      isValid: true,
      canResume: true,
      state: recoveryInfo,
      message: 'State is valid and operation can be resumed.'
    };
  } catch (error) {
    const { logger } = require('./logger');
    
    logger.error('Failed to validate state', {
      operationId,
      error: error.message,
      stack: error.stack
    });
    
    // Log audit entry
    await this.logAuditEntry('state_validation_error', {
      operationId,
      error: error.message
    });
    
    throw error;
  }
};

/**
 * Resolve data conflicts between source and destination
 * @param {Array} sourceRecords - Source records
 * @param {Array} destinationRecords - Destination records
 * @param {Object} options - Conflict resolution options
 * @returns {Promise<Object>} - Resolved data
 */
RecoveryManager.prototype.resolveConflicts = async function(sourceRecords, destinationRecords, options = {}) {
  try {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { logger } = require('./logger');

    const {
      strategy = this.config.conflictResolutionStrategy,
      keyField = 'id',
      timestampField = 'updatedAt',
      forceStrategy = false
    } = options;
    
    logger.info('Resolving data conflicts', {
      sourceCount: sourceRecords.length,
      destinationCount: destinationRecords.length,
      strategy,
      keyField
    });
    
    // Create maps for faster lookups
    const sourceMap = new Map();
    const destMap = new Map();
    
    sourceRecords.forEach(record => {
      if (record[keyField]) {
        sourceMap.set(record[keyField], record);
      }
    });
    
    destinationRecords.forEach(record => {
      if (record[keyField]) {
        destMap.set(record[keyField], record);
      }
    });
    
    // Find conflicts (records that exist in both source and destination)
    const conflicts = [];
    const onlyInSource = [];
    const onlyInDest = [];
    
    // Check source records
    sourceMap.forEach((record, key) => {
      if (destMap.has(key)) {
        conflicts.push({
          key,
          source: record,
          destination: destMap.get(key)
        });
      } else {
        onlyInSource.push(record);
      }
    });
    
    // Check destination records
    destMap.forEach((record, key) => {
      if (!sourceMap.has(key)) {
        onlyInDest.push(record);
      }
    });
    
    // Resolve conflicts based on strategy
    const resolved = [];
    const resolutionDetails = {
      sourceWins: 0,
      destinationWins: 0,
      manualResolution: 0
    };
    
    for (const conflict of conflicts) {
      let resolvedRecord;
      
      switch (strategy) {
        case 'source_wins':
          resolvedRecord = conflict.source;
          resolutionDetails.sourceWins++;
          break;
          
        case 'destination_wins':
          resolvedRecord = conflict.destination;
          resolutionDetails.destinationWins++;
          break;
          
        case 'newer_wins':
          // Compare timestamps if available
          if (conflict.source[timestampField] && conflict.destination[timestampField]) {
            const sourceTime = new Date(conflict.source[timestampField]).getTime();
            const destTime = new Date(conflict.destination[timestampField]).getTime();
            
            if (sourceTime >= destTime) {
              resolvedRecord = conflict.source;
              resolutionDetails.sourceWins++;
            } else {
              resolvedRecord = conflict.destination;
              resolutionDetails.destinationWins++;
            }
          } else {
            // Default to source if timestamps not available
            resolvedRecord = conflict.source;
            resolutionDetails.sourceWins++;
          }
          break;
          
        case 'manual':
          // For manual resolution, we'll mark it for later handling
          resolvedRecord = {
            ...conflict.source,
            __conflict: {
              source: conflict.source,
              destination: conflict.destination,
              status: 'unresolved'
            }
          };
          resolutionDetails.manualResolution++;
          break;
          
        default:
          // Default to source wins
          resolvedRecord = conflict.source;
          resolutionDetails.sourceWins++;
      }
      
      resolved.push(resolvedRecord);
    }
    
    // Combine resolved conflicts with non-conflicting records
    const result = [...resolved, ...onlyInSource];
    
    // Add destination-only records if specified
    if (options.includeDestinationOnly) {
      result.push(...onlyInDest);
    }
    
    // Log audit entry
    await this.logAuditEntry('conflict_resolution', {
      strategy,
      totalConflicts: conflicts.length,
      sourceWins: resolutionDetails.sourceWins,
      destinationWins: resolutionDetails.destinationWins,
      manualResolution: resolutionDetails.manualResolution,
      onlyInSource: onlyInSource.length,
      onlyInDest: onlyInDest.length
    });
    
    logger.info('Conflict resolution completed', {
      totalRecords: result.length,
      conflicts: conflicts.length,
      resolutionDetails,
      onlyInSource: onlyInSource.length,
      onlyInDest: onlyInDest.length
    });
    
    return {
      resolvedRecords: result,
      conflicts: conflicts.length,
      resolutionDetails,
      onlyInSource: onlyInSource.length,
      onlyInDest: onlyInDest.length
    };
  } catch (error) {
    const { logger } = require('./logger');
    
    logger.error('Failed to resolve conflicts', {
      error: error.message,
      stack: error.stack
    });
    
    // Log audit entry
    await this.logAuditEntry('conflict_resolution_failed', {
      error: error.message
    });
    
    throw error;
  }
};

/**
 * Generate recovery instructions for manual intervention
 * @param {string} operationId - Operation ID
 * @param {Object} failureDetails - Details about the failure
 * @returns {Promise<Object>} - Recovery instructions
 */
RecoveryManager.prototype.generateRecoveryInstructions = async function(operationId, failureDetails = {}) {
  try {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const fs = require('fs').promises;
    const path = require('path');
    const { logger } = require('./logger');
    const { ProgressState } = require('./progress-state');
    const { ERROR_TYPES } = require('./error-handler');
    
    logger.info('Generating recovery instructions', {
      operationId,
      failureType: failureDetails.type
    });
    
    // Load progress state
    if (!this.progressState) {
      this.progressState = new ProgressState({
        stateDir: this.config.stateDir
      });
      
      await this.progressState.loadState(operationId);
    }
    
    const state = this.progressState.getCurrentState();
    const recoveryInfo = this.progressState.getRecoveryInfo();
    
    if (!state) {
      throw new Error(`No state found for operation ${operationId}`);
    }
    
    // Get available snapshots for this operation
    const availableSnapshots = Object.values(this.snapshotRegistry)
      .filter(snapshot => snapshot.operationId === operationId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Generate instructions based on failure type
    let instructions = {
      operationId,
      failureType: failureDetails.type || 'unknown',
      timestamp: new Date().toISOString(),
      state: {
        status: state.status,
        processedRecords: state.processedRecords,
        totalRecords: state.totalRecords,
        completionPercentage: Math.round((state.processedRecords / state.totalRecords) * 100),
        failedBatches: state.failedBatches.length
      },
      availableSnapshots: availableSnapshots.map(s => ({
        id: s.id,
        timestamp: s.timestamp,
        rowCount: s.rowCount
      })),
      recoveryOptions: [],
      recommendedAction: '',
      manualSteps: []
    };
    
    // Add recovery options based on failure type
    if (failureDetails.type === ERROR_TYPES.CRITICAL) {
      instructions.recoveryOptions = [
        {
          action: 'rollback',
          description: 'Rollback to the last known good snapshot',
          snapshotId: availableSnapshots.length > 0 ? availableSnapshots[0].id : null,
          complexity: 'low'
        },
        {
          action: 'manual_fix',
          description: 'Manually fix the critical issue and then resume',
          complexity: 'high'
        }
      ];
      
      instructions.recommendedAction = 'rollback';
      
      instructions.manualSteps = [
        '1. Review the error logs to understand the nature of the critical failure',
        '2. If data corruption is suspected, rollback to the last known good snapshot',
        '3. If the issue is related to resource exhaustion, address the resource constraints',
        '4. After fixing the underlying issue, attempt to resume the operation'
      ];
    } else if (state.failedBatches.length > 0) {
      instructions.recoveryOptions = [
        {
          action: 'resume',
          description: 'Resume from the last successful batch',
          nextBatchIndex: recoveryInfo.nextBatchIndex,
          complexity: 'low'
        },
        {
          action: 'partial_rollback',
          description: 'Rollback only the failed batches and then resume',
          failedBatches: state.failedBatches.map(b => b.batchIndex),
          complexity: 'medium'
        },
        {
          action: 'full_rollback',
          description: 'Rollback to the last known good snapshot and restart',
          snapshotId: availableSnapshots.length > 0 ? availableSnapshots[0].id : null,
          complexity: 'medium'
        }
      ];
      
      instructions.recommendedAction = state.failedBatches.length < 5 ? 'resume' : 'partial_rollback';
      
      instructions.manualSteps = [
        '1. Review the failed batches to understand the nature of the failures',
        '2. If failures are isolated, resume from the last successful batch',
        '3. If multiple batches failed, consider a partial rollback of those batches',
        '4. If widespread failures occurred, perform a full rollback to the last snapshot'
      ];
    } else {
      instructions.recoveryOptions = [
        {
          action: 'resume',
          description: 'Resume from the last successful batch',
          nextBatchIndex: recoveryInfo.nextBatchIndex,
          complexity: 'low'
        },
        {
          action: 'restart',
          description: 'Restart the operation from the beginning',
          complexity: 'medium'
        }
      ];
      
      instructions.recommendedAction = 'resume';
      
      instructions.manualSteps = [
        '1. Verify that the interruption did not cause data inconsistency',
        '2. Resume the operation from the last successful batch',
        '3. Monitor the resumed operation closely for any issues'
      ];
    }
    
    // Save instructions to file
    const instructionsPath = path.join(
      this.config.recoveryDir,
      `recovery_${operationId}_${Date.now()}.json`
    );
    
    await fs.writeFile(instructionsPath, JSON.stringify(instructions, null, 2), 'utf8');
    
    // Log audit entry
    await this.logAuditEntry('recovery_instructions_generated', {
      operationId,
      instructionsPath,
      recommendedAction: instructions.recommendedAction
    });
    
    logger.info('Recovery instructions generated', {
      operationId,
      instructionsPath,
      recommendedAction: instructions.recommendedAction
    });
    
    return {
      instructions,
      instructionsPath
    };
  } catch (error) {
    const { logger } = require('./logger');
    
    logger.error('Failed to generate recovery instructions', {
      operationId,
      error: error.message,
      stack: error.stack
    });
    
    // Log audit entry
    await this.logAuditEntry('recovery_instructions_failed', {
      operationId,
      error: error.message
    });
    
    throw error;
  }
};

/**
 * Fetch current worksheet data
 * @private
 */
RecoveryManager.prototype.fetchWorksheetData = async function(excelService) {
  try {
    const { logger } = require('./logger');
    
    await excelService.initializeClient();
    const siteId = await excelService.getSiteId();
    
    // Get used range to determine data size
    const usedRange = await excelService.getWorksheetUsedRange(siteId);
    
    if (!usedRange || !usedRange.address) {
      logger.warn('No data found in worksheet');
      return [];
    }
    
    // Parse range address to get dimensions
    const rangeMatch = usedRange.address.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!rangeMatch) {
      logger.warn('Invalid range address format', { address: usedRange.address });
      return [];
    }
    
    const startRow = parseInt(rangeMatch[2]);
    const endRow = parseInt(rangeMatch[4]);
    const rowCount = endRow - startRow + 1;
    
    // For very large worksheets, fetch in batches
    if (rowCount > 1000) {
      return await this.fetchLargeWorksheetData(excelService, siteId, startRow, endRow);
    }
    
    // For smaller worksheets, fetch all at once
    const values = await excelService.getWorksheetValues(siteId, usedRange.address);
    return values || [];
  } catch (error) {
    const { logger } = require('./logger');
    
    logger.error('Failed to fetch worksheet data', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Fetch large worksheet data in batches
 * @private
 */
RecoveryManager.prototype.fetchLargeWorksheetData = async function(excelService, siteId, startRow, endRow) {
  const { logger } = require('./logger');
  
  const batchSize = 1000;
  const allData = [];
  
  for (let row = startRow; row <= endRow; row += batchSize) {
    const batchEndRow = Math.min(row + batchSize - 1, endRow);
    const range = `A${row}:CA${batchEndRow}`;
    
    logger.debug('Fetching worksheet data batch', {
      range,
      batchSize: batchEndRow - row + 1
    });
    
    try {
      const batchData = await excelService.getWorksheetValues(siteId, range);
      if (batchData && Array.isArray(batchData)) {
        allData.push(...batchData);
      }
    } catch (error) {
      logger.warn('Failed to fetch worksheet data batch', {
        range,
        error: error.message
      });
      // Continue with next batch
    }
  }
  
  return allData;
};

/**
 * Clean up old snapshots
 * @private
 */
RecoveryManager.prototype.cleanupOldSnapshots = async function() {
  try {
    const fs = require('fs').promises;
    const { logger } = require('./logger');
    
    const snapshots = Object.values(this.snapshotRegistry)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (snapshots.length <= this.config.maxSnapshots) {
      return;
    }
    
    const snapshotsToDelete = snapshots.slice(this.config.maxSnapshots);
    
    for (const snapshot of snapshotsToDelete) {
      try {
        await fs.unlink(snapshot.path);
        delete this.snapshotRegistry[snapshot.id];
        
        logger.debug('Deleted old snapshot', {
          snapshotId: snapshot.id,
          path: snapshot.path
        });
      } catch (error) {
        logger.warn('Failed to delete old snapshot', {
          snapshotId: snapshot.id,
          error: error.message
        });
      }
    }
    
    await this.saveSnapshotRegistry();
    
    logger.info('Cleaned up old snapshots', {
      deletedCount: snapshotsToDelete.length,
      remainingCount: Object.keys(this.snapshotRegistry).length
    });
  } catch (error) {
    const { logger } = require('./logger');
    
    logger.warn('Failed to clean up old snapshots', {
      error: error.message
    });
  }
};