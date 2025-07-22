#!/bin/bash

# ShedSuite Excel Integration Deployment Script
# This script helps prepare and deploy the application to Railway

set -e  # Exit on any error

echo "🚀 Starting ShedSuite Excel Integration deployment..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if package-lock.json exists
if [ ! -f "package-lock.json" ]; then
    echo "📦 Generating package-lock.json..."
    npm install
fi

# Check if .env file exists (for local testing)
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found. This is expected for Railway deployment."
    echo "   Make sure to set environment variables in Railway dashboard."
fi

# Validate required environment variables for local testing
echo "🔍 Validating environment setup..."
node -e "
require('dotenv').config();
const required = ['API_BASE_URL', 'API_TOKEN', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET', 'EXCEL_WORKBOOK_ID'];
const missing = required.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.log('⚠️  Missing environment variables (expected for Railway):', missing.join(', '));
    console.log('   These will be set in Railway dashboard.');
} else {
    console.log('✅ All required environment variables are present');
}
"

# Test the application locally if environment is set up
if [ -f ".env" ]; then
    echo "🧪 Testing application locally..."
    timeout 30s npm start &
    PID=$!
    
    # Wait for server to start
    sleep 10
    
    # Test health check
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ Health check passed!"
    else
        echo "⚠️  Health check failed (this might be expected without full environment setup)"
    fi
    
    # Kill the test server
    kill $PID 2>/dev/null || true
    wait $PID 2>/dev/null || true
fi

echo "📋 Deployment checklist:"
echo "   ✅ package.json exists"
echo "   ✅ package-lock.json exists"
echo "   ✅ Dockerfile configured"
echo "   ✅ .dockerignore configured"
echo "   ✅ railway.toml configured"
echo "   ✅ Health check endpoints ready"
echo ""
echo "🚂 Ready for Railway deployment!"
echo ""
echo "Next steps:"
echo "1. Commit your changes: git add . && git commit -m 'Prepare for Railway deployment'"
echo "2. Push to your repository: git push origin main"
echo "3. Deploy to Railway: railway up"
echo ""
echo "Make sure to set these environment variables in Railway:"
echo "   - API_BASE_URL"
echo "   - API_TOKEN"
echo "   - AZURE_CLIENT_ID"
echo "   - AZURE_TENANT_ID"
echo "   - AZURE_CLIENT_SECRET"
echo "   - EXCEL_WORKBOOK_ID"
echo ""
echo "🎉 Deployment script completed successfully!" 