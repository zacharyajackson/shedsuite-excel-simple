# Power BI Query Scripts

This directory contains Power BI M query scripts for connecting to Supabase inventory data.

## Files

- **`power-query-inventory.m`** - Main M query script for inventory data
- **`POWERBI_SETUP.md`** - Complete setup guide with step-by-step instructions
- **`README.md`** - This file (quick reference)

## Quick Start

1. Open `power-query-inventory.m`
2. Update `ApiBase` and `ApiKey` at the top
3. In Power BI Desktop: Get Data → Blank Query → Advanced Editor
4. Paste the script and click Done

## What It Does

✅ Connects to Supabase REST API  
✅ Fetches all inventory records from `inventory_items` table  
✅ Handles pagination automatically (cursor-based)  
✅ Sets correct data types  
✅ De-duplicates records  
✅ Refresh-safe for Power BI Service

## Data Refresh

The query automatically refreshes when:
- You refresh manually in Power BI Desktop (F5 or Refresh button)
- Scheduled refresh runs in Power BI Service (configure in dataset settings)

The sync service on Railway updates Supabase hourly, so your Power BI data will be refreshed from the latest synced inventory.

## Support

See `POWERBI_SETUP.md` for detailed setup instructions and troubleshooting.

