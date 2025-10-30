# Power BI Setup Guide - ShedSuite Inventory

This guide will help you connect Power BI Desktop to your Supabase inventory data using the provided M query script.

## Prerequisites

- Power BI Desktop installed (latest version recommended)
- Supabase project URL
- Supabase anon key (not the service role key!)

## Step 1: Get Supabase Credentials

1. Go to your Supabase Dashboard
2. Navigate to **Settings** → **API**
3. Copy the following:
   - **Project URL**: `https://your-project-ref.supabase.co`
   - **anon/public key**: The `anon` key (NOT the `service_role` key)

## Step 2: Prepare the M Query Script

1. Open the file: `scripts/power-query-inventory.m`
2. Find these two lines near the top:
   ```m
   ApiBase   = "https://your-project.supabase.co",  // Replace with your Supabase URL
   ApiKey    = "your_anon_key_here",                 // Replace with your Supabase anon key
   ```
3. Replace with your actual values:
   ```m
   ApiBase   = "https://xyzabc123.supabase.co",     // Your Supabase URL
   ApiKey    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // Your anon key
   ```

## Step 3: Import Data into Power BI Desktop

### Option A: Using Blank Query (Recommended)

1. Open **Power BI Desktop**
2. Click **Get Data** → **Blank Query**
3. In the Power Query Editor:
   - Click **Home** → **Advanced Editor**
   - Delete any existing code
   - Paste the entire contents of `power-query-inventory.m`
   - Click **Done**
4. Power BI will execute the query and load your inventory data

### Option B: Using Web Connector

1. Open **Power BI Desktop**
2. Click **Get Data** → **Web**
3. Enter: `https://your-project.supabase.co/rest/v1/inventory_items?limit=1`
4. Click **OK**
5. When prompted for authentication:
   - Select **Anonymous** (or provide headers)
   - Or switch to **Advanced Editor** and paste the M query script

## Step 4: Configure Data Source Settings (For Refresh)

After importing, configure credentials for scheduled refresh:

1. In Power BI Desktop: **File** → **Options and settings** → **Data source settings**
2. Find your Supabase connection
3. Click **Edit Permissions**
4. Set authentication method:
   - **Anonymous**: Works for public tables with RLS disabled
   - **Key**: Use your anon key if RLS is enabled

## Step 5: Transform Data (Optional)

The query automatically:
- ✅ Handles pagination (fetches all records)
- ✅ Sets correct data types (numbers, dates, booleans)
- ✅ De-duplicates by `inventory_id`
- ✅ Loads all columns from `inventory_items` table

You can add additional transformations in Power Query Editor:
- Filter rows (e.g., `status = "available"`)
- Add calculated columns
- Create relationships with other tables

## Step 6: Publish to Power BI Service

1. Click **Publish** (or **File** → **Publish** → **Publish to Power BI**)
2. Select your workspace
3. After publishing, configure **Scheduled Refresh**:
   - Go to Power BI Service
   - Find your dataset → **Settings** → **Scheduled refresh**
   - Enable scheduled refresh
   - Set refresh frequency (e.g., hourly, daily)

## Troubleshooting

### Error: "DataSource.Error: Web.Contents failed"
- **Check**: Supabase URL is correct and includes `https://`
- **Check**: Anon key is valid (not service role key)
- **Check**: `inventory_items` table exists in Supabase

### Error: "Formula.Firewall: Query cannot be merged"
- **Fix**: In Power BI Desktop → **File** → **Options** → **Privacy**
- Set privacy level to **"Always ignore Privacy Level settings"** (for development)
- Or configure proper privacy levels for each data source

### Data not refreshing in Power BI Service
- **Check**: Gateway is configured (if using on-premises data gateway)
- **Check**: Data source credentials are set in Power BI Service
- **Check**: Refresh schedule is enabled

### Slow Performance
- **Reduce PageSize**: Change `PageSize = 1000` to `PageSize = 500` in the query
- **Add Filters**: Filter data at the source level using Supabase query parameters
- **Limit Columns**: Modify the `select` parameter to only fetch needed columns

### Missing Data
- **Check**: Sync service has run successfully (check Railway logs)
- **Verify**: Data exists in Supabase (run SQL query: `SELECT COUNT(*) FROM inventory_items`)
- **Check**: Sync timestamp (`synced_at`) is recent

## Advanced: Incremental Refresh (Optional)

For large datasets, you can configure incremental refresh:

1. In Power Query Editor: **Home** → **Manage Parameters** → **New Parameter**
2. Create parameter: `LastRefreshDate` (Date type)
3. Modify the query to filter `synced_at >= LastRefreshDate`
4. In Power BI Desktop: **Table** → **Incremental Refresh**
5. Configure:
   - Archive data older than: 2 years
   - Refresh data in the range: Last 30 days

## Column Reference

| Column Name | Type | Description |
|------------|------|-------------|
| `inventory_id` | Text | Primary key |
| `sku` | Text | Stock keeping unit |
| `status` | Text | Item status (e.g., "available", "sold") |
| `location` | Text | Physical location/warehouse |
| `width_inches` | Integer | Width in inches |
| `length_inches` | Integer | Length in inches |
| `height_inches` | Integer | Height in inches |
| `color` | Text | Color name |
| `material` | Text | Material type |
| `price` | Number | Selling price |
| `cost` | Number | Cost price |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |
| `is_available` | Boolean | Availability flag |
| `vendor_name` | Text | Vendor name |
| `model` | Text | Model name |
| `synced_at` | DateTime | Last sync timestamp |

## Security Notes

⚠️ **Important**:
- Use the **anon key** (not service_role key) for Power BI
- The anon key should have Row Level Security (RLS) configured if needed
- For production, consider setting up RLS policies in Supabase
- Never commit the anon key to version control

## Support

If you encounter issues:
1. Check Railway service logs for sync status
2. Verify Supabase table structure matches expected schema
3. Test the Supabase REST API directly: `https://your-project.supabase.co/rest/v1/inventory_items?limit=10`

