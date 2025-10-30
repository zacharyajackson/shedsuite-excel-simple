'use strict';

const path = require('path');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { createStateStore } = require('../state');
const { createShedSuiteClient } = require('../clients/shedsuite');
const { mapInventoryToRows } = require('../mapping/inventoryToRows');
const { apiHeaders, mapInventoryToApiRows } = require('../mapping/inventoryApiCsv');
const { createCsvWriter } = require('../utils/csv');

(async () => {
  const logger = createLogger(config.logLevel);
  // Force memory state by default to avoid any DB dependency for CSV exports
  const useMemoryState = String(process.env.CSV_FORCE_MEMORY || 'true').toLowerCase() !== 'false';
  let stateStore;
  if (useMemoryState) {
    const mem = new Map();
    stateStore = {
      async get(key) { return mem.get(key) || null; },
      async set(key, value) { mem.set(key, value); }
    };
  } else {
    stateStore = createStateStore(config, logger);
  }
  const shedsuiteClient = createShedSuiteClient(config, logger);

  let writer = null;
  try {
    // Generate a readable timestamp for the filename: YYYY-MM-DD_HH-MM-SS
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    const defaultName = `inventory_${timestamp}.csv`;
    const filePath = process.env.CSV_FILE || `./exports/${defaultName}`;

    const useApiHeaders = process.env.CSV_USE_API_HEADERS
      ? String(process.env.CSV_USE_API_HEADERS).toLowerCase() === 'true'
      : true; // default to API-raw headers
    const headers = useApiHeaders
      ? apiHeaders
      : [
          'inventoryId','sku','status','location','widthInches','lengthInches','heightInches',
          'color','material','price','cost','createdAt','updatedAt','isAvailable','vendorName','model'
        ];
    writer = createCsvWriter(filePath, headers);

    const watermarkKey = 'inventory_watermark';
    let previousWatermark = null;
    try { previousWatermark = await stateStore.get(watermarkKey); } catch (_) { previousWatermark = null; }
    const updatedSince = previousWatermark || config.shedsuite.inventory.updatedSince || '';

    const pageSize = config.shedsuite.inventory.pageSize;
    let total = 0;
    let pages = 0;
    const maxPages = parseInt(process.env.LIMIT_PAGES || '0', 10);
    const startedAt = Date.now();
    
    try {
      for await (const page of shedsuiteClient.iterateInventory({ pageSize, updatedSince })) {
        const items = page.items || [];
        pages += 1;
        
        // Log page details for debugging (only debug level)
        logger.debug({
          page: pages,
          itemsInPage: items.length,
          offset: page.offset,
          hasMore: page.hasMore,
          totalCount: page.totalCount || 'unknown',
          receivedCount: page.receivedCount || items.length,
          totalSoFar: total
        }, 'CSV export - page processed');
        
        if (items.length === 0) {
          logger.info({
            totalExported: total,
            pages
          }, 'Finished exporting - no more records found');
          break;
        }
        
        const rows = useApiHeaders ? mapInventoryToApiRows(items) : mapInventoryToRows(items);
        writer.writeRows(rows);
        total += rows.length;
        
        if (page.lastUpdatedAt && (!previousWatermark || page.lastUpdatedAt > previousWatermark)) {
          try { await stateStore.set(watermarkKey, page.lastUpdatedAt); } catch (_) { /* ignore for CSV */ }
        }
        
        // Log progress every 10 pages
        if (pages % 10 === 0) {
          const elapsed = Date.now() - startedAt;
          const elapsedSeconds = Math.round(elapsed / 1000);
          logger.info({
            exported: total,
            pages,
            time: `${elapsedSeconds}s`,
            rate: total > 0 ? `${Math.round((total / (elapsed / 1000)) * 10) / 10} records/sec` : 'calculating...'
          }, `Exporting... ${total} records so far`);
        }
        
        if (maxPages > 0 && pages >= maxPages) {
          logger.info({ pages, totalExported: total }, 'Reached maximum page limit');
          break;
        }
      }
    } catch (iterError) {
      // Log iteration error but allow writer to close properly
      const status = iterError?.response?.status;
      if (status && status >= 500) {
        logger.warn({
          recordsExported: total,
          status
        }, 'Server temporarily unavailable - saved what we have so far');
      } else {
        logger.error({
          error: iterError.message,
          recordsExported: total
        }, 'Error while exporting');
      }
      throw iterError;
    }

    await writer.close();
    writer = null; // Mark as closed
    const tookMs = Date.now() - startedAt;
    const tookSeconds = Math.round(tookMs / 1000);
    const recordsPerSecond = total > 0 ? Math.round((total / (tookMs / 1000)) * 10) / 10 : 0;
    
    logger.info({
      file: filePath,
      records: total,
      time: `${tookSeconds}s`,
      rate: `${recordsPerSecond} records/sec`
    }, `✓ Export completed: ${total} records exported to ${filePath.split('/').pop()}`);
    
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ 
      level: 'info', 
      msg: 'Export completed successfully', 
      filePath, 
      records: total,
      time: `${tookSeconds}s`
    }));
    process.exit(0);
  } catch (e) {
    // Ensure writer is closed even on error
    if (writer) {
      try {
        await writer.close();
      } catch (closeError) {
        logger.error({ error: closeError.message }, 'Error closing CSV writer');
      }
    }
    logger.error({ error: e.message }, 'Export failed');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: 'Export failed', error: e.message }));
    process.exit(1);
  }
})();


