'use strict';

const { mapInventoryToRows } = require('../mapping/inventoryToRows');

async function syncInventory({
  config,
  logger,
  stateStore,
  shedsuiteClient,
  dbClient
}) {
  const startedAt = Date.now();
  const watermarkKey = 'inventory_watermark';
  const lastSuccessKey = 'inventory_last_success';
  const pageSize = config.shedsuite.inventory.pageSize;
  const runTimestampIso = new Date().toISOString();

  // Full refresh: ignore watermark; otherwise honor updatedSince
  let updatedSince = '';
  if (!config.shedsuite.inventory.fullRefresh) {
    const previousWatermark = await stateStore.get(watermarkKey);
    updatedSince = previousWatermark || config.shedsuite.inventory.updatedSince || '';
  }

  const batchSize = 1000;

  let totalFetched = 0;
  let totalPushed = 0;
  let newWatermark = null;
  let pageNumber = 0;
  let lastProgressLog = Date.now();
  const progressLogInterval = 10000; // Log progress every 10 seconds

  for await (const page of shedsuiteClient.iterateInventory({ pageSize, updatedSince })) {
    const items = page.items || [];
    pageNumber++;
    
    // Log progress periodically
    const now = Date.now();
    if (now - lastProgressLog >= progressLogInterval) {
      logger.info({
        pages: pageNumber,
        totalFetched,
        totalPushed,
        currentPageSize: items.length,
        offset: page.offset,
        estimatedTotal: page.totalCount || 'unknown',
        watermark: newWatermark,
        elapsedMs: now - startedAt
      }, 'Sync progress');
      lastProgressLog = now;
    }
    
    // Skip empty pages (they may still indicate completion)
    if (items.length === 0) {
      logger.debug({
        pageNumber,
        offset: page.offset,
        hasMore: page.hasMore,
        totalCount: page.totalCount || 'unknown'
      }, 'Empty page received');
      
      // If API says no more data, we're done
      if (!page.hasMore) {
        break;
      }
      // Otherwise continue to check next page
      continue;
    }
    
    totalFetched += items.length;

    const rows = mapInventoryToRows(items);
    const { inserted } = await dbClient.upsertInventoryRows(rows, batchSize, runTimestampIso);
    totalPushed += inserted;

    if (page.lastUpdatedAt && (!newWatermark || page.lastUpdatedAt > newWatermark)) {
      newWatermark = page.lastUpdatedAt;
      try { await stateStore.set(watermarkKey, newWatermark); } catch (_) { /* ignore if no state */ }
    }
    
    // Log each page completion (but less verbosely)
    if (pageNumber % 10 === 0 || items.length < pageSize) {
      logger.debug({
        page: pageNumber,
        itemsInPage: items.length,
        totalFetched,
        totalPushed,
        offset: page.offset,
        hasMore: page.hasMore,
        estimatedRemaining: page.totalCount ? Math.max(0, page.totalCount - totalFetched) : 'unknown'
      }, 'Page processed');
    }
  }

  // Remove any rows not seen in this run (ensures DB reflects latest dataset)
  const deleted = await dbClient.deleteNotSynced(runTimestampIso);

  const tookMs = Date.now() - startedAt;
  const recordsPerSecond = totalFetched > 0 ? Math.round((totalFetched / (tookMs / 1000)) * 10) / 10 : 0;
  
  try { await stateStore.set(lastSuccessKey, new Date().toISOString()); } catch (_) {}
  
  logger.info({ 
    totalFetched, 
    totalPushed, 
    deleted, 
    tookMs,
    tookSeconds: Math.round(tookMs / 1000),
    recordsPerSecond,
    pages: pageNumber,
    newWatermark,
    success: true
  }, 'Inventory sync completed');
  
  return { 
    totalFetched, 
    totalPushed, 
    deleted, 
    tookMs,
    recordsPerSecond,
    pages: pageNumber,
    newWatermark
  };
}

module.exports = { syncInventory };


