const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

/**
 * Progress State Management System
 * 
 * Manages persistent state for sync operations to enable recovery
 * from failures and resumption from last successful batch.
 */
class ProgressState {
  constructor(options = {}) {
    this.config = {
      stateDir: options.stateDir || path.join(process.cwd(), 'state'),
      stateFile: options.stateFile || null, // Will be generated based on operation
      autoSave: options.autoSave !== false,
      backupEnabled: options.backupEnabled !== false,
      maxBackups: options.maxBackups || 5,
      compressionEnabled: options.compressionEnabled !== false
    };

    this.currentState = null;
    this.stateFilePath = null;
    this.isInitialized = false;

    logger.info('ProgressState initialized', {
      config: this.config
    });
  }

  /**
   * Initialize progress state for a new operation
   */
  async initialize(operationId, initialData = {}) {
    try {
      if (!operationId) {
        throw new Error('Operation ID is required for initialization');
      }
      
      this.operationId = operationId;
      this.stateFilePath = this.config.stateFile || 
        path.join(this.config.stateDir, `progress_${operationId}.json`);

      // Ensure state directory exists
      await this.ensureStateDirectory();

      // Initialize state structure
      this.currentState = {
        operationId,
        startTime: new Date().toISOString(),
        lastUpdateTime: new Date().toISOString(),
        status: 'initialized',
        totalRecords: initialData.totalRecords || 0,
        processedRecords: 0,
        currentBatch: 0,
        totalBatches: initialData.totalBatches || 0,
        lastSuccessfulRow: 0,
        lastSuccessfulBatch: -1,
        failedBatches: [],
        completedBatches: [],
        configuration: {
          batchSize: initialData.batchSize || 50,
          maxRetries: initialData.maxRetries || 3,
          timeoutMs: initialData.timeoutMs || 30000,
          ...initialData.configuration
        },
        metadata: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          ...initialData.metadata
        },
        checksum: null
      };

      // Calculate and set checksum
      this.currentState.checksum = this.calculateChecksum(this.currentState);

      // Set initialized flag before saving
      this.isInitialized = true;
      
      // Save initial state
      await this.saveState();

      logger.info('Progress state initialized', {
        operationId,
        stateFile: this.stateFilePath,
        initialState: {
          totalRecords: this.currentState.totalRecords,
          totalBatches: this.currentState.totalBatches,
          batchSize: this.currentState.configuration.batchSize
        }
      });

      return this.currentState;
    } catch (error) {
      logger.error('Failed to initialize progress state', {
        operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Load existing progress state from disk
   */
  async loadState(operationId = null) {
    try {
      const targetOperationId = operationId || this.operationId;
      if (!targetOperationId) {
        throw new Error('Operation ID is required to load state');
      }

      const stateFilePath = this.config.stateFile || 
        path.join(this.config.stateDir, `progress_${targetOperationId}.json`);

      // Check if state file exists
      try {
        await fs.access(stateFilePath);
      } catch (accessError) {
        logger.warn('State file does not exist', {
          operationId: targetOperationId,
          stateFile: stateFilePath
        });
        return null;
      }

      // Read and parse state file
      const stateData = await fs.readFile(stateFilePath, 'utf8');
      const parsedState = JSON.parse(stateData);

      // Validate state integrity
      const validationResult = await this.validateState(parsedState);
      if (!validationResult.isValid) {
        logger.error('State validation failed', {
          operationId: targetOperationId,
          errors: validationResult.errors,
          stateFile: stateFilePath
        });
        throw new Error(`State validation failed: ${validationResult.errors.join(', ')}`);
      }

      this.currentState = parsedState;
      this.operationId = targetOperationId;
      this.stateFilePath = stateFilePath;
      this.isInitialized = true;

      logger.info('Progress state loaded successfully', {
        operationId: targetOperationId,
        stateFile: stateFilePath,
        state: {
          status: this.currentState.status,
          processedRecords: this.currentState.processedRecords,
          totalRecords: this.currentState.totalRecords,
          currentBatch: this.currentState.currentBatch,
          totalBatches: this.currentState.totalBatches,
          lastSuccessfulBatch: this.currentState.lastSuccessfulBatch,
          failedBatchCount: this.currentState.failedBatches.length
        }
      });

      return this.currentState;
    } catch (error) {
      logger.error('Failed to load progress state', {
        operationId: operationId || this.operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Save current progress state to disk
   */
  async saveState() {
    try {
      if (!this.isInitialized || !this.currentState) {
        throw new Error('Progress state not initialized');
      }

      // Update timestamps and checksum
      this.currentState.lastUpdateTime = new Date().toISOString();
      this.currentState.checksum = this.calculateChecksum(this.currentState);

      // Create backup if enabled
      if (this.config.backupEnabled) {
        await this.createBackup();
      }

      // Write state to file
      const stateData = JSON.stringify(this.currentState, null, 2);
      await fs.writeFile(this.stateFilePath, stateData, 'utf8');

      logger.debug('Progress state saved', {
        operationId: this.operationId,
        stateFile: this.stateFilePath,
        stateSize: stateData.length,
        checksum: this.currentState.checksum
      });

    } catch (error) {
      logger.error('Failed to save progress state', {
        operationId: this.operationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update progress after successful batch processing
   */
  async updateProgress(batchIndex, batchData = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Progress state not initialized');
      }

      const {
        recordsProcessed = 0,
        rowPosition = null,
        batchSize = null,
        metadata = {}
      } = batchData;

      // Update batch tracking
      this.currentState.currentBatch = batchIndex;
      this.currentState.lastSuccessfulBatch = batchIndex;
      this.currentState.processedRecords += recordsProcessed;

      // Update row position if provided
      if (rowPosition !== null) {
        this.currentState.lastSuccessfulRow = rowPosition;
      }

      // Add to completed batches
      const batchRecord = {
        batchIndex,
        recordsProcessed,
        rowPosition,
        batchSize,
        completedAt: new Date().toISOString(),
        metadata
      };

      this.currentState.completedBatches.push(batchRecord);

      // Remove from failed batches if it was previously failed
      this.currentState.failedBatches = this.currentState.failedBatches.filter(
        fb => fb.batchIndex !== batchIndex
      );

      // Update status
      if (this.currentState.processedRecords >= this.currentState.totalRecords) {
        this.currentState.status = 'completed';
      } else {
        this.currentState.status = 'in_progress';
      }

      // Auto-save if enabled
      if (this.config.autoSave) {
        await this.saveState();
      }

      logger.info('Progress updated', {
        operationId: this.operationId,
        batchIndex,
        recordsProcessed,
        totalProcessed: this.currentState.processedRecords,
        totalRecords: this.currentState.totalRecords,
        progressPercentage: Math.round((this.currentState.processedRecords / this.currentState.totalRecords) * 100),
        status: this.currentState.status
      });

      return this.currentState;
    } catch (error) {
      logger.error('Failed to update progress', {
        operationId: this.operationId,
        batchIndex,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Record a failed batch for retry tracking
   */
  async recordFailedBatch(batchIndex, error, retryCount = 0) {
    try {
      if (!this.isInitialized) {
        throw new Error('Progress state not initialized');
      }

      // Find existing failed batch record or create new one
      let failedBatch = this.currentState.failedBatches.find(fb => fb.batchIndex === batchIndex);
      
      if (failedBatch) {
        // Update existing record
        failedBatch.retryCount = retryCount;
        failedBatch.lastAttempt = new Date().toISOString();
        failedBatch.lastError = {
          message: error.message,
          name: error.name,
          code: error.code,
          statusCode: error.statusCode
        };
      } else {
        // Create new failed batch record
        failedBatch = {
          batchIndex,
          firstFailure: new Date().toISOString(),
          lastAttempt: new Date().toISOString(),
          retryCount,
          lastError: {
            message: error.message,
            name: error.name,
            code: error.code,
            statusCode: error.statusCode
          },
          errorHistory: []
        };
        this.currentState.failedBatches.push(failedBatch);
      }

      // Add to error history
      failedBatch.errorHistory.push({
        timestamp: new Date().toISOString(),
        attempt: retryCount + 1,
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
          statusCode: error.statusCode
        }
      });

      // Update overall status
      this.currentState.status = 'error';

      // Auto-save if enabled
      if (this.config.autoSave) {
        await this.saveState();
      }

      logger.warn('Failed batch recorded', {
        operationId: this.operationId,
        batchIndex,
        retryCount,
        error: error.message,
        totalFailedBatches: this.currentState.failedBatches.length
      });

      return failedBatch;
    } catch (saveError) {
      logger.error('Failed to record failed batch', {
        operationId: this.operationId,
        batchIndex,
        error: saveError.message,
        stack: saveError.stack
      });
      throw saveError;
    }
  }

  /**
   * Get recovery information for resuming operations
   */
  getRecoveryInfo() {
    if (!this.isInitialized || !this.currentState) {
      return null;
    }

    const nextBatchIndex = this.currentState.lastSuccessfulBatch + 1;
    const remainingRecords = this.currentState.totalRecords - this.currentState.processedRecords;
    const nextRowPosition = this.currentState.lastSuccessfulRow + 1;

    return {
      canResume: this.currentState.status !== 'completed',
      nextBatchIndex,
      nextRowPosition,
      remainingRecords,
      processedRecords: this.currentState.processedRecords,
      totalRecords: this.currentState.totalRecords,
      failedBatches: this.currentState.failedBatches,
      completedBatches: this.currentState.completedBatches.length,
      progressPercentage: Math.round((this.currentState.processedRecords / this.currentState.totalRecords) * 100),
      configuration: this.currentState.configuration,
      lastUpdate: this.currentState.lastUpdateTime
    };
  }

  /**
   * Validate state consistency
   */
  async validateState(state = null) {
    const targetState = state || this.currentState;
    const errors = [];
    const warnings = [];

    if (!targetState) {
      errors.push('State is null or undefined');
      return { isValid: false, errors, warnings };
    }

    // Required fields validation
    const requiredFields = [
      'operationId', 'startTime', 'lastUpdateTime', 'status',
      'totalRecords', 'processedRecords', 'currentBatch', 'totalBatches',
      'lastSuccessfulRow', 'lastSuccessfulBatch', 'failedBatches',
      'completedBatches', 'configuration', 'metadata'
    ];

    for (const field of requiredFields) {
      if (targetState[field] === undefined || targetState[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Data consistency validation
    if (targetState.processedRecords > targetState.totalRecords) {
      errors.push('Processed records exceed total records');
    }

    if (targetState.currentBatch > targetState.totalBatches) {
      warnings.push('Current batch exceeds total batches');
    }

    if (targetState.lastSuccessfulBatch >= targetState.currentBatch && targetState.status === 'in_progress') {
      warnings.push('Last successful batch is not behind current batch');
    }

    // Checksum validation
    if (targetState.checksum) {
      const calculatedChecksum = this.calculateChecksum(targetState);
      if (calculatedChecksum !== targetState.checksum) {
        errors.push('Checksum validation failed - state may be corrupted');
      }
    }

    // Batch consistency validation
    const completedBatchIndices = targetState.completedBatches.map(b => b.batchIndex);
    const failedBatchIndices = targetState.failedBatches.map(b => b.batchIndex);
    const overlap = completedBatchIndices.filter(index => failedBatchIndices.includes(index));
    
    if (overlap.length > 0) {
      errors.push(`Batches appear in both completed and failed lists: ${overlap.join(', ')}`);
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      logger.error('State validation failed', {
        operationId: targetState.operationId,
        errors,
        warnings
      });
    } else if (warnings.length > 0) {
      logger.warn('State validation warnings', {
        operationId: targetState.operationId,
        warnings
      });
    }

    return { isValid, errors, warnings };
  }

  /**
   * Reset state for new operation
   */
  async reset() {
    try {
      if (this.stateFilePath && this.config.backupEnabled) {
        await this.createBackup();
      }

      this.currentState = null;
      this.operationId = null;
      this.stateFilePath = null;
      this.isInitialized = false;

      logger.info('Progress state reset');
    } catch (error) {
      logger.error('Failed to reset progress state', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get current state (read-only)
   */
  getCurrentState() {
    return this.currentState ? { ...this.currentState } : null;
  }

  /**
   * Calculate checksum for state integrity
   */
  calculateChecksum(state) {
    const crypto = require('crypto');
    const stateForChecksum = { ...state };
    delete stateForChecksum.checksum; // Remove checksum field itself
    delete stateForChecksum.lastUpdateTime; // Exclude timestamp from checksum
    
    const stateString = JSON.stringify(stateForChecksum, Object.keys(stateForChecksum).sort());
    return crypto.createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Ensure state directory exists
   */
  async ensureStateDirectory() {
    try {
      await fs.mkdir(this.config.stateDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Create backup of current state
   */
  async createBackup() {
    try {
      if (!this.stateFilePath) return;

      const backupDir = path.join(this.config.stateDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${path.basename(this.stateFilePath, '.json')}_backup_${timestamp}.json`;
      const backupPath = path.join(backupDir, backupFileName);

      // Copy current state file to backup
      try {
        await fs.access(this.stateFilePath);
        await fs.copyFile(this.stateFilePath, backupPath);
        
        logger.debug('State backup created', {
          operationId: this.operationId,
          backupPath
        });

        // Clean up old backups
        await this.cleanupOldBackups(backupDir);
      } catch (accessError) {
        // State file doesn't exist yet, skip backup
        logger.debug('Skipping backup - state file does not exist yet');
      }
    } catch (error) {
      logger.warn('Failed to create state backup', {
        operationId: this.operationId,
        error: error.message
      });
      // Don't throw - backup failure shouldn't stop the operation
    }
  }

  /**
   * Clean up old backup files
   */
  async cleanupOldBackups(backupDir) {
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.includes('_backup_') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          stat: null
        }));

      // Get file stats for sorting by creation time
      for (const file of backupFiles) {
        try {
          file.stat = await fs.stat(file.path);
        } catch (statError) {
          logger.warn('Failed to get backup file stats', {
            file: file.name,
            error: statError.message
          });
        }
      }

      // Sort by creation time (newest first) and remove excess backups
      const sortedBackups = backupFiles
        .filter(file => file.stat)
        .sort((a, b) => b.stat.birthtime - a.stat.birthtime);

      if (sortedBackups.length > this.config.maxBackups) {
        const backupsToDelete = sortedBackups.slice(this.config.maxBackups);
        
        for (const backup of backupsToDelete) {
          try {
            await fs.unlink(backup.path);
            logger.debug('Old backup deleted', { file: backup.name });
          } catch (deleteError) {
            logger.warn('Failed to delete old backup', {
              file: backup.name,
              error: deleteError.message
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup old backups', {
        error: error.message
      });
    }
  }
}

module.exports = { ProgressState };