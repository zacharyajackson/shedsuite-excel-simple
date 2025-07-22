/**
 * Recovery and Rollback Manager
 * 
 * Provides functionality to undo partial sync operations when failures occur,
 * validate state before resuming interrupted operations, and resolve data conflicts.
 */

const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');
const { ProgressState } = require('./progress-state');
const { ErrorHandler, ERROR_TYPES } = require('./error-handler');

/**
 * Recovery and Rollback Manager
 */
class RecoveryManager {
  constructor(options = {}) {
    this.config = {
      recoveryDir: options.recoveryDir || path.join(process.cwd(), 'recovery'),
      snapshotDir: options.snapshotDir || path.join(process.cwd(), 'snapshots'),
      maxSnapshots: options.maxSnapshots || 10,
      autoSnapshot: options.autoSnapshot !== false,
      conflictResolutionStrategy: options.conflictResolutionStrategy || 'newer_wins',
      auditLogEnabled: options.auditLogEnabled !== false,
      auditLogPath: options.auditLogPath || path.join(process.cwd(), 'logs', 'recovery-audit.log'),
      stateDir: options.stateDir || path.join(process.cwd(), 'state')
    };

    this.errorHandler = new ErrorHandler(options.errorHandlerConfig || {});
    this.progressState = null;
    this.snapshotRegistry = {};
    this.isInitialized = false;

    logger.info('RecoveryManager initialized', {
      config: this.config
    });
  }

  /**
   * Initialize recovery manager
   */
  async initialize() {
    try {
      // Ensure directories exist
      await this.ensureDirectories();
      
      // Load snapshot registry if exists
      await this.loadSnapshotRegistry();
      
      this.isInitialized = true;
      
      logger.info('RecoveryManager initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize RecoveryManager', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Create a snapshot of current data state before making changes
   * @param {Object} excelService - Excel service instance
   * @param {string} operationId - Operation ID
   * @param {Object} metadata - Additional metadata for the snapshot
   * @returns {Promise<Object>} - Snapshot information
   */
  async createSnapshot(excelService, operationId, metadata = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const snapshotId = `snapshot_${operationId}_${Date.now()}`;
      const snapshotPath = path.join(this.config.snapshotDir, `${snapshotId}.json`);
      
      logger.info('Creating data snapshot before operation', {
        operationId,
        snapshotId,
        snapshotPath
      });

      // Get current data from Excel
      const worksheetData = await this.fetchWorksheetData(excelService);
      
      // Create snapshot object
      const snapshot = {
        id: snapshotId,
        operationId,
        timestamp: new Date().toISOString(),
        worksheetName: excelService.worksheetName,
        workbookId: excelService.workbookId,
        rowCount: worksheetData.length,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString()
        },
        data: worksheetData
      };

      // Save snapshot to file
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
      
      // Update registry
      this.snapshotRegistry[snapshotId] = {
        id: snapshotId,
        operationId,
        timestamp: snapshot.timestamp,
        path: snapshotPath,
        rowCount: worksheetData.length
      };
      
      await this.saveSnapshotRegistry();
      
      // Clean up old snapshots if needed
      await this.cleanupOldSnapshots();
      
      // Log audit entry
      await this.logAuditEntry('create_snapshot', {
        snapshotId,
        operationId,
        rowCount: worksheetData.length
      });
      
      logger.info('Snapshot created successfully', {
        operationId,
        snapshotId,
        rowCount: worksheetData.length
      });
      
      return {
        snapshotId,
        operationId,
        timestamp: snapshot.timestamp,
        rowCount: worksheetData.length
      };
    } catch (error) {
      logger.error('Failed to create snapshot', {
        operationId,
        error: error.message,
        stack: error.stack
      });
      
      // Log audit entry for failure
      await this.logAuditEntry('snapshot_failed', {
        operationId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Rollback to a previous snapshot
   * @param {Object} excelService - Excel service instance
   * @param {string} snapshotId - ID of snapshot to rollback to
   * @param {Object} options - Rollback options
   * @returns {Promise<Object>} - Rollback result
   */
  async rollback(excelService, snapshotId, options = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const { force = false, reason = 'manual', partialRollback = false, rowRange = null } = options;
      
      // Check if snapshot exists
      if (!this.snapshotRegistry[snapshotId]) {
        throw new Error(`Snapshot ${snapshotId} not found in registry`);
      }
      
      const snapshotInfo = this.snapshotRegistry[snapshotId];
      const snapshotPath = snapshotInfo.path;
      
      logger.info('Starting rollback to snapshot', {
        snapshotId,
        reason,
        force,
        partialRollback,
        rowRange
      });
      
      // Load snapshot data
      let snapshot;
      try {
        const snapshotData = await fs.readFile(snapshotPath, 'utf8');
        snapshot = JSON.parse(snapshotData);
      } catch (readError) {
        throw new Error(`Failed to read snapshot file: ${readError.message}`);
      }
      
      // Create a new snapshot of current state before rollback if not forced
      let currentStateSnapshot = null;
      if (!force) {
        try {
          currentStateSnapshot = await this.createSnapshot(
            excelService, 
            `pre_rollback_${snapshotId}`,
            { rollbackTarget: snapshotId, reason }
          );
          
          logger.info('Created pre-rollback snapshot', {
            snapshotId: currentStateSnapshot.snapshotId,
            rowCount: currentStateSnapshot.rowCount
          });
        } catch (snapshotError) {
          logger.warn('Failed to create pre-rollback snapshot, continuing with rollback', {
            error: snapshotError.message
          });
        }
      }
      
      // Initialize Excel client
      await excelService.initializeClient();
      const siteId = await excelService.getSiteId();
      
      // Perform rollback
      let result;
      if (partialRollback && rowRange) {
        // Partial rollback for specific row range
        const [startRow, endRow] = rowRange;
        
        // Extract data for the specified range
        const rangeData = snapshot.data.slice(startRow - 1, endRow);
        
        // Update only the specified range
        const range = `A${startRow}:CA${endRow}`;
        
        logger.info('Performing partial rollback', {
          snapshotId,
          range,
          rowCount: rangeData.length
        });
        
        await excelService.apiOptimizer.executeDirectRangeOperation(
          excelService.client,
          siteId,
          excelService.workbookId,
          excelService.worksheetName,
          range,
          'write',
          rangeData,
          {
            priority: 1, // Highest priority for rollback operations
            operationType: 'rollback',
            context: {
              operation: 'rollback',
              snapshotId,
              reason,
              isPartial: true
            }
          }
        );
        
        result = {
          success: true,
          snapshotId,
          rollbackType: 'partial',
          rowRange,
          rowsRestored: rangeData.length
        };
      } else {
        // Full rollback
        logger.info('Performing full rollback', {
          snapshotId,
          rowCount: snapshot.data.length
        });
        
        // Clear worksheet first
        await excelService.clearWorksheetOptimized(siteId);
        
        // Write header row if exists
        if (snapshot.data.length > 0) {
          const headerRow = snapshot.data[0];
          await excelService.apiOptimizer.executeDirectRangeOperation(
            excelService.client,
            siteId,
            excelService.workbookId,
            excelService.worksheetName,
            'A1:CA1',
            'write',
            [headerRow],
            {
              priority: 1,
              operationType: 'rollback_header',
              context: {
                operation: 'rollback',
                snapshotId
              }
            }
          );
        }
        
        // Write data rows in batches
        const dataRows = snapshot.data.slice(1); // Skip header row
        const batchSize = excelService.getAdaptiveBatchSize(dataRows.length);
        
        for (let i = 0; i < dataRows.length; i += batchSize) {
          const batchRows = dataRows.slice(i, i + batchSize);
          const startRow = i + 2; // +2 because we start from row 2 (after header)
          const endRow = startRow + batchRows.length - 1;
          const range = `A${startRow}:CA${endRow}`;
          
          await excelService.apiOptimizer.executeDirectRangeOperation(
            excelService.client,
            siteId,
            excelService.workbookId,
            excelService.worksheetName,
            range,
            'write',
            batchRows,
            {
              priority: 1,
              operationType: 'rollback_data',
              context: {
                operation: 'rollback',
                snapshotId,
                batchIndex: Math.floor(i / batchSize),
                totalBatches: Math.ceil(dataRows.length / batchSize)
              }
            }
          );
        }
        
        result = {
          success: true,
          snapshotId,
          rollbackType: 'full',
          rowsRestored: snapshot.data.length
        };
      }
      
      // Log audit entry
      await this.logAuditEntry('rollback_completed', {
        snapshotId,
        reason,
        rollbackType: result.rollbackType,
        rowsRestored: result.rowsRestored,
        preRollbackSnapshot: currentStateSnapshot?.snapshotId
      });
      
      logger.info('Rollback completed successfully', {
        snapshotId,
        rollbackType: result.rollbackType,
        rowsRestored: result.rowsRestored
      });
      
      return result;
    } catch (error) {
      logger.error('Rollback failed', {
        snapshotId,
        error: error.message,
        stack: error.stack
      });
      
      // Log audit entry for failure
      await this.logAuditEntry('rollback_failed', {
        snapshotId,
        error: error.message
      });
      
      throw error;
    }
  }

  // Additional methods will be implemented in recovery-manager-part2.js
  
  /**
   * Ensure required directories exist
   * @private
   */
  async ensureDirectories() {
    const dirs = [
      this.config.recoveryDir,
      this.config.snapshotDir,
      path.dirname(this.config.auditLogPath)
    ];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }

  /**
   * Load snapshot registry
   * @private
   */
  async loadSnapshotRegistry() {
    const registryPath = path.join(this.config.snapshotDir, 'snapshot-registry.json');
    
    try {
      await fs.access(registryPath);
      const registryData = await fs.readFile(registryPath, 'utf8');
      this.snapshotRegistry = JSON.parse(registryData);
      
      logger.info('Snapshot registry loaded', {
        snapshotCount: Object.keys(this.snapshotRegistry).length
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Registry doesn't exist yet, create empty one
        this.snapshotRegistry = {};
        await this.saveSnapshotRegistry();
      } else {
        logger.error('Failed to load snapshot registry', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    }
  }

  /**
   * Save snapshot registry
   * @private
   */
  async saveSnapshotRegistry() {
    const registryPath = path.join(this.config.snapshotDir, 'snapshot-registry.json');
    
    try {
      await fs.writeFile(registryPath, JSON.stringify(this.snapshotRegistry, null, 2), 'utf8');
    } catch (error) {
      logger.error('Failed to save snapshot registry', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Log audit entry
   * @private
   */
  async logAuditEntry(action, details = {}) {
    if (!this.config.auditLogEnabled) {
      return;
    }
    
    try {
      const entry = {
        timestamp: new Date().toISOString(),
        action,
        ...details
      };
      
      const entryString = JSON.stringify(entry) + '\n';
      
      await fs.appendFile(this.config.auditLogPath, entryString, 'utf8');
    } catch (error) {
      logger.warn('Failed to log audit entry', {
        action,
        error: error.message
      });
    }
  }
}

module.exports = { RecoveryManager };