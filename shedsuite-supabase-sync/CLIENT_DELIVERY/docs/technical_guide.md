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

### Self-Contained Architecture
- **Supabase Client Module** (`src/services/supabase-client.js`): Singleton database connection with lazy initialization
- **Logging System** (`src/utils/logger.js`): Comprehensive Winston-based logging with file rotation
- **Export Engine** (`scripts/client-export-solution.js`): Advanced pagination and duplicate prevention
- **User Interface** (`scripts/client-export.sh`): Bash wrapper for non-technical users

### Duplicate Prevention
- Tracks exported IDs in memory during export using JavaScript Set for O(1) lookups
- Filters duplicates in real-time before writing to files
- Provides duplicate analysis in reports with specific ID tracking
- Handles pagination edge cases and concurrent data modifications

### Data Validation
- Verifies export completeness by comparing expected vs actual record counts
- Checks file integrity with metadata validation
- Validates CSV structure and column consistency
- Provides detailed validation reports in JSON format

### Error Handling
- Automatic retry on network failures with exponential backoff capability
- Graceful error recovery with detailed error classification
- Comprehensive error logging with context-specific loggers
- Health check functionality for connection validation

### Performance Optimization
- Configurable batch sizes (default: 500 records per batch)
- Rate limiting to prevent database overload (200ms delay every 5 batches)
- Memory-efficient processing with streaming file writes
- Progress tracking with ETA calculations

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

## 🏗️ Architecture Overview

### Module Structure
```
src/
├── services/
│   └── supabase-client.js    # Database connection singleton
└── utils/
    └── logger.js            # Logging infrastructure

scripts/
├── client-export.sh         # Bash wrapper (user interface)
└── client-export-solution.js # Core export engine
```

### Database Connection (`src/services/supabase-client.js`)
- **Pattern**: Singleton with lazy initialization
- **Features**: 
  - Environment-based configuration with validation
  - Service role authentication for administrative access
  - Multi-tier health checking (RPC → table access → connection test)
  - Comprehensive error handling and logging
- **Key Methods**:
  - `client` getter: Lazy-loading database client
  - `healthCheck()`: Connection validation with intelligent error analysis

### Logging System (`src/utils/logger.js`)
- **Technology**: Winston with multiple transports
- **Features**:
  - File rotation (10MB files, 5 historical files)
  - Context-specific loggers (sync, api, database)
  - Console output with colors for development
  - JSON formatting for log analysis tools
- **Outputs**:
  - `logs/app.log`: All application logs
  - `logs/error.log`: Error-level logs only
  - Console: Real-time colored output

### Export Engine (`scripts/client-export-solution.js`)
- **Pattern**: Class-based with comprehensive error handling
- **Core Features**:
  - PostgreSQL sequence synchronization (fixes Supabase issues)
  - Real-time duplicate detection using JavaScript Set
  - Paginated data export with consistent ordering
  - CSV parsing with quote handling
  - Retry logic with exponential backoff capability
- **Key Classes**:
  - `ClientExportSolution`: Main export orchestrator
  - Methods: `exportTable()`, `exportWithPagination()`, `checkDuplicates()`

### User Interface (`scripts/client-export.sh`)
- **Technology**: Bash script with argument parsing
- **Features**:
  - Prerequisite checking (Node.js, npm, .env)
  - Colored output for better user experience
  - Progress monitoring and logging
  - Export summary with file statistics
- **Modes**: Preset configurations (all, recent, minimal) + custom options

### Data Flow
1. **Initialization**: Validate environment and database connection
2. **Sequence Fix**: Synchronize PostgreSQL sequences if needed
3. **Count**: Get accurate record count with filters
4. **Export**: Paginated data export with duplicate detection
5. **Validation**: Verify export completeness and integrity
6. **Reporting**: Generate comprehensive JSON reports

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