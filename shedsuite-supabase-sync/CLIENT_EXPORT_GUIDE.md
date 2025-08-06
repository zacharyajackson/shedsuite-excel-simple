# Client Export Guide - Supabase Data Export Solution

## 🚀 Overview

This guide provides a comprehensive solution for exporting data from your Supabase database without the duplication and incomplete export issues commonly experienced with the Supabase UI export feature.

### Why This Solution?

The Supabase UI export has known issues:
- **Duplicate entries** in exported data
- **Incomplete exports** for large datasets
- **Sequence/primary key conflicts** after imports
- **Pagination inconsistencies** during large exports
- **Memory limitations** in browser-based exports

Our solution addresses all these issues with:
- ✅ Proper pagination with consistent ordering
- ✅ Duplicate detection and prevention
- ✅ Sequence synchronization
- ✅ Data validation and integrity checks
- ✅ Comprehensive export reports
- ✅ Multiple export formats (CSV, JSON)

## 📋 Prerequisites

Before using the export solution, ensure you have:

1. **Node.js** (version 14 or higher)
2. **npm** (comes with Node.js)
3. **Access to your Supabase project** (API keys)
4. **Environment configuration** (`.env` file)

### Checking Prerequisites

```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Verify .env file exists
ls -la .env
```

## 🛠️ Setup

### 1. Environment Configuration

Ensure your `.env` file contains the necessary Supabase credentials:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Export Configuration (optional)
EXPORT_BATCH_SIZE=500
EXPORT_OUTPUT_DIR=./client-exports
EXPORT_MAX_RETRIES=3
EXPORT_RETRY_DELAY=1000
```

### 2. Install Dependencies

If you haven't already, install the required dependencies:

```bash
npm install
```

## 🚀 Quick Start

### Option 1: Simple Shell Script (Recommended)

The easiest way to export your data is using the provided shell script:

```bash
# Export all data with full validation
./scripts/client-export.sh --preset all

# Export recent data (last 30 days)
./scripts/client-export.sh --preset recent

# Export with minimal validation (faster)
./scripts/client-export.sh --preset minimal
```

### Option 2: Direct Node.js Script

For more control, use the Node.js script directly:

```bash
# Export all data
node scripts/client-export-solution.js all

# Export recent data
node scripts/client-export-solution.js recent

# Custom export
node scripts/client-export-solution.js custom --table shedsuite_orders --format csv
```

## 📊 Export Presets

### All Data Export (`--preset all`)
- Exports all records from the `shedsuite_orders` table
- Includes full data validation
- Performs duplicate checking
- Generates comprehensive reports
- **Best for**: Complete data migration or backup

### Recent Data Export (`--preset recent`)
- Exports data from the last 30 days
- Includes validation and duplicate checking
- **Best for**: Regular data updates or recent analysis

### Minimal Export (`--preset minimal`)
- Exports all data without validation
- Skips duplicate checking for speed
- **Best for**: Quick exports when you trust data integrity

## 🔧 Custom Export Options

### Basic Custom Export

```bash
# Export specific table
./scripts/client-export.sh --table shedsuite_orders

# Export with date range
./scripts/client-export.sh --table shedsuite_orders --start 2024-01-01 --end 2024-12-31

# Export in JSON format
./scripts/client-export.sh --table shedsuite_orders --format json
```

### Advanced Options

```bash
# Custom batch size (default: 500)
./scripts/client-export.sh --table shedsuite_orders --batch 1000

# Skip validation for speed
./scripts/client-export.sh --table shedsuite_orders --no-validate

# Skip duplicate checking
./scripts/client-export.sh --table shedsuite_orders --no-duplicates

# Custom output directory
./scripts/client-export.sh --table shedsuite_orders --output-dir ./my-exports
```

## 📁 Output Files

After a successful export, you'll find the following files in the `client-exports` directory:

### Data Files
- `shedsuite_orders_export_YYYY-MM-DD_<id>.csv` - Main export file
- `shedsuite_orders_export_YYYY-MM-DD_<id>.json` - JSON format (if selected)

### Report Files
- `export_report_<id>_YYYY-MM-DD.json` - Comprehensive export report
- `export_YYYYMMDD-HHMMSS.log` - Detailed execution log

### Export Report Contents

The export report includes:
- Export metadata (table, format, date range)
- Record counts (expected vs actual)
- File sizes and processing times
- Validation results
- Duplicate analysis
- Sequence synchronization status

## 🔍 Understanding the Export Process

### Step-by-Step Process

1. **Table Validation** - Verifies table exists and gets schema
2. **Sequence Check** - Fixes any sequence/primary key issues
3. **Record Counting** - Gets accurate record counts with filters
4. **Data Export** - Exports data with proper pagination
5. **Validation** - Verifies export integrity
6. **Duplicate Check** - Analyzes for duplicate entries
7. **Report Generation** - Creates comprehensive export report

### Key Features

#### Consistent Ordering
- Uses `ORDER BY id ASC` for consistent pagination
- Prevents overlapping data between batches
- Ensures complete export coverage

#### Duplicate Prevention
- Tracks exported IDs in memory
- Filters out duplicates during export
- Provides duplicate analysis report

#### Sequence Synchronization
- Automatically detects sequence issues
- Resets sequences to prevent future conflicts
- Common fix for "duplicate key" errors

#### Retry Logic
- Handles temporary network issues
- Configurable retry attempts and delays
- Graceful error handling

## 🚨 Troubleshooting

### Common Issues

#### 1. "Table validation failed"
**Cause**: Table doesn't exist or no access
**Solution**: 
- Verify table name is correct
- Check Supabase credentials in `.env`
- Ensure proper permissions

#### 2. "No records found"
**Cause**: Filters too restrictive or empty table
**Solution**:
- Check date range filters
- Verify table has data
- Try without filters first

#### 3. "Export failed after X retries"
**Cause**: Network issues or database overload
**Solution**:
- Reduce batch size (`--batch 250`)
- Increase retry delay in `.env`
- Check database performance

#### 4. "Permission denied" on script
**Solution**:
```bash
chmod +x scripts/client-export.sh
```

### Performance Optimization

#### For Large Datasets
```bash
# Use smaller batch size
./scripts/client-export.sh --batch 250

# Skip validation for speed
./scripts/client-export.sh --no-validate --no-duplicates

# Export in chunks by date
./scripts/client-export.sh --start 2024-01-01 --end 2024-03-31
./scripts/client-export.sh --start 2024-04-01 --end 2024-06-30
```

#### Environment Variables
```env
# Reduce batch size for slower connections
EXPORT_BATCH_SIZE=250

# Increase retry attempts
EXPORT_MAX_RETRIES=5

# Increase retry delay
EXPORT_RETRY_DELAY=2000
```

## 📈 Monitoring and Logs

### Log Files
- **Location**: `client-exports/export-YYYYMMDD-HHMMSS.log`
- **Contents**: Detailed execution log with timestamps
- **Use**: Debugging and monitoring export progress

### Progress Indicators
The export shows real-time progress:
```
📦 Batch 15/50 (30.0%) - 500 records (1200ms) - ETA: 42s
```

### Export Summary
After completion, you'll see:
```
✅ EXPORT COMPLETED SUCCESSFULLY!
================================
📊 Records exported: 25,000
📁 File: ./client-exports/shedsuite_orders_export_2024-01-15_abc123.csv
📏 Size: 15.2MB
⏱️  Duration: 45.3s
📋 Report: ./client-exports/export_report_abc123_2024-01-15.json
```

## 🔒 Security Considerations

### Data Protection
- Export files contain sensitive data
- Store securely and limit access
- Consider encryption for sensitive exports
- Delete temporary files after use

### API Key Security
- Never commit `.env` files to version control
- Use service role key only when necessary
- Rotate keys regularly
- Monitor API usage

## 📞 Support

### Getting Help

1. **Check the logs**: Review `export-YYYYMMDD-HHMMSS.log`
2. **Verify configuration**: Ensure `.env` file is correct
3. **Test with small dataset**: Use `--preset test` first
4. **Check prerequisites**: Verify Node.js and npm versions

### Common Commands for Debugging

```bash
# Check environment
node --version
npm --version
ls -la .env

# Test connection
node -e "require('dotenv').config(); console.log('SUPABASE_URL:', process.env.SUPABASE_URL)"

# Run with verbose logging
DEBUG=* node scripts/client-export-solution.js all

# Check export directory
ls -la client-exports/
```

## 📚 Additional Resources

### Database Functions
The solution includes SQL functions for sequence management:
- `reset_sequence()` - Fix sequence issues
- `check_sequence_status()` - Verify sequence health
- `fix_all_sequences()` - Fix all sequences in schema
- `analyze_duplicates()` - Analyze duplicate data

### Related Documentation
- [Supabase Export Issues](https://supabase.com/docs/guides/troubleshooting/inserting-into-sequenceserial-table-causes-duplicate-key-violates-unique-constraint-error-pi6DnC)
- [PostgreSQL Sequence Management](https://www.postgresql.org/docs/current/functions-sequence.html)
- [CSV Export Best Practices](https://supabase.com/blog/partial-postgresql-data-dumps-with-rls)

---

**Note**: This solution is specifically designed to address the known limitations of Supabase UI exports. It provides a reliable, validated, and complete data export process that you can trust for your business needs. 