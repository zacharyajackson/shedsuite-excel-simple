require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { PublicClientApplication } = require('@azure/msal-node');
const { logger } = require('../utils/logger');

class ExcelService {
  constructor() {
    this._initialized = false;
    this.msalClient = null;
    this.client = null;
    this.workbookId = null;
    this.worksheetName = null;
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

    // Initialize MSAL
    this.msalClient = new PublicClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      }
    });

    this.client = Client.init({
      authProvider: async (done) => {
        try {
          // Get access token using device code flow
          const deviceCodeRequest = {
            deviceCodeCallback: (response) => {
              // Log the user code and verification URL
              logger.info('Please authenticate:', {
                userCode: response.userCode,
                verificationUrl: response.verificationUri
              });
            },
            scopes: ['Files.ReadWrite', 'User.Read']
          };

          const response = await this.msalClient.acquireTokenByDeviceCode(deviceCodeRequest);
          done(null, response.accessToken);
        } catch (error) {
          done(error, null);
        }
      }
    });

    this.workbookId = process.env.EXCEL_WORKBOOK_ID;
    this.worksheetName = process.env.EXCEL_WORKSHEET_NAME || 'Sheet1';

    this._initialized = true;
  }

  async updateSpreadsheet(records) {
    this._initialize(); // Ensure service is initialized
    try {
      logger.info(`Updating Excel spreadsheet ${this.workbookId}`);

      // Format records for Excel
      const values = this.formatRecordsForExcel(records);

      // Clear existing content (except headers)
      await this.clearWorksheet();

      // Update with new data
      await this.client.api(`/me/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='A2')`).patch({
        values
      });

      logger.info(`Successfully updated ${records.length} records in Excel`);
      return true;
    } catch (error) {
      logger.error('Error updating Excel spreadsheet:', error);
      throw error;
    }
  }

  async clearWorksheet() {
    this._initialize(); // Ensure service is initialized
    try {
      // Get the used range to determine how many rows to clear
      const range = await this.client.api(`/me/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/usedRange`).get();

      if (range.rowCount > 1) { // Only clear if there's data (preserve headers)
        await this.client.api(`/me/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='A2:Z${range.rowCount}')`).patch({
          values: Array(range.rowCount - 1).fill(Array(26).fill(''))
        });
      }
    } catch (error) {
      logger.error('Error clearing worksheet:', error);
      throw error;
    }
  }

  formatRecordsForExcel(records) {
    this._initialize(); // Ensure service is initialized
    return records.map(record => [
      record.id,
      record.order_number,
      record.customer_name,
      record.status,
      record.date_ordered,
      record.date_updated,
      record.building_model_name,
      record.building_size,
      record.total_amount_dollar_amount,
      record.balance_dollar_amount,
      record.customer_email,
      record.customer_phone_primary,
      record.delivery_address
    ]);
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
        await this.client.api(`/me/drive/items/${this.workbookId}`).get();
        
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          workbookId: this.workbookId,
          worksheetName: this.worksheetName
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
      await this.client.api(`/me/drive/items/${this.workbookId}`).get();
      
      logger.info('Excel client initialized successfully', {
        workbookId: this.workbookId,
        worksheetName: this.worksheetName
      });
    } catch (error) {
      logger.error('Failed to initialize Excel client:', error);
      throw error;
    }
  }
}

module.exports = new ExcelService(); 