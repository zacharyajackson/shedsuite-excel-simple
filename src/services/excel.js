require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { PublicClientApplication } = require('@azure/msal-node');
const { logger } = require('../utils/logger');

class ExcelService {
  constructor() {
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
  }

  async updateSpreadsheet(records) {
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
}

module.exports = new ExcelService(); 