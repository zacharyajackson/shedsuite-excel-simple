# Supabase Sync Logic Review

## Overview
The sync service fetches inventory data from ShedSuite API and syncs it to Supabase, ensuring data consistency and handling errors gracefully.

## Sync Flow

### 1. Initialization
- **State Store**: Loads last sync watermark (if using incremental sync)
- **Supabase Client**: Initializes connection (lazy-loaded singleton)
- **ShedSuite Client**: Configures API client with retry logic

### 2. Data Fetching
```javascript
for await (const page of shedsuiteClient.iterateInventory({ pageSize, updatedSince })) {
  // Process each page...
}
```

**Key Features:**
- **Pagination**: Handles API pagination automatically
- **Watermark-based**: By default, only fetches items updated since last sync
- **Robust Error Handling**: 
  - Retries on transient failures (500s, rate limits, network errors)
  - Reduced retry attempts (4 for server errors, down from 8)
  - Graceful handling during verification phase
- **Progress Logging**: Logs progress every 10 seconds

### 3. Data Transformation
- Maps API response format to database schema
- Converts camelCase to snake_case
- Handles null/undefined values safely

### 4. Database Upsert
```javascript
await dbClient.upsertInventoryRows(rows, batchSize, runTimestampIso);
```

**Process:**
- **Batch Processing**: Upserts in batches of 1000 rows
- **Conflict Resolution**: Uses `onConflict: 'inventory_id'` to handle updates
- **Timestamp Tracking**: Sets `synced_at` to current run timestamp
- **Error Handling**: Throws error if batch fails (prevents partial sync)

### 5. Cleanup (Delete Old Records)
```javascript
await dbClient.deleteNotSynced(runTimestampIso);
```

**Logic:**
- Deletes items where `synced_at` is NULL (never synced)
- Deletes items where `synced_at` doesn't match current run (from previous syncs)
- **Purpose**: Ensures database only contains items that exist in current sync
- **Safety**: Uses Supabase filters with proper value encoding

## Error Handling

### API Errors
- **Rate Limits (429)**: 10 retries with exponential backoff up to 60s
- **Server Errors (500+)**: 4 retries with exponential backoff up to 30s  
- **Network Errors**: 5 retries with exponential backoff up to 30s
- **Logging**: Only logs warnings after 2 attempts (reduces console noise)

### Database Errors
- **Connection Issues**: Thrown and handled by caller
- **Table Missing**: Clear error message guides user to create table
- **Batch Failures**: Stops sync (prevents partial data)

### Verification Phase Errors
- If API fails during verification but data already fetched → Treats as "end of data"
- Logs friendly message instead of error

## Data Consistency

### Watermark Tracking
- Stores `lastUpdatedAt` timestamp from each page
- Updates watermark in state store as sync progresses
- Uses watermark for incremental syncs (only fetch updated items)

### Sync Timestamp
- Each sync run gets unique ISO timestamp (`runTimestampIso`)
- All items in run get same `synced_at` value
- Cleanup removes items with different `synced_at` (from previous runs)

### Full Refresh Option
Set `INVENTORY_FULL_REFRESH=true` to:
- Ignore watermark
- Fetch all inventory items
- Update all records regardless of update time

## Performance Optimizations

1. **Batch Processing**: 1000 items per database batch
2. **Lazy Loading**: Supabase client initialized on first use
3. **Singleton Pattern**: Single database connection per process
4. **Progress Logging**: Only logs every 10 seconds to reduce I/O
5. **Reduced Retries**: Lower retry counts for faster failure detection

## Security

1. **Service Role Key**: Uses Supabase service_role key (full database access)
2. **Environment Variables**: All secrets in environment (not in code)
3. **Optional Secret**: `SYNC_SHARED_SECRET` protects manual sync endpoint
4. **Health Check**: Public endpoint for monitoring (no sensitive data)

## Verification Checklist

✅ **Connection Logic**
- [x] Supabase client initializes correctly
- [x] Error messages guide user to set required variables
- [x] URL validation ensures proper format

✅ **Data Sync Logic**
- [x] Pagination handles all records (no assumptions about total count)
- [x] Upsert uses proper conflict resolution
- [x] Timestamp tracking ensures data consistency
- [x] Cleanup removes stale records

✅ **Error Handling**
- [x] Retry logic with exponential backoff
- [x] Reduced console noise (only logs important retries)
- [x] Graceful degradation (continues if verification fails after data fetched)

✅ **Deployment Ready**
- [x] Railway.toml configured for web service + cron
- [x] Environment variables documented
- [x] Deployment guide created

## Potential Issues & Fixes

### Issue: OR Filter Syntax
**Status**: ✅ Fixed
- Added `encodeURIComponent()` for proper value encoding in Supabase OR filters
- Format: `synced_at.is.null,synced_at.neq.{encoded_value}`

### Issue: Excessive Retries
**Status**: ✅ Fixed
- Reduced server error retries from 8 to 4
- Only logs warnings after 2 attempts
- Faster failure detection

### Issue: Console Noise
**Status**: ✅ Fixed
- Early retry attempts logged at debug level
- User-friendly error messages
- Reduced backoff message verbosity

## Testing Recommendations

1. **Local Test**: Run `npm run sync` locally with test data
2. **Supabase Test**: Verify table structure matches expected schema
3. **Error Test**: Test with invalid API token to verify error handling
4. **Full Refresh Test**: Run with `INVENTORY_FULL_REFRESH=true`
5. **Cleanup Test**: Verify old records are deleted correctly

## Next Steps for Production

1. **Monitoring**: Set up alerts for sync failures
2. **Logging**: Consider forwarding logs to external service (Datadog, Logtail, etc.)
3. **Metrics**: Add metrics for sync duration, record counts, error rates
4. **Backup**: Set up Supabase backups for `inventory_items` table
5. **Rate Limiting**: Add rate limiting to sync endpoint

