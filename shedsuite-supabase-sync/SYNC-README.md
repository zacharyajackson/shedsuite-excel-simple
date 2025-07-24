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
node start-sync.js continuous
```

This will:
- ✅ Run every 5 minutes
- ✅ Only fetch recent records
- ✅ Update existing records in Supabase
- ✅ No appending, just updates

Press `Ctrl+C` to stop.

## 📋 Commands

| Command | Description |
|---------|-------------|
| `node start-sync.js full` | One-time full sync of all data |
| `node start-sync.js continuous` | Continuous sync (updates every 5 minutes) |
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

1. **Fetches ALL data** from ShedSuite API (paginated)
2. **Transforms data** to match your table schema
3. **Upserts to Supabase** (inserts new records, updates existing ones)
4. **No duplicates** - uses record ID as the conflict resolution key
5. **Continuous updates** - keeps your data fresh

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