# Railway Deployment Guide

This guide will help you deploy the ShedSuite Inventory → Supabase sync service to Railway.

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **Supabase Project**: You need your Supabase project URL and service role key
3. **ShedSuite API Token**: Your ShedSuite API authentication token

## Step 1: Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo" (if your code is on GitHub) or "Empty Project"

## Step 2: Configure Environment Variables

In your Railway project, go to **Variables** tab and add these environment variables:

### Required Supabase Variables:
```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

To find these:
- Go to your Supabase Dashboard → Settings → API
- Copy the "Project URL" (this is your `SUPABASE_URL`)
- Copy the "service_role" secret key (this is your `SUPABASE_SERVICE_ROLE_KEY`)

### Required ShedSuite Variables:
```
SHEDSUITE_BASE_URL=https://app.shedsuite.com
SHEDSUITE_TOKEN=your_api_token_here
INVENTORY_LIST_PATH=/api/public/inventory/v1
INVENTORY_PAGE_SIZE=100
```

### Optional but Recommended:
```
LOG_LEVEL=info
PORT=8080
STATE_STORE=supabase
SYNC_SHARED_SECRET=your_secret_here  # For securing /sync/inventory endpoint
```

## Step 3: Database Setup

Before deployment, ensure the `inventory_items` table exists in your Supabase database:

1. Go to Supabase Dashboard → SQL Editor
2. Run the SQL from `sql/create_inventory_items_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS inventory_items (
  inventory_id text PRIMARY KEY,
  sku text,
  status text,
  location text,
  width_inches bigint,
  length_inches bigint,
  height_inches bigint,
  color text,
  material text,
  price double precision,
  cost double precision,
  created_at timestamptz,
  updated_at timestamptz,
  is_available boolean,
  vendor_name text,
  model text,
  synced_at timestamptz
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_synced_at ON inventory_items(synced_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
```

## Step 4: Deploy

### Option A: Deploy from GitHub (Recommended)

1. Connect your GitHub repository to Railway
2. Railway will automatically detect the project and use `Railway.toml`
3. The service will:
   - Build using Nixpacks
   - Start the web server on the configured port
   - Run hourly sync via cron (configured in `Railway.toml`)

### Option B: Deploy from CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to project or create new
railway link
# OR
railway new

# Deploy
railway up
```

## Step 5: Verify Deployment

Once deployed, check:

1. **Health Check**: Visit `https://your-service.railway.app/health`
   - Should return status and last sync time

2. **Manual Sync**: 
   - Via endpoint: `POST https://your-service.railway.app/sync/inventory`
   - If `SYNC_SHARED_SECRET` is set, include header: `x-sync-secret: your_secret_here`

3. **Logs**: Check Railway dashboard logs for sync progress

## Step 6: Monitor

- **Railway Dashboard**: Monitor service health, logs, and metrics
- **Supabase Dashboard**: Check the `inventory_items` table for synced data
- **Sync Schedule**: Runs every 15 minutes via cron (configured in `Railway.toml`)

## Troubleshooting

### Service won't start
- Check that all required environment variables are set
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
- Check logs for specific error messages

### Sync fails
- Verify `inventory_items` table exists in Supabase
- Check that `SHEDSUITE_TOKEN` is valid and has proper permissions
- Review sync logs for API errors or connection issues

### Table not found errors
- Ensure you've run the SQL migration to create `inventory_items` table
- Verify table name is exactly `inventory_items` (case-sensitive)

### Database connection errors
- Verify `SUPABASE_URL` format: `https://project-ref.supabase.co` (no trailing slash)
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is the service_role key, not the anon key

## Configuration Files

- **Railway.toml**: Railway deployment configuration (web service + cron)
- **.railway.json**: Alternative Railway config (optional)
- **package.json**: Node.js project configuration

## Sync Behavior

- **Watermark-based**: By default, only syncs items updated since last sync
- **Full Refresh**: Set `INVENTORY_FULL_REFRESH=true` to sync all items
- **Batch Size**: Processes 1000 items per batch (configurable)
- **Cleanup**: Deletes items from DB that weren't seen in current sync (ensures data consistency)

## Security Recommendations

1. **Set SYNC_SHARED_SECRET**: Protect the manual sync endpoint
2. **Use Service Role Key**: Keep `SUPABASE_SERVICE_ROLE_KEY` secure (don't commit to git)
3. **Review Logs**: Monitor for unauthorized access attempts
4. **Rate Limiting**: Consider adding rate limiting for production use

