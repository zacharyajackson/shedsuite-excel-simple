const { logger } = require('./logger');

/**
 * Row Position Tracker
 * 
 * Manages accurate row position tracking for Excel batch operations
 * to prevent duplicate row processing and ensure data integrity.
 */
class RowPositionTracker {
  constructor(options = {}) {
    this.config = {
      startRow: options.startRow || 2, // Default to row 2 (assuming headers in row 1)
      maxConcurrentBatches: options.maxConcurrentBatches || 1,
      conflictDetectionEnabled: options.conflictDetectionEnabled !== false,
      validationEnabled: options.validationEnabled !== false
    };

    // Track allocated row ranges for conflict detection
    this.allocatedRanges = new Map(); // batchIndex -> { startRow, endRow, status }
    this.currentRow = this.config.startRow;
    this.completedBatches = new Set();
    this.failedBatches = new Set();
    
    logger.info('RowPositionTracker initialized', {
      config: this.config,
      initialRow: this.currentRow
    });
  }

  /**
   * Calculate row range for a batch
   */
  calculateBatchRowRange(batchIndex, recordCount) {
    if (recordCount <= 0) {
      throw new Error('Record count must be greater than 0');
    }

    // For sequential processing, use current row position
    const startRow = this.currentRow;
    const endRow = startRow + recordCount - 1;

    return {
      batchIndex,
      startRow,
      endRow,
      recordCount,
      range: `A${startRow}:CA${endRow}`
    };
  }

  /**
   * Allocate row range for a batch with conflict detection
   */
  allocateRowRange(batchIndex, recordCount, options = {}) {
    try {
      const { forceAllocation = false, resumeFromRow = null } = options;

      // Calculate the row range
      let rowRange;
      if (resumeFromRow !== null) {
        // When resuming, use the specified row position
        rowRange = {
          batchIndex,
          startRow: resumeFromRow,
          endRow: resumeFromRow + recordCount - 1,
          recordCount,
          range: `A${resumeFromRow}:CA${resumeFromRow + recordCount - 1}`
        };
      } else {
        rowRange = this.calculateBatchRowRange(batchIndex, recordCount);
      }

      // Check for conflicts if enabled
      if (this.config.conflictDetectionEnabled && !forceAllocation) {
        const conflict = this.detectRowRangeConflict(rowRange);
        if (conflict) {
          throw new Error(`Row range conflict detected: ${conflict.message}`);
        }
      }

      // Allocate the range
      this.allocatedRanges.set(batchIndex, {
        ...rowRange,
        status: 'allocated',
        allocatedAt: new Date().toISOString(),
        options
      });

      // Update current row position for sequential allocation
      this.currentRow = Math.max(this.currentRow, rowRange.endRow + 1);

      logger.info('Row range allocated', {
        batchIndex,
        startRow: rowRange.startRow,
        endRow: rowRange.endRow,
        recordCount,
        range: rowRange.range,
        currentRow: this.currentRow
      });

      return rowRange;
    } catch (error) {
      logger.error('Failed to allocate row range', {
        batchIndex,
        recordCount,
        error: error.message,
        currentAllocations: Array.from(this.allocatedRanges.keys())
      });
      throw error;
    }
  }

  /**
   * Detect conflicts between row ranges
   */
  detectRowRangeConflict(newRange) {
    for (const [existingBatchIndex, existingRange] of this.allocatedRanges) {
      if (existingRange.status === 'completed') {
        continue; // Skip completed batches
      }

      // Check for overlap
      const overlap = this.checkRowRangeOverlap(newRange, existingRange);
      if (overlap) {
        return {
          message: `Batch ${newRange.batchIndex} range (${newRange.startRow}-${newRange.endRow}) overlaps with batch ${existingBatchIndex} range (${existingRange.startRow}-${existingRange.endRow})`,
          conflictingBatch: existingBatchIndex,
          newRange,
          existingRange,
          overlapRows: overlap
        };
      }
    }

    return null;
  }

  /**
   * Check if two row ranges overlap
   */
  checkRowRangeOverlap(range1, range2) {
    const start1 = range1.startRow;
    const end1 = range1.endRow;
    const start2 = range2.startRow;
    const end2 = range2.endRow;

    // Check for any overlap
    if (start1 <= end2 && start2 <= end1) {
      return {
        overlapStart: Math.max(start1, start2),
        overlapEnd: Math.min(end1, end2)
      };
    }

    return null;
  }

  /**
   * Mark a batch as successfully completed
   */
  markBatchCompleted(batchIndex, actualRowsWritten = null) {
    const allocation = this.allocatedRanges.get(batchIndex);
    if (!allocation) {
      throw new Error(`No allocation found for batch ${batchIndex}`);
    }

    // Update allocation status
    allocation.status = 'completed';
    allocation.completedAt = new Date().toISOString();
    if (actualRowsWritten !== null) {
      allocation.actualRowsWritten = actualRowsWritten;
    }

    // Add to completed set
    this.completedBatches.add(batchIndex);
    this.failedBatches.delete(batchIndex);

    logger.info('Batch marked as completed', {
      batchIndex,
      startRow: allocation.startRow,
      endRow: allocation.endRow,
      actualRowsWritten,
      totalCompleted: this.completedBatches.size
    });

    return allocation;
  }

  /**
   * Mark a batch as failed
   */
  markBatchFailed(batchIndex, error) {
    const allocation = this.allocatedRanges.get(batchIndex);
    if (!allocation) {
      throw new Error(`No allocation found for batch ${batchIndex}`);
    }

    // Update allocation status
    allocation.status = 'failed';
    allocation.failedAt = new Date().toISOString();
    allocation.lastError = {
      message: error.message,
      name: error.name,
      code: error.code
    };

    // Add to failed set
    this.failedBatches.add(batchIndex);
    this.completedBatches.delete(batchIndex);

    logger.warn('Batch marked as failed', {
      batchIndex,
      startRow: allocation.startRow,
      endRow: allocation.endRow,
      error: error.message,
      totalFailed: this.failedBatches.size
    });

    return allocation;
  }

  /**
   * Get row range for a specific batch
   */
  getBatchRowRange(batchIndex) {
    const allocation = this.allocatedRanges.get(batchIndex);
    if (!allocation) {
      return null;
    }

    return {
      batchIndex,
      startRow: allocation.startRow,
      endRow: allocation.endRow,
      recordCount: allocation.recordCount,
      range: allocation.range,
      status: allocation.status
    };
  }

  /**
   * Get next available row position
   */
  getNextAvailableRow() {
    return this.currentRow;
  }

  /**
   * Get all allocated ranges for debugging
   */
  getAllocatedRanges() {
    const ranges = [];
    for (const [batchIndex, allocation] of this.allocatedRanges) {
      ranges.push({
        batchIndex,
        startRow: allocation.startRow,
        endRow: allocation.endRow,
        recordCount: allocation.recordCount,
        status: allocation.status,
        allocatedAt: allocation.allocatedAt,
        completedAt: allocation.completedAt,
        failedAt: allocation.failedAt
      });
    }
    return ranges.sort((a, b) => a.startRow - b.startRow);
  }

  /**
   * Validate row position consistency
   */
  validateConsistency() {
    const errors = [];
    const warnings = [];

    // Check for overlapping ranges
    const ranges = this.getAllocatedRanges();
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const overlap = this.checkRowRangeOverlap(ranges[i], ranges[j]);
        if (overlap) {
          errors.push(`Overlapping ranges detected: Batch ${ranges[i].batchIndex} (${ranges[i].startRow}-${ranges[i].endRow}) and Batch ${ranges[j].batchIndex} (${ranges[j].startRow}-${ranges[j].endRow})`);
        }
      }
    }

    // Check for gaps in completed ranges
    const completedRanges = ranges.filter(r => r.status === 'completed').sort((a, b) => a.startRow - b.startRow);
    for (let i = 1; i < completedRanges.length; i++) {
      const prevRange = completedRanges[i - 1];
      const currentRange = completedRanges[i];
      
      if (prevRange.endRow + 1 !== currentRange.startRow) {
        warnings.push(`Gap detected between completed batches: Batch ${prevRange.batchIndex} ends at row ${prevRange.endRow}, Batch ${currentRange.batchIndex} starts at row ${currentRange.startRow}`);
      }
    }

    // Check current row position
    const maxEndRow = Math.max(...ranges.map(r => r.endRow), 0);
    if (this.currentRow <= maxEndRow) {
      warnings.push(`Current row position (${this.currentRow}) is not beyond the highest allocated row (${maxEndRow})`);
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      logger.error('Row position validation failed', { errors, warnings });
    } else if (warnings.length > 0) {
      logger.warn('Row position validation warnings', { warnings });
    }

    return {
      isValid,
      errors,
      warnings,
      summary: {
        totalAllocations: this.allocatedRanges.size,
        completedBatches: this.completedBatches.size,
        failedBatches: this.failedBatches.size,
        currentRow: this.currentRow,
        highestAllocatedRow: maxEndRow
      }
    };
  }

  /**
   * Reset tracker for new operation
   */
  reset(startRow = null) {
    this.allocatedRanges.clear();
    this.completedBatches.clear();
    this.failedBatches.clear();
    this.currentRow = startRow || this.config.startRow;

    logger.info('Row position tracker reset', {
      newStartRow: this.currentRow
    });
  }

  /**
   * Get recovery information for resuming operations
   */
  getRecoveryInfo() {
    const completedRanges = this.getAllocatedRanges()
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.startRow - b.startRow);

    const failedRanges = this.getAllocatedRanges()
      .filter(r => r.status === 'failed')
      .sort((a, b) => a.startRow - b.startRow);

    const lastCompletedRow = completedRanges.length > 0 
      ? Math.max(...completedRanges.map(r => r.endRow))
      : this.config.startRow - 1;

    return {
      lastCompletedRow,
      nextAvailableRow: lastCompletedRow + 1,
      completedBatches: completedRanges.map(r => r.batchIndex),
      failedBatches: failedRanges.map(r => r.batchIndex),
      totalAllocations: this.allocatedRanges.size,
      currentRow: this.currentRow,
      canResume: failedRanges.length > 0 || this.currentRow > this.config.startRow
    };
  }

  /**
   * Resolve row range conflicts by reallocating
   */
  resolveConflicts() {
    const conflicts = [];
    const ranges = this.getAllocatedRanges();

    // Find all conflicts
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const overlap = this.checkRowRangeOverlap(ranges[i], ranges[j]);
        if (overlap && ranges[i].status !== 'completed' && ranges[j].status !== 'completed') {
          conflicts.push({
            batch1: ranges[i].batchIndex,
            batch2: ranges[j].batchIndex,
            overlap
          });
        }
      }
    }

    if (conflicts.length === 0) {
      return { resolved: 0, conflicts: [] };
    }

    logger.warn('Resolving row range conflicts', {
      conflictCount: conflicts.length,
      conflicts: conflicts.map(c => `Batch ${c.batch1} vs Batch ${c.batch2}`)
    });

    // Implement automatic conflict resolution
    let resolvedCount = 0;
    const resolvedConflicts = [];

    for (const conflict of conflicts) {
      try {
        const batch1 = this.allocatedRanges.get(conflict.batch1);
        const batch2 = this.allocatedRanges.get(conflict.batch2);

        // Reallocate the batch with higher index to avoid conflicts
        const batchToReallocate = conflict.batch1 > conflict.batch2 ? batch1 : batch2;
        const batchIndexToReallocate = conflict.batch1 > conflict.batch2 ? conflict.batch1 : conflict.batch2;

        if (batchToReallocate && batchToReallocate.status === 'allocated') {
          // Find next available position after all allocated ranges
          const maxEndRow = Math.max(...this.getAllocatedRanges()
            .filter(r => r.batchIndex !== batchIndexToReallocate)
            .map(r => r.endRow));
          
          const newStartRow = maxEndRow + 1;
          const newEndRow = newStartRow + batchToReallocate.recordCount - 1;

          // Update the allocation
          batchToReallocate.startRow = newStartRow;
          batchToReallocate.endRow = newEndRow;
          batchToReallocate.range = `A${newStartRow}:CA${newEndRow}`;
          batchToReallocate.reallocatedAt = new Date().toISOString();
          batchToReallocate.originalConflict = conflict;

          // Update current row if necessary
          this.currentRow = Math.max(this.currentRow, newEndRow + 1);

          resolvedConflicts.push({
            batchIndex: batchIndexToReallocate,
            oldRange: `${conflict.overlap.overlapStart}-${conflict.overlap.overlapEnd}`,
            newRange: `${newStartRow}-${newEndRow}`,
            resolvedAt: batchToReallocate.reallocatedAt
          });

          resolvedCount++;

          logger.info('Conflict resolved by reallocation', {
            batchIndex: batchIndexToReallocate,
            newStartRow,
            newEndRow,
            newRange: batchToReallocate.range
          });
        }
      } catch (error) {
        logger.error('Failed to resolve conflict', {
          conflict,
          error: error.message
        });
      }
    }

    return {
      resolved: resolvedCount,
      conflicts: resolvedConflicts,
      message: resolvedCount > 0 
        ? `Successfully resolved ${resolvedCount} conflicts by reallocation`
        : 'No conflicts could be automatically resolved'
    };
  }

  /**
   * Compact allocated ranges to eliminate gaps
   */
  compactRanges() {
    const ranges = this.getAllocatedRanges()
      .filter(r => r.status !== 'completed')
      .sort((a, b) => a.startRow - b.startRow);

    if (ranges.length === 0) {
      return { compacted: 0, ranges: [] };
    }

    let compactedCount = 0;
    let currentRow = this.config.startRow;

    // Find the highest completed row to start compaction from
    const completedRanges = this.getAllocatedRanges()
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.endRow - b.endRow);

    if (completedRanges.length > 0) {
      currentRow = completedRanges[completedRanges.length - 1].endRow + 1;
    }

    const compactedRanges = [];

    for (const range of ranges) {
      const allocation = this.allocatedRanges.get(range.batchIndex);
      if (!allocation || allocation.status === 'completed') {
        continue;
      }

      const originalStartRow = allocation.startRow;
      const recordCount = allocation.recordCount;

      if (allocation.startRow !== currentRow) {
        // Need to compact this range
        allocation.startRow = currentRow;
        allocation.endRow = currentRow + recordCount - 1;
        allocation.range = `A${currentRow}:CA${allocation.endRow}`;
        allocation.compactedAt = new Date().toISOString();
        allocation.originalStartRow = originalStartRow;

        compactedRanges.push({
          batchIndex: range.batchIndex,
          oldStartRow: originalStartRow,
          newStartRow: currentRow,
          newEndRow: allocation.endRow,
          recordCount
        });

        compactedCount++;

        logger.info('Range compacted', {
          batchIndex: range.batchIndex,
          oldStartRow: originalStartRow,
          newStartRow: currentRow,
          newEndRow: allocation.endRow
        });
      }

      currentRow = allocation.endRow + 1;
    }

    // Update current row position
    this.currentRow = currentRow;

    return {
      compacted: compactedCount,
      ranges: compactedRanges,
      newCurrentRow: this.currentRow
    };
  }
}

module.exports = { RowPositionTracker };