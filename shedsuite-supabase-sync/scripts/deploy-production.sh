#!/bin/bash

# Production Deployment Script for ShedSuite Supabase Sync
# This script deploys the application with production-optimized settings

echo "🚀 Starting production deployment..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Set production environment variables
export NODE_ENV=production
export ENABLE_INITIAL_TEST_SYNC=false
export SKIP_CONNECTION_TESTS=true

echo "📋 Production configuration:"
echo "   - NODE_ENV: $NODE_ENV"
echo "   - ENABLE_INITIAL_TEST_SYNC: $ENABLE_INITIAL_TEST_SYNC"
echo "   - SKIP_CONNECTION_TESTS: $SKIP_CONNECTION_TESTS"

# Deploy to Railway
echo "🚂 Deploying to Railway..."
railway up

echo "✅ Production deployment completed!"
echo ""
echo "📝 Important notes:"
echo "   - The application will run continuously without initial test sync"
echo "   - Sync will occur every 15 minutes automatically"
echo "   - Health checks are available at /health"
echo "   - Manual sync can be triggered via API endpoints" 