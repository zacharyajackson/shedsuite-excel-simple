const excelService = require('../services/excel');
const shedSuiteService = require('../services/shedsuite');
const { logger } = require('./logger');

class WorkbookCleanup {
  constructor() {
    this.excelService = excelService;
    this.shedSuiteService = shedSuiteService;
  }

  async performCompleteCleanup() {
    const startTime = Date.now();
    logger.info('🧹 Starting COMPLETE workbook cleanup...');

    try {
      // Initialize services
      await this.excelService.initializeClient();
      const siteId = await this.excelService.getSiteId();

      // Step 1: Get current fresh data from ShedSuite
      logger.info('📊 Fetching fresh data from ShedSuite API...');
      const freshRecords = await this.shedSuiteService.fetchAllRecords();
      logger.info(`Found ${freshRecords.length} current records to keep`);

      // Step 2: Nuclear cleanup - clear EVERYTHING
      logger.info('💥 Performing nuclear cleanup of workbook...');
      await this.nuclearClear(siteId);

      // Step 3: Rebuild headers
      logger.info('📝 Rebuilding headers...');
      await this.rebuildHeaders(siteId);

      // Step 4: Insert only fresh data
      logger.info('✨ Inserting fresh data...');
      await this.excelService.updateSpreadsheet(freshRecords);

      const duration = Date.now() - startTime;
      logger.info('🎉 Workbook cleanup completed successfully!', {
        totalRecords: freshRecords.length,
        duration: `${(duration / 1000).toFixed(1)} seconds`,
        status: 'CLEAN'
      });

      return {
        success: true,
        recordsKept: freshRecords.length,
        duration
      };
    } catch (error) {
      logger.error('❌ Workbook cleanup failed:', error);
      throw error;
    }
  }

  async nuclearClear(siteId) {
    try {
      // Clear in much smaller chunks for massive workbooks
      const maxRows = 500000; // Handle up to 500K rows
      const chunkSize = 2000; // Smaller chunks for better success rate

      logger.info(`Clearing up to ${maxRows} rows in chunks of ${chunkSize}...`);

      for (let startRow = 1; startRow <= maxRows; startRow += chunkSize) {
        const endRow = Math.min(startRow + chunkSize - 1, maxRows);
        const clearRange = `A${startRow}:CA${endRow}`;

        try {
          logger.info(`🗑️  Clearing range ${clearRange}...`);

          await this.excelService.executeWithRetry(
            () => this.excelService.client.api(`/sites/${siteId}/drive/items/${this.excelService.workbookId}/workbook/worksheets/${this.excelService.worksheetName}/range(address='${clearRange}')/clear`)
              .post({
                applyTo: 'all' // Clear contents, formatting, everything
              }),
            2 // Fewer retries for speed
          );

          logger.info(`✅ Cleared range ${clearRange}`);
          
          // Add delay between successful chunks to avoid overwhelming SharePoint
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          // If we reach the end of data, we can stop
          if (error.code === 'InvalidArgument' || error.code === 'ItemNotFound') {
            logger.info(`🏁 Reached end of data at row ${startRow}`);
            break;
          }

          // If workbook is too large, try much smaller chunks
          if (error.code === 'OpenWorkbookTooLarge') {
            logger.warn(`Workbook too large for ${chunkSize}-row chunk, trying 200-row chunks...`);
            await this.clearInTinyChunks(siteId, startRow, endRow);
            
            // Add longer delay after tiny chunk clearing
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }

          logger.error(`Failed to clear range ${clearRange}:`, error);
          // Add delay even on failure to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      logger.info('🧹 Nuclear clear completed');
    } catch (error) {
      logger.error('Nuclear clear failed:', error);
      throw error;
    }
  }

  async clearInTinyChunks(siteId, startRow, endRow) {
    const tinyChunkSize = 200; // Much smaller chunks for problematic ranges

    for (let row = startRow; row <= endRow; row += tinyChunkSize) {
      const chunkEnd = Math.min(row + tinyChunkSize - 1, endRow);
      const clearRange = `A${row}:CA${chunkEnd}`;

      try {
        await this.excelService.executeWithRetry(
          () => this.excelService.client.api(`/sites/${siteId}/drive/items/${this.excelService.workbookId}/workbook/worksheets/${this.excelService.worksheetName}/range(address='${clearRange}')/clear`)
            .post({
              applyTo: 'all'
            }),
          1 // Single retry for tiny chunks
        );

        logger.debug(`✅ Cleared tiny chunk: ${clearRange}`);
        
        // Delay between tiny chunks
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (chunkError) {
        logger.warn(`Failed to clear tiny chunk ${clearRange}, continuing...`);
        // Small delay even on failure
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  }

  async rebuildHeaders(siteId) {
    const headers = [
      'Id', 'Balance Dollar Amount', 'Billing Address Line One', 'Billing Address Line Two',
      'Billing City', 'Billing State', 'Billing Zip', 'Building Addons', 'Building Condition',
      'Building Custom Addons', 'Building Length', 'Building Model Name', 'Building Roof Color',
      'Building Roof Type', 'Building Siding Color', 'Building Siding Type', 'Building Size',
      'Building Width', 'Company Id', 'County Tax Rate', 'Customer Name', 'Customer Email',
      'Customer First Name', 'Customer Id', 'Customer Last Name', 'Customer Phone Primary',
      'Customer Source', 'Date Delivered', 'Date Cancelled', 'Date Finished', 'Date Ordered',
      'Date Processed', 'Date Scheduled For Delivery', 'Dealer Id', 'Dealer Primary Sales Rep',
      'Delivery Address Line One', 'Delivery Address Line Two', 'Delivery City', 'Delivery State',
      'Delivery Zip', 'Delivery Notes', 'Order Number', 'Order Status', 'Order Total',
      'Payment Amount', 'Payment Method', 'Permit Required', 'Product Category', 'Product Name',
      'Sales Rep', 'Site Preparation Required', 'Special Instructions', 'State Tax Rate',
      'Tax Amount', 'Total Tax Rate'
    ];

    try {
      await this.excelService.executeWithRetry(
        () => this.excelService.client.api(`/sites/${siteId}/drive/items/${this.excelService.workbookId}/workbook/worksheets/${this.excelService.worksheetName}/range(address='A1:CA1')`)
          .patch({
            values: [headers]
          })
      );

      logger.info('✅ Headers rebuilt successfully');
    } catch (error) {
      logger.error('Failed to rebuild headers:', error);
      throw error;
    }
  }

  async getWorkbookStats(siteId) {
    try {
      const usedRange = await this.excelService.executeWithRetry(
        () => this.excelService.client.api(`/sites/${siteId}/drive/items/${this.excelService.workbookId}/workbook/worksheets/${this.excelService.worksheetName}/usedRange`)
          .select('address,rowCount,columnCount')
          .get()
      );

      return {
        address: usedRange.address,
        rowCount: usedRange.rowCount,
        columnCount: usedRange.columnCount
      };
    } catch (error) {
      logger.error('Failed to get workbook stats:', error);
      return null;
    }
  }
}

module.exports = { WorkbookCleanup };
 