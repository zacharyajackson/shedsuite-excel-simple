#!/bin/bash

# ShedSuite to Supabase Continuous Sync Service
# This script runs the continuous sync in the background

echo "🚀 Starting ShedSuite to Supabase Continuous Sync Service"
echo "=========================================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with your configuration."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed!"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Get sync interval from command line argument (default: 5 minutes)
INTERVAL=${1:-5}
echo "⏰ Sync interval: $INTERVAL minutes"

# Create logs directory if it doesn't exist
mkdir -p logs

# Generate log filename with timestamp
LOG_FILE="logs/continuous-sync-$(date +%Y%m%d-%H%M%S).log"

echo "📝 Logging to: $LOG_FILE"
echo "🔄 Starting continuous sync..."
echo "Press Ctrl+C to stop"
echo ""

# Run the continuous sync
node start-sync.js continuous $INTERVAL 2>&1 | tee -a "$LOG_FILE" 