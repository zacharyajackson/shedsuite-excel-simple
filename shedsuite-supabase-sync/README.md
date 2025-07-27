# ShedSuite Supabase Sync Service

A standalone service that synchronizes data from the ShedSuite API to Supabase, providing real-time data integration with robust error handling and monitoring capabilities.

## Features

- 🔄 **Real-time Sync**: Automated data synchronization with configurable intervals
- 🛡️ **Error Handling**: Comprehensive error categorization and retry mechanisms
- 📊 **Monitoring**: Health checks, metrics, and detailed logging
- 🚀 **Performance**: Batch processing and optimized database operations
- 🔧 **Flexible Configuration**: Environment-based configuration management
- 🐳 **Docker Support**: Containerized deployment with Docker and Docker Compose
- 🚂 **Railway Deployment**: One-click deployment to Railway for continuous operation
- 📈 **Statistics**: Detailed sync statistics and performance metrics

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   ShedSuite     │    │   Sync Service   │    │    Supabase     │
│      API        │───▶│   (Node.js)      │───▶│   Database      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   REST API       │
                       │   (Monitoring)   │
                       └──────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- Supabase project with database access
- ShedSuite API credentials

### 1. Clone and Setup

```bash
git clone <repository-url>
cd shedsuite-supabase-sync
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```bash
# ShedSuite API Configuration
SHEDSUITE_API_BASE_URL=https://api.shedsuite.com
SHEDSUITE_API_TOKEN=your_shedsuite_api_token_here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Sync Configuration
SYNC_INTERVAL_MINUTES=15
BATCH_SIZE=100
ENABLE_REAL_TIME_SYNC=true
ENABLE_INITIAL_TEST_SYNC=false
```

### 3. Database Setup

Run the database migrations in your Supabase project:

```bash
# Copy the migration file content and run it in your Supabase SQL editor
cat migrations/001_initial_schema.sql
```

### 4. Start the Service

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The service will be available at `http://localhost:3001`

## Railway Deployment (Recommended for Production)

For continuous operation in production, deploy to Railway:

### Quick Railway Deployment

1. **Connect to Railway**: Go to [railway.app](https://railway.app) and connect your GitHub repository
2. **Configure Environment Variables**: Add your API keys and configuration in Railway dashboard
3. **Deploy**: Railway will automatically build and deploy your service

### Railway Configuration

The project includes `railway.json` with optimized settings for Railway deployment:

- **Automatic Health Checks**: Monitors service health every 30 seconds
- **Restart Policy**: Automatically restarts on failure
- **Production Optimizations**: Pre-configured for production environments
- **Continuous Sync**: Runs every 15 minutes without initial test sync

### Production Deployment

For production deployment without test sync, use the provided script:

```bash
# Deploy with production settings
./scripts/deploy-production.sh
```

This script:
- Sets `NODE_ENV=production`
- Disables initial test sync (`ENABLE_INITIAL_TEST_SYNC=false`)
- Skips connection tests for faster startup (`SKIP_CONNECTION_TESTS=true`)
- Deploys to Railway with optimized settings

### Environment Variables for Railway

Copy from `railway.env.example` and configure in Railway dashboard:

```bash
# Required
SHEDSUITE_API_BASE_URL=https://api.shedsuite.com
SHEDSUITE_API_TOKEN=your_actual_shedsuite_api_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Production Settings
NODE_ENV=production
ENABLE_REAL_TIME_SYNC=true
SYNC_INTERVAL_MINUTES=15
```

### Railway Benefits

- ✅ **Continuous Operation**: 24/7 uptime with automatic restarts
- ✅ **Zero Downtime**: Automatic deployments and health monitoring
- ✅ **Scalability**: Automatic scaling based on traffic
- ✅ **Monitoring**: Built-in logs and metrics
- ✅ **SSL/TLS**: Automatic HTTPS certificates

For detailed Railway deployment instructions, see [RAILWAY-DEPLOYMENT.md](./RAILWAY-DEPLOYMENT.md).

## Docker Deployment

### Using Docker Compose

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f shedsuite-supabase-sync

# Stop services
docker-compose down
```

### Using Docker

```bash
# Build image
docker build -t shedsuite-supabase-sync .

# Run container
docker run -p 3001:3001 --env-file .env shedsuite-supabase-sync
```

## API Endpoints

### Health Checks

- `GET /health` - Basic health check
- `GET /api/health/detailed` - Detailed health check with service status
- `GET /api/health/api` - ShedSuite API health check
- `GET /api/health/database` - Supabase health check
- `GET /api/health/sync` - Sync service health check
- `GET /api/health/metrics` - Performance metrics

### Sync Operations

- `POST /api/sync/trigger` - Manually trigger a sync operation
- `GET /api/sync/status` - Get current sync status
- `GET /api/sync/stats` - Get detailed sync statistics
- `POST /api/sync/schedule/start` - Start scheduled sync
- `POST /api/sync/schedule/stop` - Stop scheduled sync
- `POST /api/sync/cleanup` - Clean up old records
- `GET /api/sync/test-connections` - Test API and database connections
- `GET /api/sync/config` - Get sync configuration

### Example API Usage

```bash
# Trigger manual sync
curl -X POST http://localhost:3001/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"fullSync": false}'

# Get sync status
curl http://localhost:3001/api/sync/status

# Get detailed statistics
curl http://localhost:3001/api/sync/stats

# Test connections
curl http://localhost:3001/api/sync/test-connections
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | `3001` |
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Logging level | `info` |
| `SHEDSUITE_API_BASE_URL` | ShedSuite API base URL | Required |
| `SHEDSUITE_API_TOKEN` | ShedSuite API token | Required |
| `SHEDSUITE_PAGE_SIZE` | Records per page | `100` |
| `SHEDSUITE_MAX_PAGES` | Maximum pages to fetch | `1000` |
| `SUPABASE_URL` | Supabase project URL | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Required |
| `SYNC_INTERVAL_MINUTES` | Sync interval in minutes | `15` |
| `BATCH_SIZE` | Records per batch | `100` |
| `ENABLE_REAL_TIME_SYNC` | Enable scheduled sync | `true` |

### Sync Configuration

The service supports both incremental and full sync operations:

- **Incremental Sync**: Only syncs records updated since the last sync
- **Full Sync**: Syncs all records (use sparingly for large datasets)

## Monitoring and Logging

### Log Files

- `logs/app.log` - Application logs
- `logs/error.log` - Error logs only

### Metrics

The service provides metrics at `/api/health/metrics` including:

- Sync operation counts
- Processing times
- Memory usage
- Error rates

### Health Checks

Regular health checks ensure service availability:

```bash
# Basic health check
curl http://localhost:3001/health

# Detailed health check
curl http://localhost:3001/api/health/detailed
```

## Error Handling

The service includes comprehensive error handling:

- **Network Errors**: Automatic retry with exponential backoff
- **Authentication Errors**: Immediate failure with clear error messages
- **Rate Limiting**: Respectful delays and retry strategies
- **Data Validation**: Transformation errors are logged but don't stop the sync

## CSV Export

The service includes a fast CSV export utility that's much faster than using the Supabase GUI, especially for large datasets (98K+ records).

### Quick Export Commands

```bash
# Export all records (recommended)
npm run export:csv

# Export with different presets
npm run export:csv:all       # All records
npm run export:csv:today     # Today's records only
npm run export:csv:week      # This week's records
npm run export:csv:month     # This month's records
npm run export:csv:summary   # Summary columns only
```

### Advanced Export Options

```bash
# Custom batch size and output directory
node scripts/export-csv.js --batch 2000 --output ./my-exports

# Export specific date range
node scripts/export-csv.js --date-start 2025-01-01 --date-end 2025-01-31

# Export specific columns only
node scripts/export-csv.js --columns "id,customer_name,order_number,total_amount_dollar_amount,status"

# Custom filename
node scripts/export-csv.js --filename "my_custom_export.csv"
```

### Export Performance

- **Speed**: ~575 records/sec (vs GUI ~50 records/sec)
- **Full Dataset**: 98K+ records in ~3 minutes
- **File Size**: ~87MB for full dataset
- **Progress**: Real-time progress with ETA
- **Memory**: Efficient batching (no memory issues)

### Export Features

- ✅ **Fast batched export** (1000 records/batch)
- ✅ **Progress tracking** with ETA
- ✅ **Real-time logging** 
- ✅ **Automatic filename generation**
- ✅ **Date range filtering**
- ✅ **Column selection**
- ✅ **Error handling**
- ✅ **Memory efficient**

### Output Location

All exports are saved to the `./exports/` directory with automatic filenames like:
- `shedsuite_orders_export_2025-07-27_98009records.csv`
- `shedsuite_today_2025-07-27.csv`
- `shedsuite_summary_2025-07-27.csv`

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage
```

### Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

### Database Scripts

```bash
# Setup database (if needed)
npm run setup-db

# Run migrations
npm run migrate
```

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Verify ShedSuite API credentials
   - Check Supabase connection settings
   - Ensure network connectivity

2. **Sync Failures**
   - Check logs in `logs/error.log`
   - Verify data format compatibility
   - Review API rate limits

3. **Performance Issues**
   - Adjust batch sizes
   - Increase sync intervals
   - Monitor memory usage

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

### Manual Sync Testing

```bash
# Test API connection
curl http://localhost:3001/api/sync/test-connections

# Trigger manual sync with full sync
curl -X POST http://localhost:3001/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"fullSync": true}'
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review the logs
3. Create an issue with detailed information

---

**Note**: This service is designed to be a standalone component. It can be deployed independently or integrated into larger systems as needed. 