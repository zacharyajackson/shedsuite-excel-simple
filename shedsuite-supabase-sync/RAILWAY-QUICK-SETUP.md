# Railway Quick Setup Guide

Get your ShedSuite Supabase Sync running on Railway in 5 minutes!

## 🚀 Quick Start

### 1. Connect to Railway
1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your `shedsuite-supabase-sync` repository

### 2. Set Environment Variables
In Railway dashboard → Variables tab, add:

```bash
# Required - Replace with your actual values
SHEDSUITE_API_BASE_URL=https://api.shedsuite.com
SHEDSUITE_API_TOKEN=your_actual_shedsuite_api_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Production Settings
NODE_ENV=production
ENABLE_REAL_TIME_SYNC=true
SYNC_INTERVAL_MINUTES=15
```

### 3. Deploy
Railway will automatically:
- Build your Docker container
- Start the service
- Run health checks
- Provide you with a URL

## ✅ Verify Deployment

### Check Health
```bash
curl https://your-railway-url.railway.app/health
```

### Check Sync Status
```bash
curl https://your-railway-url.railway.app/api/sync/status
```

### Trigger Manual Sync
```bash
curl -X POST https://your-railway-url.railway.app/api/sync/trigger
```

## 🔧 Configuration Options

### Sync Frequency
- **Frequent**: `SYNC_INTERVAL_MINUTES=5` (every 5 minutes)
- **Standard**: `SYNC_INTERVAL_MINUTES=15` (every 15 minutes)
- **Conservative**: `SYNC_INTERVAL_MINUTES=30` (every 30 minutes)

### Batch Size
- **Small**: `BATCH_SIZE=50` (50 records per batch)
- **Standard**: `BATCH_SIZE=100` (100 records per batch)
- **Large**: `BATCH_SIZE=200` (200 records per batch)

### Logging Level
- **Production**: `LOG_LEVEL=info`
- **Debug**: `LOG_LEVEL=debug`

## 📊 Monitoring

### Railway Dashboard
- View logs in real-time
- Monitor resource usage
- Check deployment status

### Health Endpoints
- `/health` - Service health and uptime
- `/api/sync/status` - Sync status and statistics
- `/api/sync/stats` - Detailed sync metrics

### Alerts
Set up alerts in Railway for:
- Service downtime
- High error rates
- Resource usage spikes

## 🛠️ Troubleshooting

### Service Won't Start
1. Check environment variables are set
2. Verify API tokens are valid
3. Check Railway logs for errors

### Sync Not Working
1. Test connections: `/api/sync/test-connections`
2. Check sync status: `/api/sync/status`
3. Verify Supabase permissions

### High Resource Usage
1. Increase `SYNC_INTERVAL_MINUTES`
2. Reduce `BATCH_SIZE`
3. Set `LOG_LEVEL=info`

## 💰 Cost Optimization

### Free Tier Limits
- 500 hours/month
- 1GB RAM
- Shared CPU

### Optimization Tips
1. Use `SYNC_INTERVAL_MINUTES=30` for less frequent syncs
2. Set `LOG_LEVEL=info` to reduce log volume
3. Monitor usage in Railway dashboard

## 🔗 Useful Commands

### Using Railway CLI
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up

# View logs
railway logs

# Check status
railway status
```

### Using npm scripts
```bash
# Deploy to Railway
npm run railway:deploy

# Health check
npm run health:check

# Monitor service
npm run health:monitor
```

## 📞 Support

- **Railway Issues**: Check Railway documentation
- **Service Issues**: Check logs in Railway dashboard
- **Configuration**: See `RAILWAY-DEPLOYMENT.md` for detailed guide

---

**That's it!** Your ShedSuite sync service is now running continuously on Railway. 🎉 