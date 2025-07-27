# Railway Deployment Guide for ShedSuite Supabase Sync

This guide will help you deploy the ShedSuite to Supabase sync service on Railway for continuous operation.

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **ShedSuite API Token**: Get your API token from ShedSuite
4. **Supabase Project**: Set up a Supabase project with the required tables

## Quick Deployment

### 1. Connect to Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository: `shedsuite-supabase-sync`

### 2. Configure Environment Variables

In your Railway project dashboard, go to the "Variables" tab and add the following environment variables:

#### Required Variables
```
SHEDSUITE_API_BASE_URL=https://api.shedsuite.com
SHEDSUITE_API_TOKEN=your_actual_shedsuite_api_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

#### Recommended Production Settings
```
NODE_ENV=production
LOG_LEVEL=info
ENABLE_REAL_TIME_SYNC=true
SYNC_INTERVAL_MINUTES=15
BATCH_SIZE=100
MAX_SYNC_RETRIES=5
SYNC_RETRY_DELAY=5000
RATE_LIMIT_MAX_REQUESTS=1000
```

### 3. Deploy

1. Railway will automatically detect the `railway.json` configuration
2. The service will build using the Dockerfile
3. Railway will start the service and run health checks
4. Your service will be available at the provided Railway URL

## Configuration Details

### Railway Configuration (`railway.json`)

The `railway.json` file configures:
- **Builder**: Uses Dockerfile for containerized deployment
- **Health Check**: Monitors `/health` endpoint every 30 seconds
- **Restart Policy**: Automatically restarts on failure (up to 10 times)
- **Environment Variables**: Pre-configured for production and development

### Environment Variables

#### Core Configuration
- `PORT`: Railway sets this automatically
- `NODE_ENV`: Set to `production` for Railway
- `LOG_LEVEL`: `info` for production, `debug` for development

#### ShedSuite API
- `SHEDSUITE_API_BASE_URL`: Your ShedSuite API base URL
- `SHEDSUITE_API_TOKEN`: Your API authentication token
- `SHEDSUITE_PAGE_SIZE`: Number of records per API call (default: 100)

#### Supabase Configuration
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database access

#### Sync Settings
- `ENABLE_REAL_TIME_SYNC`: Set to `true` for continuous sync
- `SYNC_INTERVAL_MINUTES`: How often to sync (default: 15 minutes)
- `BATCH_SIZE`: Records per batch (default: 100)
- `MAX_SYNC_RETRIES`: Retry attempts on failure (default: 5)

## Monitoring and Health Checks

### Health Check Endpoint
- **URL**: `https://your-railway-url.railway.app/health`
- **Method**: GET
- **Response**: JSON with service status, uptime, and memory usage

### Sync Status Endpoint
- **URL**: `https://your-railway-url.railway.app/api/sync/status`
- **Method**: GET
- **Response**: Current sync status and statistics

### Manual Sync Trigger
- **URL**: `https://your-railway-url.railway.app/api/sync/trigger`
- **Method**: POST
- **Body**: `{ "fullSync": true }` (optional)

## Continuous Operation

### Automatic Sync
The service runs continuous sync every 15 minutes (configurable) when `ENABLE_REAL_TIME_SYNC=true`.

### Logs and Monitoring
- View logs in Railway dashboard under "Deployments"
- Monitor sync status via API endpoints
- Set up alerts for sync failures

### Scaling
Railway automatically scales based on traffic and can handle:
- Multiple concurrent sync operations
- High-volume data processing
- Automatic restarts on failure

## Troubleshooting

### Common Issues

1. **Service Won't Start**
   - Check environment variables are set correctly
   - Verify API tokens are valid
   - Check Railway logs for startup errors

2. **Sync Failures**
   - Monitor `/api/sync/status` endpoint
   - Check ShedSuite API connectivity
   - Verify Supabase permissions

3. **Health Check Failures**
   - Ensure `/health` endpoint is responding
   - Check service is listening on correct port
   - Verify database connections

### Debug Commands

```bash
# Check service health
curl https://your-railway-url.railway.app/health

# Get sync status
curl https://your-railway-url.railway.app/api/sync/status

# Trigger manual sync
curl -X POST https://your-railway-url.railway.app/api/sync/trigger

# Test connections
curl https://your-railway-url.railway.app/api/sync/test-connections
```

## Security Considerations

1. **Environment Variables**: Never commit sensitive tokens to Git
2. **API Keys**: Use Railway's secure environment variable storage
3. **Rate Limiting**: Configure appropriate rate limits for your API
4. **CORS**: Set `CORS_ORIGIN` to specific domains in production

## Cost Optimization

1. **Sync Interval**: Increase `SYNC_INTERVAL_MINUTES` to reduce API calls
2. **Batch Size**: Optimize `BATCH_SIZE` for your data volume
3. **Log Level**: Use `info` level in production to reduce log volume
4. **Monitoring**: Use Railway's built-in monitoring instead of external services

## Support

For issues with:
- **Railway**: Check Railway documentation and support
- **ShedSuite API**: Contact ShedSuite support
- **Supabase**: Check Supabase documentation
- **This Service**: Check the main README.md for troubleshooting 