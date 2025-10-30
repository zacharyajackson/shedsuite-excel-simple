'use strict';

const axios = require('axios');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createShedSuiteClient(config, logger) {
  const baseURL = `${config.shedsuite.baseUrl}`.replace(/\/$/, '');
  const instance = axios.create({
    baseURL,
    timeout: 30000
  });

  async function requestWithRetry(opts, attempt = 1) {
    try {
      const useXApiKey = String(process.env.SHEDSUITE_USE_X_API_KEY || '').toLowerCase() === 'true';
      const headers = {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      };
      if (config.shedsuite.apiKey) {
        if (useXApiKey) headers['x-api-key'] = config.shedsuite.apiKey;
        else headers['Authorization'] = `Bearer ${config.shedsuite.apiKey}`;
      } else if (config.shedsuite.token) {
        headers['Authorization'] = `Bearer ${config.shedsuite.token}`;
      }
      return await instance.request({ ...opts, headers });
    } catch (err) {
      const status = err?.response?.status;
      const isRateLimited = status === 429;
      const isServerError = status >= 500 && status < 600;
      const isNetworkError = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
      const isRetryable = isRateLimited || isServerError || isNetworkError;
      
      // Configure retry attempts based on error type - reduced for server errors
      const maxAttempts = isRateLimited ? 10 : (isServerError ? 4 : 5); // Reduced server error retries from 8 to 4
      const maxBackoffMs = isRateLimited ? 60000 : (isServerError ? 30000 : 30000); // Reduced 500s timeout from 120s to 30s
      
      if (isRetryable && attempt < maxAttempts) {
        // Exponential backoff with jitter to prevent thundering herd
        const baseDelayMs = isRateLimited ? 1000 : (isServerError ? 2000 : 500);
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // Random 0-1000ms jitter
        const backoffMs = Math.min(maxBackoffMs, Math.floor(exponentialDelay + jitter));
        
        // Only log retries after 2 attempts, or immediately for rate limits
        // This reduces console noise while still providing useful feedback
        const shouldLog = isRateLimited || attempt >= 2;
        
        if (shouldLog) {
          const errorType = isRateLimited ? 'rate limit' : (isServerError ? 'server error' : 'network error');
          // More user-friendly message
          if (isServerError && attempt >= 3) {
            logger.warn({ 
              attempt: `${attempt}/${maxAttempts}`,
              seconds: Math.round(backoffMs / 1000)
            }, `Server temporarily unavailable, waiting ${Math.round(backoffMs / 1000)}s before retry...`);
          } else if (isRateLimited) {
            logger.warn({ 
              attempt: `${attempt}/${maxAttempts}`,
              seconds: Math.round(backoffMs / 1000)
            }, `Rate limit reached, waiting ${Math.round(backoffMs / 1000)}s...`);
          } else {
            // Only log at debug level for early attempts on server errors
            logger.debug({ 
              attempt, 
              maxAttempts,
              status,
              waiting: `${Math.round(backoffMs / 1000)}s`
            }, `Request failed (${errorType}), retrying...`);
          }
        }
        
        await sleep(backoffMs);
        return requestWithRetry(opts, attempt + 1);
      }
      
      // Log final failure with user-friendly message
      const errorType = isRetryable ? (isRateLimited ? 'rate limit' : (isServerError ? 'server error' : 'network error')) : 'error';
      if (isServerError) {
        logger.error({ 
          status,
          attempts: attempt
        }, `Server error after ${attempt} attempts - unable to complete request`);
      } else if (isRateLimited) {
        logger.error({ 
          status,
          attempts: attempt
        }, `Rate limit exceeded after ${attempt} attempts`);
      } else {
        logger.error({ 
          error: err.message,
          status
        }, 'Request failed');
      }
      throw err;
    }
  }

  async function fetchInventoryPage({ offset, limit, updatedSince, sortBy, sortOrder, hideDeleted }) {
    const urlPath = config.shedsuite.inventory.listPath || '/api/public/inventory/v1';
    const params = {};
    if (limit != null) params.limit = limit;
    if (offset != null) params.offset = offset;
    if (sortBy) params.sortBy = sortBy;
    if (sortOrder) params.sortOrder = sortOrder;
    if (hideDeleted !== undefined) params.hideDeleted = hideDeleted;
    // Only include updated_since if the API supports it for your tenant/version
    if (updatedSince) params.updated_since = updatedSince;

    const res = await requestWithRetry({ method: 'GET', url: urlPath, params });
    const payload = res.data;

    // Extract array payload robustly
    let items = [];
    let totalCount = null;
    let hasPaginationMetadata = false;
    
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && typeof payload === 'object') {
      // Look for pagination metadata first
      if (typeof payload.total === 'number' || typeof payload.totalCount === 'number' || typeof payload.count === 'number') {
        totalCount = payload.total || payload.totalCount || payload.count;
        hasPaginationMetadata = true;
      }
      if (typeof payload.hasMore === 'boolean' || typeof payload.has_more === 'boolean') {
        hasPaginationMetadata = true;
      }
      
      // Extract items array
      const candidateKeys = ['inventory', 'data', 'items', 'records', 'results', 'rows'];
      for (const k of candidateKeys) {
        if (Array.isArray(payload[k])) { 
          items = payload[k]; 
          break; 
        }
      }
      if (items.length === 0) {
        // Fallback: first array-valued property
        for (const [k, v] of Object.entries(payload)) {
          if (Array.isArray(v)) { 
            items = v; 
            break; 
          }
        }
      }
    }

    // Determine if there are more records to fetch
    // If we got fewer items than requested, we've reached the end
    const receivedLessThanRequested = limit != null && items.length < limit;
    
    // If we got exactly 0 items, we're done (even if limit was 0, which shouldn't happen)
    const noItems = items.length === 0;
    
    // If API provides explicit pagination metadata, use it
    let hasMore = false;
    if (hasPaginationMetadata && payload) {
      // Check explicit hasMore flag
      if (typeof payload.hasMore === 'boolean') {
        hasMore = payload.hasMore;
      } else if (typeof payload.has_more === 'boolean') {
        hasMore = payload.has_more;
      } else if (totalCount != null && offset != null && limit != null) {
        // Calculate from total count: if offset + items.length < totalCount, there's more
        hasMore = (offset + items.length) < totalCount;
      }
    } else {
      // Fallback: if we received exactly the limit amount, assume there might be more
      // This is conservative - we'll try one more request to confirm
      hasMore = !receivedLessThanRequested && !noItems;
    }

    const lastUpdatedAt = items.reduce((max, it) => {
      const ts = it.updatedAt || it.updated_at || it.updated || it.dateBuilt || null;
      if (!ts) return max;
      const d = new Date(ts).toISOString();
      return !max || d > max ? d : max;
    }, null);

    return { 
      items, 
      hasMore, 
      lastUpdatedAt,
      totalCount,
      offset,
      limit,
      receivedCount: items.length
    };
  }

  async function* iterateInventory({ pageSize, updatedSince }) {
    let offset = 0;
    const sortBy = 'dateBuilt';
    const sortOrder = 'desc';
    const hideDeleted = false;
    let consecutiveEmptyPages = 0;
    let totalYielded = 0;
    const maxEmptyPages = 2; // Stop after 2 consecutive empty pages (handles edge cases)
    let consecutiveApiNoMoreButHasData = 0;
    const maxApiMismatch = 3; // If API says "no more" but returns data 3 times, ignore API and keep going
    
    while (true) {
      let pageResult;
      try {
        pageResult = await fetchInventoryPage({
          offset,
          limit: pageSize,
          updatedSince,
          sortBy,
          sortOrder,
          hideDeleted
        });
      } catch (err) {
        // If we've already fetched some data and API fails during verification,
        // treat it as "no more data" and stop gracefully
        if (totalYielded > 0 && offset > 0) {
          if (logger) {
            logger.info({
              records: totalYielded
            }, `Finished exporting ${totalYielded} records`);
          }
          break;
        }
        // If this is the first request or we haven't gotten data yet, re-throw
        // to let the caller handle it
        throw err;
      }
      
      const { items, hasMore, lastUpdatedAt, totalCount, receivedCount } = pageResult;
      
      // Yield the page
      yield { 
        items, 
        lastUpdatedAt, 
        offset,
        hasMore,
        totalCount,
        receivedCount
      };
      
      totalYielded += items.length;
      
      // Track empty pages
      if (items.length === 0) {
        consecutiveEmptyPages++;
      } else {
        consecutiveEmptyPages = 0; // Reset counter on non-empty page
      }
      
      // Stop conditions (order matters - prioritize actual data over API metadata):
      // 
      // PRIMARY: If we received fewer items than requested, we've definitely reached the end
      // This is the most reliable indicator since it's based on actual returned data
      if (receivedCount < pageSize) {
        if (logger) {
          logger.debug({
            offset,
            totalYielded,
            receivedCount,
            expectedCount: pageSize,
            totalCount: totalCount || 'unknown',
            apiHasMore: hasMore,
            note: 'Reliable indicator: received fewer items than requested'
          }, 'Stopping: received fewer items than requested (definitive end of data)');
        }
        break;
      }
      
      // SECONDARY: If we got no items AND we've seen multiple empty pages, stop
      // This handles edge cases where API might return empty arrays inconsistently
      if (items.length === 0 && consecutiveEmptyPages >= maxEmptyPages) {
        if (logger) {
          logger.debug({
            offset,
            consecutiveEmptyPages,
            totalYielded,
            totalCount: totalCount || 'unknown',
            apiHasMore: hasMore,
            note: 'Multiple consecutive empty pages indicate end of data'
          }, 'Stopping: multiple consecutive empty pages');
        }
        break;
      }
      
      // TERTIARY: Handle API metadata that says "no more" but contradicts actual data
      // If API says "no more" but we got a full page, it might be stale metadata
      if (!hasMore && receivedCount === pageSize) {
        consecutiveApiNoMoreButHasData++;
        
        // If API keeps saying "no more" but keeps returning data, ignore API metadata
        if (consecutiveApiNoMoreButHasData >= maxApiMismatch) {
          if (logger) {
            logger.warn({
              offset,
              totalYielded,
              receivedCount,
              consecutiveMismatches: consecutiveApiNoMoreButHasData,
              totalCount: totalCount || 'unknown',
              note: 'API metadata unreliable - ignoring hasMore flag and continuing based on actual data'
            }, 'API says no more but continues returning data - ignoring API metadata');
          }
          // Reset counter and continue - we'll stop when we actually get fewer items
          consecutiveApiNoMoreButHasData = 0;
        } else {
          // First few times, log that we're verifying (at debug level to reduce noise)
          if (logger) {
            logger.debug({
              offset,
              totalYielded,
              verificationAttempt: consecutiveApiNoMoreButHasData
            }, 'Verifying if more data is available...');
          }
        }
        // Continue to fetch more - we'll stop when we actually get fewer items
      } else if (!hasMore && receivedCount < pageSize) {
        // API says no more AND we got fewer items - both conditions met, definitely stop
        if (logger) {
          logger.debug({
            offset,
            totalYielded,
            receivedCount,
            totalCount: totalCount || 'unknown',
            note: 'Both API and actual data confirm end'
          }, 'Stopping: API confirms end of data with partial page');
        }
        break;
      } else {
        // API says there's more data (hasMore=true) - reset mismatch counter
        consecutiveApiNoMoreButHasData = 0;
      }
      
      // Continue to next page
      offset += pageSize;
    }
  }

  return {
    fetchInventoryPage,
    iterateInventory
  };
}

module.exports = { createShedSuiteClient };


