require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { logger } = require('../utils/logger');
const excelLog = require('../utils/excel-logger');

class ExcelService {
  constructor() {
    this._initialized = false;
    this.msalClient = null;
    this.client = null;
    this.workbookId = null;
    this.worksheetName = null;
    this.siteId = null;
    this.hostname = null;
    this.sitePath = null;
  }

  _initialize() {
    if (this._initialized) {
      return;
    }

    // Validate required environment variables with more graceful handling
    if (!process.env.AZURE_CLIENT_ID) {
      logger.warn('AZURE_CLIENT_ID is not available yet, Excel service will be unavailable');
      throw new Error('AZURE_CLIENT_ID is required');
    }
    if (!process.env.AZURE_TENANT_ID) {
      logger.warn('AZURE_TENANT_ID is not available yet, Excel service will be unavailable');
      throw new Error('AZURE_TENANT_ID is required');
    }
    if (!process.env.AZURE_CLIENT_SECRET) {
      logger.warn('AZURE_CLIENT_SECRET is not available yet, Excel service will be unavailable');
      throw new Error('AZURE_CLIENT_SECRET is required');
    }

    // Initialize MSAL with client credentials flow
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET
      }
    });

    this.client = Client.init({
      authProvider: async (done) => {
        try {
          // Get access token using client credentials flow
          const response = await this.msalClient.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default']
          });
          done(null, response.accessToken);
        } catch (error) {
          logger.error('Failed to acquire token:', error);
          done(error, null);
        }
      }
    });

    this.workbookId = process.env.EXCEL_WORKBOOK_ID;
    this.worksheetName = process.env.EXCEL_WORKSHEET_NAME || 'Sheet1';
    
    // SharePoint site details
    this.hostname = process.env.SHAREPOINT_HOSTNAME || 'heartlandcapital.sharepoint.com';
    this.sitePath = process.env.SHAREPOINT_SITE_PATH || '/sites/Stor-Mor';

    this._initialized = true;
  }

  /**
   * Get SharePoint site ID dynamically
   * @returns {Promise<string>} Site ID
   */
  async getSiteId() {
    if (this.siteId) {
      excelLog.connection(`Using cached site ID`, { siteId: this.siteId });
      return this.siteId;
    }

    try {
      const startTime = Date.now();
      excelLog.connection(`Getting SharePoint site ID`, {
        hostname: this.hostname,
        sitePath: this.sitePath
      });
      
      const site = await this.client.api(`/sites/${this.hostname}:${this.sitePath}`).get();
      this.siteId = site.id;
      
      const duration = Date.now() - startTime;
      excelLog.connection(`Site ID retrieved successfully`, {
        siteId: this.siteId,
        duration: `${duration}ms`
      });
      
      return this.siteId;
    } catch (error) {
      excelLog.error('Failed to get SharePoint site ID', error, {
        hostname: this.hostname,
        sitePath: this.sitePath
      });
      throw error;
    }
  }

  async updateSpreadsheet(records) {
    this._initialize(); // Ensure service is initialized
    const startTime = Date.now();
    
    try {
      excelLog.info(`Starting Excel spreadsheet update`, {
        workbookId: this.workbookId,
        recordCount: records.length,
        timestamp: new Date().toISOString()
      });

      // Get site ID
      const siteId = await this.getSiteId();
      excelLog.connection(`Site ID obtained successfully`, { siteId });

      // Format records for Excel
      const formatStartTime = Date.now();
      const values = this.formatRecordsForExcel(records);
      const formatDuration = Date.now() - formatStartTime;
      
      excelLog.performance(`Records formatted for Excel`, {
        recordCount: records.length,
        formattedRows: values.length,
        formatDuration: `${formatDuration}ms`
      });

      // Calculate the number of columns dynamically
      const numColumns = values.length > 0 ? values[0].length : 0;
      if (numColumns === 0) {
        excelLog.warn('No data to write to Excel - empty values array');
        return true;
      }

      // Convert column number to Excel column letter (e.g., 1=A, 2=B, 27=AA, etc.)
      const getColumnLetter = (colNum) => {
        let result = '';
        while (colNum > 0) {
          colNum--;
          result = String.fromCharCode(65 + (colNum % 26)) + result;
          colNum = Math.floor(colNum / 26);
        }
        return result;
      };

      const endColumn = getColumnLetter(numColumns);
      excelLog.info(`Excel configuration prepared`, {
        columns: numColumns,
        columnRange: `A-${endColumn}`,
        totalRows: values.length
      });

      // Clear existing data in chunks to avoid payload size limits
      const clearStartTime = Date.now();
      await this.clearExistingDataInChunks(siteId);
      const clearDuration = Date.now() - clearStartTime;
      
      excelLog.performance(`Data clearing completed`, {
        clearDuration: `${clearDuration}ms`
      });

      // Update with new data in much smaller batches to avoid payload size limits
      const batchSize = 10; // Very small batches to avoid payload limits
      const totalBatches = Math.ceil(values.length / batchSize);
      
      excelLog.batch(`Starting batch processing`, {
        totalRows: values.length,
        batchSize: batchSize,
        totalBatches: totalBatches
      });
      
      let successfulBatches = 0;
      let failedBatches = 0;
      let payloadLimitHits = 0;
      
      for (let i = 0; i < values.length; i += batchSize) {
        const batchStartTime = Date.now();
        const batch = values.slice(i, i + batchSize);
        const startRow = i + 2; // Start from row 2 (after headers)
        const endRow = startRow + batch.length - 1;
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        const range = `A${startRow}:${endColumn}${endRow}`;
        
        try {
          excelLog.writing(`Writing batch ${batchNumber}/${totalBatches}`, {
            batchNumber: batchNumber,
            startRow: startRow,
            endRow: endRow,
            range: range,
            batchSize: batch.length
          });
          
          await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='${range}')`)
            .patch({
              values: batch
            });
          
          const batchDuration = Date.now() - batchStartTime;
          successfulBatches++;
          
          excelLog.writing(`Batch ${batchNumber} completed successfully`, {
            batchNumber: batchNumber,
            duration: `${batchDuration}ms`,
            rowsWritten: batch.length
          });
          
          // Add a longer delay between batches to avoid rate limits
          if (i + batchSize < values.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (batchError) {
          const batchDuration = Date.now() - batchStartTime;
          failedBatches++;
          
          if (batchError.code === 'ResponsePayloadSizeLimitExceeded') {
            payloadLimitHits++;
            excelLog.payloadLimit(`Payload limit exceeded for batch ${batchNumber}`, {
              batchNumber: batchNumber,
              batchSize: batch.length,
              range: range,
              duration: `${batchDuration}ms`,
              errorCode: batchError.code
            });
            
            // Try with even smaller batch
            const smallerBatch = batch.slice(0, 5);
            const smallerEndRow = startRow + smallerBatch.length - 1;
            const smallerRange = `A${startRow}:${endColumn}${smallerEndRow}`;
            
            try {
              excelLog.writing(`Retrying batch ${batchNumber} with smaller size`, {
                originalSize: batch.length,
                newSize: smallerBatch.length,
                range: smallerRange
              });
              
              await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='${smallerRange}')`)
                .patch({
                  values: smallerBatch
                });
              
              excelLog.writing(`Smaller batch ${batchNumber} completed successfully`, {
                batchNumber: batchNumber,
                rowsWritten: smallerBatch.length
              });
              
              successfulBatches++;
              failedBatches--; // Adjust count since we succeeded with smaller batch
            } catch (smallerBatchError) {
              excelLog.error(`Even smaller batch failed for batch ${batchNumber}`, smallerBatchError, {
                batchNumber: batchNumber,
                smallerBatchSize: smallerBatch.length,
                range: smallerRange
              });
              throw smallerBatchError;
            }
          } else {
            excelLog.error(`Batch ${batchNumber} failed`, batchError, {
              batchNumber: batchNumber,
              batchSize: batch.length,
              range: range,
              duration: `${batchDuration}ms`
            });
            throw batchError;
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      excelLog.performance(`Excel update completed successfully`, {
        totalDuration: `${totalDuration}ms`,
        successfulBatches: successfulBatches,
        failedBatches: failedBatches,
        payloadLimitHits: payloadLimitHits,
        totalRecords: records.length,
        averageBatchTime: `${Math.round(totalDuration / totalBatches)}ms`
      });
      
      return true;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      excelLog.error('Excel spreadsheet update failed', error, {
        totalDuration: `${totalDuration}ms`,
        recordCount: records.length
      });
      throw error;
    }
  }

  async clearExistingDataInChunks(siteId) {
    const startTime = Date.now();
    
    try {
      excelLog.clearing(`Starting conservative data clearing approach`, {
        workbookId: this.workbookId,
        worksheetName: this.worksheetName,
        timestamp: new Date().toISOString()
      });
      
      // Instead of trying to clear the entire worksheet at once, let's use a more conservative approach
      // We'll clear data in very small chunks and handle the payload size limits gracefully
      
      // First, let's try to get just the first few rows to see what we're working with
      const testStartTime = Date.now();
      const testRange = await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='A1:Z10')`).get();
      const testDuration = Date.now() - testStartTime;
      
      excelLog.clearing(`Test range retrieved`, {
        testDuration: `${testDuration}ms`,
        hasValues: !!testRange.values,
        valueCount: testRange.values ? testRange.values.length : 0
      });
      
      if (!testRange.values || testRange.values.length <= 1) {
        excelLog.clearing(`Worksheet appears to be empty or only has headers, no clearing needed`);
        return;
      }

      // Use very small chunks to avoid payload size limits
      const clearChunkSize = 10; // Very small chunks
      let clearedRows = 0;
      let currentRow = 2; // Start after header
      let hasMoreData = true;
      let consecutiveFailures = 0;
      const maxFailures = 3;
      let chunkCount = 0;
      let payloadLimitHits = 0;

      excelLog.clearing(`Starting chunked clearing process`, {
        clearChunkSize: clearChunkSize,
        maxFailures: maxFailures,
        startRow: currentRow
      });

      while (hasMoreData && consecutiveFailures < maxFailures) {
        chunkCount++;
        const chunkStartTime = Date.now();
        
        try {
          // Try to clear a small chunk
          const endRow = currentRow + clearChunkSize - 1;
          const clearRange = `A${currentRow}:Z${endRow}`;
          
          excelLog.clearing(`Clearing chunk ${chunkCount}`, {
            chunkNumber: chunkCount,
            startRow: currentRow,
            endRow: endRow,
            range: clearRange,
            chunkSize: clearChunkSize
          });
          
          await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='${clearRange}')/clear`);
          
          const chunkDuration = Date.now() - chunkStartTime;
          clearedRows += clearChunkSize;
          consecutiveFailures = 0; // Reset failure counter on success
          
          excelLog.clearing(`Chunk ${chunkCount} cleared successfully`, {
            chunkNumber: chunkCount,
            startRow: currentRow,
            endRow: endRow,
            duration: `${chunkDuration}ms`,
            totalClearedRows: clearedRows
          });
          
          currentRow += clearChunkSize;
          
          // Add delay between chunks
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (chunkError) {
          const chunkDuration = Date.now() - chunkStartTime;
          consecutiveFailures++;
          
          if (chunkError.code === 'ResponsePayloadSizeLimitExceeded') {
            payloadLimitHits++;
            excelLog.payloadLimit(`Payload limit reached at row ${currentRow}`, {
              chunkNumber: chunkCount,
              currentRow: currentRow,
              duration: `${chunkDuration}ms`,
              errorCode: chunkError.code,
              consecutiveFailures: consecutiveFailures
            });
            hasMoreData = false;
          } else {
            excelLog.error(`Failed to clear chunk ${chunkCount} starting at row ${currentRow}`, chunkError, {
              chunkNumber: chunkCount,
              currentRow: currentRow,
              duration: `${chunkDuration}ms`,
              consecutiveFailures: consecutiveFailures
            });
            
            if (consecutiveFailures >= maxFailures) {
              excelLog.warn(`Too many consecutive failures, stopping clear operation`, {
                chunkNumber: chunkCount,
                consecutiveFailures: consecutiveFailures,
                maxFailures: maxFailures
              });
              hasMoreData = false;
            }
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      excelLog.performance(`Data clearing completed`, {
        totalDuration: `${totalDuration}ms`,
        totalChunks: chunkCount,
        clearedRows: clearedRows,
        payloadLimitHits: payloadLimitHits,
        consecutiveFailures: consecutiveFailures,
        stoppedReason: hasMoreData ? 'max_failures' : 'payload_limit'
      });
      
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      excelLog.error('Error clearing worksheet in chunks', error, {
        totalDuration: `${totalDuration}ms`
      });
      // Don't throw the error, just log it and continue
      excelLog.warn('Continuing with data update despite clear errors');
    }
  }

  formatRecordsForExcel(records) {
    this._initialize(); // Ensure service is initialized
    
    if (!records || records.length === 0) {
      logger.warn('No records to format for Excel');
      return [];
    }

    // Log the first record to see what fields are available
    const sampleRecord = records[0];
    logger.info('Sample record fields for Excel formatting:', {
      availableFields: Object.keys(sampleRecord),
      fieldCount: Object.keys(sampleRecord).length
    });

    // Convert the formatted record object to an array
    // Only include fields that actually exist in the ShedSuite formatted records
    return records.map(record => {
      return [
        record.id || '',
        record.order_number || '',
        record.customer_name || '',
        record.status || '',
        record.date_ordered || '',
        record.date_updated || record.timestamp || '',
        record.building_model_name || '',
        record.building_size || '',
        record.total_amount_dollar_amount || '',
        record.balance_dollar_amount || '',
        record.customer_email || '',
        record.customer_phone_primary || '',
        record.delivery_address_line_one || '',
        record.delivery_address_line_two || '',
        record.delivery_city || '',
        record.delivery_state || '',
        record.delivery_zip || '',
        record.billing_address_line_one || '',
        record.billing_address_line_two || '',
        record.billing_city || '',
        record.billing_state || '',
        record.billing_zip || '',
        record.customer_first_name || '',
        record.customer_last_name || '',
        record.customer_id || '',
        record.customer_source || '',
        record.building_length || '',
        record.building_width || '',
        record.building_roof_type || '',
        record.building_roof_color || '',
        record.building_siding_type || '',
        record.building_siding_color || '',
        record.building_condition || '',
        record.building_addons || '',
        record.building_custom_addons || '',
        record.company_id || '',
        record.dealer_id || '',
        record.dealer_primary_sales_rep || '',
        record.sold_by_dealer || '',
        record.sold_by_dealer_id || '',
        record.sold_by_dealer_user || '',
        record.shop_name || '',
        record.driver_name || '',
        record.serial_number || '',
        record.order_type || '',
        record.rto || '',
        record.rto_company_name || '',
        record.rto_months_of_term || '',
        record.initial_payment_dollar_amount || '',
        record.initial_payment_type || '',
        record.invoice_url || '',
        record.date_delivered || '',
        record.date_cancelled || '',
        record.date_finished || '',
        record.date_processed || '',
        record.date_scheduled_for_delivery || '',
        record.promocode_code || '',
        record.promocode_name || '',
        record.promocode_amount_discounted || '',
        record.promocode_type || '',
        record.promocode_value || '',
        record.promocode_target || '',
        record.sub_total_dollar_amount || '',
        record.sub_total_adjustment_dollar_amount || '',
        record.sub_total_adjustment_note || '',
        record.total_tax_dollar_amount || '',
        record.state_tax_dollar_amount || '',
        record.state_tax_rate || '',
        record.tax_city || '',
        record.tax_city_dollar_amount || '',
        record.tax_city_rate || '',
        record.tax_county || '',
        record.tax_county_dollar_amount || '',
        record.tax_county_rate || '',
        record.county_tax_rate || '',
        record.special_district || '',
        record.special_district_rate || '',
        record.special_district_tax_dollar_amount || '',
        record.state || '',
        record.timestamp || ''
      ];
    });
  }

  /**
   * Apply targeted updates to specific records in Excel
   * @param {Array} updates - Array of records to update
   * @returns {Promise<boolean>} Success status
   */
  async applyTargetedUpdates(updates) {
    this._initialize(); // Ensure service is initialized
    try {
      logger.info(`Applying ${updates.length} targeted updates to Excel spreadsheet ${this.workbookId}`);

      if (!updates || updates.length === 0) {
        logger.info('No updates to apply');
        return true;
      }

      // For targeted updates, we'll use the existing updateSpreadsheet method
      // This is a simplified approach - in a more sophisticated implementation,
      // you might want to update specific rows based on record IDs
      await this.updateSpreadsheet(updates);

      logger.info(`Successfully applied ${updates.length} targeted updates to Excel`);
      return true;
    } catch (error) {
      logger.error('Error applying targeted updates to Excel:', error);
      throw error;
    }
  }

  /**
   * Perform a health check on the Excel service
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      // Check if required environment variables are set
      if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID || !process.env.EXCEL_WORKBOOK_ID) {
        return {
          status: 'unhealthy',
          error: 'Missing required environment variables for Excel service',
          timestamp: new Date().toISOString()
        };
      }

      this._initialize(); // Ensure service is initialized

      // Check if MSAL client is properly initialized
      if (!this.msalClient) {
        return {
          status: 'unhealthy',
          error: 'MSAL client not initialized',
          timestamp: new Date().toISOString()
        };
      }

      // Try to access the workbook to verify connectivity
      try {
        const siteId = await this.getSiteId();
        await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}`).get();
        
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          workbookId: this.workbookId,
          worksheetName: this.worksheetName,
          siteId: siteId
        };
      } catch (error) {
        return {
          status: 'degraded',
          error: `Cannot access workbook: ${error.message}`,
          timestamp: new Date().toISOString(),
          workbookId: this.workbookId
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Initialize the Excel client
   * @returns {Promise<void>}
   */
  async initializeClient() {
    try {
      logger.info('Initializing Excel client...');
      
      // Check if required environment variables are set
      if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID || !process.env.EXCEL_WORKBOOK_ID) {
        throw new Error('Missing required environment variables for Excel service');
      }

      this._initialize(); // Ensure service is initialized

      // Verify that MSAL client is properly initialized
      if (!this.msalClient) {
        throw new Error('MSAL client not initialized');
      }

      // Test connectivity by trying to access the workbook
      const siteId = await this.getSiteId();
      await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}`).get();
      
      logger.info('Excel client initialized successfully', {
        workbookId: this.workbookId,
        worksheetName: this.worksheetName,
        siteId: siteId
      });
    } catch (error) {
      logger.error('Failed to initialize Excel client:', error);
      throw error;
    }
  }
}

module.exports = new ExcelService(); 