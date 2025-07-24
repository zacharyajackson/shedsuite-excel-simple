# ShedSuite Supabase Sync Service

A standalone service that synchronizes data from the ShedSuite API to Supabase, providing real-time data integration with robust error handling and monitoring capabilities.

## Features

- 🔄 **Real-time Sync**: Automated data synchronization with configurable intervals
- 🛡️ **Error Handling**: Comprehensive error categorization and retry mechanisms
- 📊 **Monitoring**: Health checks, metrics, and detailed logging
- 🚀 **Performance**: Batch processing and optimized database operations
- 🔧 **Flexible Configuration**: Environment-based configuration management
- 🐳 **Docker Support**: Containerized deployment with Docker and Docker Compose
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