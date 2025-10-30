# ShedSuite Inventory → Supabase Service

Express service that syncs ShedSuite Inventory data into a Supabase Postgres table on a schedule.

## Endpoints
- GET `/health` – service status and last successful sync timestamp
- POST/GET `/sync/inventory` – run sync now (optionally secured via `x-sync-secret`)

## Configuration

### Step 1: Environment Setup
Copy `env.sample` to `.env` and set values:

**Required for Supabase:**
- `SUPABASE_URL` - Your Supabase project URL (format: `https://your-project-ref.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key from Supabase Dashboard → Settings → API

**ShedSuite API:**
- `SHEDSUITE_BASE_URL`, `SHEDSUITE_TOKEN`
- `INVENTORY_PAGE_SIZE`, `INVENTORY_UPDATED_SINCE`

**State Store:**
- `STATE_STORE` (= `memory` | `postgres` | `supabase`)
- `DATABASE_URL` (optional if using `SUPABASE_URL`)

**Security (optional):**
- `SYNC_SHARED_SECRET`

### Step 2: Create Database Table
Before running the sync, you need to create the `inventory_items` table in your Supabase database:

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Run the SQL from `sql/create_inventory_items_table.sql` or execute:

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
```

## Run locally
```bash
npm i
npm start
# or run headless
npm run sync
```

## Deployment (Railway)

### Quick Start
1. Create a Railway project and connect your repository
2. Set required environment variables (see `env.sample`)
3. Create the `inventory_items` table in Supabase (see Step 2 above)
4. Deploy - Railway will automatically:
   - Start the web service on port 8080
   - Run sync every 15 minutes via cron job (`npm run sync`)

### Detailed Instructions
See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for complete deployment guide.

### Configuration Files
- `Railway.toml` - Railway deployment config (web service + hourly cron)
- `.railway.json` - Alternative Railway config (optional)

### After Deployment
- **Health Check**: `GET /health` - Check service status
- **Manual Sync**: `POST /sync/inventory` - Trigger sync immediately
- **Logs**: Monitor via Railway dashboard

## Notes
- Table `inventory_items` must be created manually in Supabase (see Step 2 above).
- Upserts use `inventory_id` as the primary key conflict resolution.
- Watermark state is stored via `STATE_STORE`. For Supabase, set `STATE_STORE=supabase` and ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- The service uses the Supabase JS client for all database operations, matching the pattern used in `CLIENT_DELIVERY`.
