# 🔧 Technical Guide - Export Solution

## 🛠️ Quick Setup

### Prerequisites
- Node.js (version 14+)
- npm package manager
- Supabase database access

### Installation
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp environment_template.txt .env
# Edit .env with your Supabase credentials

# 3. Test the solution
./scripts/client-export.sh --preset recent
```

## 📋 Export Commands

### Simple Usage
```bash
# Export all data with validation
./scripts/client-export.sh --preset all

# Export recent data (last 30 days)
./scripts/client-export.sh --preset recent

# Fast export without validation
./scripts/client-export.sh --preset minimal
```

### Advanced Usage
```bash
# Custom date range
./scripts/client-export.sh --start 2024-01-01 --end 2024-12-31

# Custom batch size
./scripts/client-export.sh --batch 250

# Skip validation
./scripts/client-export.sh --no-validate --no-duplicates

# Custom output directory
./scripts/client-export.sh --output-dir ./my-exports
```

### Direct Node.js Usage
```bash
# Basic presets
node scripts/client-export-solution.js all
node scripts/client-export-solution.js recent

# Custom options
node scripts/client-export-solution.js custom --table shedsuite_orders --format csv
```

## 🔧 Configuration

### Environment Variables (.env)
```env
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional (with defaults)
EXPORT_BATCH_SIZE=500
EXPORT_OUTPUT_DIR=./exports
EXPORT_MAX_RETRIES=3
EXPORT_RETRY_DELAY=1000
CSV_TABLE_NAME=shedsuite_orders
```

## 📊 Technical Features

### Duplicate Prevention
- Tracks exported IDs in memory during export
- Filters duplicates in real-time
- Provides duplicate analysis in reports

### Data Validation
- Verifies export completeness
- Checks file integrity
- Validates record counts

### Error Handling
- Automatic retry on network failures
- Graceful error recovery
- Detailed error logging

### Performance Optimization
- Configurable batch sizes
- Rate limiting to prevent database overload
- Memory-efficient processing

## 📁 Output Files

After each export:
- **Data file**: `tablename_export_YYYY-MM-DD_id.csv`
- **Report file**: `export_report_id_YYYY-MM-DD.json`
- **Log file**: `export_YYYYMMDD-HHMMSS.log`

### Export Report Structure
```json
{
  "exportId": "unique_id",
  "success": true,
  "recordsExported": 98273,
  "filePath": "path/to/export.csv",
  "fileSizeMB": 87.64,
  "duration": 42000,
  "validation": {
    "expectedRecords": 98273,
    "actualRecords": 98273,
    "matches": true
  },
  "duplicates": {
    "duplicates": 0,
    "duplicateIds": []
  }
}
```

## 🚨 Troubleshooting

### Common Issues

**Permission Denied**
```bash
chmod +x scripts/client-export.sh
```

**Node.js Not Found**
- Install from nodejs.org
- Verify with: `node --version`

**Environment Issues**
- Check `.env` file exists and has correct credentials
- Verify Supabase URL format
- Test connection with a small export first

**Performance Issues**
- Reduce batch size: `--batch 250`
- Skip validation: `--no-validate`
- Check network connection

### Debugging Steps
1. Test with recent data first: `--preset recent`
2. Check export logs in `exports/` directory
3. Verify environment configuration
4. Test database connectivity

## 🔒 Security Considerations

### Environment Security
- Never commit `.env` files to version control
- Use service role key only when necessary
- Rotate API keys regularly

### Data Protection
- Export files contain sensitive data
- Store exports securely
- Delete temporary files after use
- Consider encryption for sensitive exports

## 📈 Performance Tuning

### For Large Datasets
```bash
# Smaller batches for better reliability
./scripts/client-export.sh --batch 250

# Skip validation for speed
./scripts/client-export.sh --no-validate --no-duplicates

# Export in chunks by date
./scripts/client-export.sh --start 2024-01-01 --end 2024-06-30
./scripts/client-export.sh --start 2024-07-01 --end 2024-12-31
```

### Environment Optimization
```env
# For slow connections
EXPORT_BATCH_SIZE=250
EXPORT_MAX_RETRIES=5
EXPORT_RETRY_DELAY=2000

# For fast connections
EXPORT_BATCH_SIZE=1000
EXPORT_MAX_RETRIES=3
EXPORT_RETRY_DELAY=500
```

## 🎯 Best Practices

### Regular Exports
- Set up scheduled exports if needed
- Monitor export logs for issues
- Validate export integrity regularly

### Data Management
- Keep recent exports for reference
- Archive old exports to save space
- Document export schedules and purposes

### Quality Assurance
- Always run validation on critical exports
- Review duplicate reports
- Test exports with sample data first

---

**This solution completely eliminates Supabase UI export issues and provides enterprise-grade data export capabilities.**