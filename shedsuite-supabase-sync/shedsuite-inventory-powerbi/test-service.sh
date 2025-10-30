#!/bin/bash
# Quick service health check script for Railway deployment

# Get Railway URL from user or use default pattern
RAILWAY_URL=${1:-"https://your-service.railway.app"}

echo "🔍 Testing Service: $RAILWAY_URL"
echo "=================================="
echo ""

# Test 1: Health Check
echo "1️⃣  Testing Health Endpoint..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$RAILWAY_URL/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✅ Health check passed"
  echo "   Response: $HEALTH_BODY"
else
  echo "   ❌ Health check failed (HTTP $HTTP_CODE)"
  echo "   Response: $HEALTH_BODY"
fi
echo ""

# Test 2: Service Info
echo "2️⃣  Checking Service Status..."
echo "   URL: $RAILWAY_URL"
echo "   Health: $RAILWAY_URL/health"
echo "   Sync: $RAILWAY_URL/sync/inventory (POST)"
echo ""

# Test 3: Manual Sync (optional - commented out to avoid accidental sync)
# echo "3️⃣  Testing Manual Sync..."
# SYNC_RESPONSE=$(curl -s -X POST -w "\n%{http_code}" "$RAILWAY_URL/sync/inventory")
# SYNC_CODE=$(echo "$SYNC_RESPONSE" | tail -n1)
# SYNC_BODY=$(echo "$SYNC_RESPONSE" | sed '$d')
# echo "   HTTP Code: $SYNC_CODE"
# echo "   Response: $SYNC_BODY"
# echo ""

echo "=================================="
echo "✅ Service check complete!"
echo ""
echo "📝 Next steps:"
echo "   - Check Railway logs for detailed service activity"
echo "   - Verify Supabase table has data: SELECT COUNT(*) FROM inventory_items"
echo "   - Monitor hourly cron sync via Railway dashboard"
echo ""

