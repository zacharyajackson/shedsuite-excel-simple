'use strict';

const dotenv = require('dotenv');
const path = require('path');
const { loadPostmanDefaults } = require('./postman');
dotenv.config();

const serviceRoot = path.resolve(__dirname, '..', '..');
const pm = loadPostmanDefaults(serviceRoot);

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  shedsuite: {
    baseUrl:
      process.env.SHEDSUITE_API_BASE_URL ||
      process.env.SHEDSUITE_BASE_URL ||
      pm.baseURL || 'https://app.shedsuite.com',
    publicApiPath:
      process.env.SHEDSUITE_PUBLIC_API_PATH ||
      process.env.SHEDSUITE_API_PATH ||
      pm.publicApiUrlPath || '/api/public',
    apiKey: process.env.SHEDSUITE_API_KEY || '',
    token: process.env.SHEDSUITE_TOKEN || pm.token || '',
    accountId: process.env.SHEDSUITE_ACCOUNT_ID || '',
    inventory: {
      listPath: process.env.INVENTORY_LIST_PATH || '/api/public/inventory/v1',
      pageSize: parseInt(process.env.INVENTORY_PAGE_SIZE || '100', 10),
      updatedSince: process.env.INVENTORY_UPDATED_SINCE || '',
      fullRefresh: String(process.env.INVENTORY_FULL_REFRESH || 'true').toLowerCase() !== 'false'
    }
  },
  powerbi: {
    tenantId: process.env.POWERBI_TENANT_ID || '',
    clientId: process.env.POWERBI_CLIENT_ID || '',
    clientSecret: process.env.POWERBI_CLIENT_SECRET || '',
    scope: process.env.POWERBI_SCOPE || 'https://analysis.windows.net/powerbi/api/.default',
    groupId: process.env.POWERBI_GROUP_ID || '',
    datasetId: process.env.POWERBI_DATASET_ID || '',
    datasetName: process.env.POWERBI_DATASET_NAME || 'ShedSuite_Inventory',
    tableName: process.env.POWERBI_TABLE_NAME || 'InventoryItems',
    batchSize: parseInt(process.env.POWERBI_BATCH_SIZE || '5000', 10)
  },
  state: {
    store: (process.env.STATE_STORE || 'memory').toLowerCase(),
    databaseUrl: process.env.DATABASE_URL || ''
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '' // Optional
  },
  security: {
    syncSharedSecret: process.env.SYNC_SHARED_SECRET || ''
  }
};

module.exports = { config };


