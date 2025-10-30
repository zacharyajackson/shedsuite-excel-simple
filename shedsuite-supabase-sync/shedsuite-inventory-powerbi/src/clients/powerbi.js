'use strict';

const axios = require('axios');
const { ConfidentialClientApplication } = require('@azure/msal-node');

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function createPowerBIClient(config, logger) {
  let msal = null;

  function getMsal() {
    if (!msal) {
      if (!config.powerbi.clientId || !config.powerbi.tenantId || !config.powerbi.clientSecret) {
        throw new Error('Power BI credentials are not configured');
      }
      msal = new ConfidentialClientApplication({
        auth: {
          clientId: config.powerbi.clientId,
          authority: `https://login.microsoftonline.com/${config.powerbi.tenantId}`,
          clientSecret: config.powerbi.clientSecret
        }
      });
    }
    return msal;
  }

  let cachedToken = null;
  let cachedTokenExp = 0;

  async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExp - 60_000) return cachedToken; // 60s skew
    const res = await getMsal().acquireTokenByClientCredential({ scopes: [config.powerbi.scope] });
    cachedToken = res.accessToken;
    cachedTokenExp = now + res.expiresIn * 1000;
    return cachedToken;
  }

  async function authedAxios() {
    const token = await getAccessToken();
    return axios.create({
      baseURL: 'https://api.powerbi.com/v1.0/myorg',
      timeout: 30000,
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  async function listDatasets() {
    const http = await authedAxios();
    const url = config.powerbi.groupId ? `/groups/${config.powerbi.groupId}/datasets` : '/datasets';
    const res = await http.get(url);
    return res.data?.value || [];
  }

  function buildInventoryTableSchema() {
    return {
      name: config.powerbi.tableName,
      columns: [
        { name: 'inventoryId', dataType: 'string' },
        { name: 'sku', dataType: 'string' },
        { name: 'status', dataType: 'string' },
        { name: 'location', dataType: 'string' },
        { name: 'widthInches', dataType: 'Int64' },
        { name: 'lengthInches', dataType: 'Int64' },
        { name: 'heightInches', dataType: 'Int64' },
        { name: 'color', dataType: 'string' },
        { name: 'material', dataType: 'string' },
        { name: 'price', dataType: 'Double' },
        { name: 'cost', dataType: 'Double' },
        { name: 'createdAt', dataType: 'DateTime' },
        { name: 'updatedAt', dataType: 'DateTime' },
        { name: 'isAvailable', dataType: 'bool' },
        { name: 'vendorName', dataType: 'string' },
        { name: 'model', dataType: 'string' }
      ]
    };
  }

  async function ensureDataset() {
    if (config.powerbi.datasetId) {
      return config.powerbi.datasetId;
    }
    const datasets = await listDatasets();
    const existing = datasets.find((d) => d.name === config.powerbi.datasetName);
    if (existing) return existing.id;

    const http = await authedAxios();
    const url = config.powerbi.groupId ? `/groups/${config.powerbi.groupId}/datasets` : '/datasets';
    const body = {
      name: config.powerbi.datasetName,
      defaultMode: 'Push',
      tables: [buildInventoryTableSchema()]
    };
    const res = await http.post(url, body);
    const id = res.data?.id;
    if (!id) throw new Error('Failed to create Power BI dataset');
    logger.info({ datasetId: id }, 'Created Power BI dataset');
    return id;
  }

  async function pushRows(datasetId, tableName, rows, batchSize) {
    if (!rows || rows.length === 0) return { batches: 0, rows: 0 };
    const http = await authedAxios();
    const url = config.powerbi.groupId
      ? `/groups/${config.powerbi.groupId}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/rows`
      : `/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/rows`;
    let total = 0;
    let batches = 0;
    for (const chunk of chunkArray(rows, batchSize)) {
      await http.post(url, { rows: chunk });
      total += chunk.length;
      batches += 1;
    }
    return { batches, rows: total };
  }

  return {
    ensureDataset,
    pushRows
  };
}

module.exports = { createPowerBIClient };


