# ShedSuite to Supabase Sync Tool

A simple, self-contained tool to sync all your ShedSuite data to Supabase.

## 🚀 Quick Start

### 1. Setup Database
First, run the database setup to create the table in Supabase:

```bash
node setup-database.js
```

Copy the SQL output and run it in your Supabase SQL Editor.

### 2. Run Full Sync (One Time)
To fetch ALL your ShedSuite data and sync it to Supabase:

```bash
node start-sync.js full
```

This will:
- ✅ Fetch ALL records from ShedSuite (paginated)
- ✅ Transform the data to match your table schema
- ✅ Upsert all records to Supabase (no duplicates)
- ✅ Show progress and summary

### 3. Run Continuous Sync (Optional)
To keep your data updated continuously:

```bash
# Run continuous sync every 5 minutes (default)
node start-sync.js continuous

# Run continuous sync every 10 minutes
node start-sync.js continuous 10

# Run single sync of recent changes
node start-sync.js once

# Or use the convenience script
./run-continuous.sh 5
```

This will:
- ✅ **Smart deduplication** - No duplicate records
- ✅ **Incremental updates** - Only sync changed records
- ✅ **Timestamp tracking** - Knows what's already synced
- ✅ **Efficient processing** - Batched operations
- ✅ **Detailed logging** - See exactly what's happening
- ✅ **Error recovery** - Handles failures gracefully

Press `Ctrl+C` to stop.

## 📋 Commands

| Command | Description |
|---------|-------------|
| `node start-sync.js full` | One-time full sync of all data |
| `node start-sync.js continuous [minutes]` | Continuous sync (default: 5 minutes) |
| `node start-sync.js once` | Single sync of recent changes |
| `./run-continuous.sh [minutes]` | Run continuous sync with logging |
| `node start-sync.js` | Shows usage help |

## 🔧 Configuration

Make sure your `.env` file has:

```env
SHEDSUITE_API_BASE_URL=https://app.shedsuite.com
SHEDSUITE_API_TOKEN=your_token_here
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 📊 What It Does

### Full Sync:
1. **Fetches ALL data** from ShedSuite API (paginated)
2. **Transforms data** to match your table schema
3. **Upserts to Supabase** (inserts new records, updates existing ones)
4. **No duplicates** - uses record ID as the conflict resolution key

### Continuous Sync:
1. **Smart deduplication** - Checks existing records before inserting
2. **Incremental updates** - Only fetches records changed since last sync
3. **Timestamp tracking** - Maintains sync metadata in database
4. **Efficient batching** - Processes records in optimal batches
5. **Error recovery** - Handles failures and continues operation

## 🎯 Result

Your Supabase `shedsuite_orders` table will contain:
- ✅ All your ShedSuite order data
- ✅ Properly formatted fields
- ✅ No duplicates
- ✅ Always up-to-date (if using continuous sync)

## 🛠️ Troubleshooting

- **Missing environment variables**: Check your `.env` file
- **Database errors**: Make sure you ran the setup SQL in Supabase
- **API errors**: Check your ShedSuite API token
- **No data**: The tool will show you exactly what's happening

## 📈 Monitoring

The tool provides detailed logging:
- 📄 Shows each page being fetched
- 🔄 Shows transformation progress
- ✅ Shows sync results
- ❌ Shows any errors clearly

That's it! Simple, self-contained, and does exactly what you need. 🎉 