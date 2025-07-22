require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { logger } = require('../utils/logger');

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
      return this.siteId;
    }

    try {
      logger.info('Getting SharePoint site ID...');
      const site = await this.client.api(`/sites/${this.hostname}:${this.sitePath}`).get();
      this.siteId = site.id;
      logger.debug(`Site ID retrieved: ${this.siteId}`);
      return this.siteId;
    } catch (error) {
      logger.error('Failed to get SharePoint site ID:', error);
      throw error;
    }
  }

  async updateSpreadsheet(records) {
    this._initialize(); // Ensure service is initialized
    try {
      logger.info(`Updating Excel spreadsheet ${this.workbookId}`);

      // Get site ID
      const siteId = await this.getSiteId();
      logger.info(`Site ID obtained: ${siteId}`);

      // Format records for Excel
      const values = this.formatRecordsForExcel(records);

      // Clear existing content (except headers)
      await this.clearExistingData(siteId);

      // Update with new data in batches
      const batchSize = 100;
      for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        const startRow = i + 2; // Start from row 2 (after headers)
        const endRow = startRow + batch.length - 1;
        
        await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='A${startRow}:CA${endRow}')`)
          .patch({
            values: batch
          });
        
        logger.info(`Updated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(values.length / batchSize)}`);
      }

      logger.info(`Successfully updated ${records.length} records in Excel`);
      return true;
    } catch (error) {
      logger.error('Error updating Excel spreadsheet:', error);
      throw error;
    }
  }

  async clearExistingData(siteId) {
    try {
      // Get the used range to determine how many rows to clear
      const range = await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/usedRange`).get();

      if (range.rowCount > 1) { // Only clear if there's data (preserve headers)
        const clearRange = `A2:Z${range.rowCount}`;
        await this.client.api(`/sites/${siteId}/drive/items/${this.workbookId}/workbook/worksheets/${this.worksheetName}/range(address='${clearRange}')/clear`);
        logger.info(`Cleared ${range.rowCount - 1} rows of data`);
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