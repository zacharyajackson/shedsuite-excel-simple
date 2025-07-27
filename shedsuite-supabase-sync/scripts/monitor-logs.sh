#!/bin/bash

# Monitor Railway logs with better formatting
# Usage: ./scripts/monitor-logs.sh

set -e

echo "🔍 Monitoring Railway logs..."
echo "📊 Press Ctrl+C to stop monitoring"
echo ""

# Function to format log output
format_logs() {
    while IFS= read -r line; do
        # Highlight important messages
        if [[ $line == *"🔄 Scheduled sync triggered"* ]]; then
            echo -e "\033[1;33m$line\033[0m"  # Yellow for sync triggers
        elif [[ $line == *"✅ Scheduled sync completed"* ]]; then
            echo -e "\033[1;32m$line\033[0m"  # Green for successful syncs
        elif [[ $line == *"❌ Scheduled sync failed"* ]]; then
            echo -e "\033[1;31m$line\033[0m"  # Red for failed syncs
        elif [[ $line == *"🎉 SERVER IS FULLY STARTED"* ]]; then
            echo -e "\033[1;36m$line\033[0m"  # Cyan for server start
        elif [[ $line == *"🔧 DataSyncService"* ]]; then
            echo -e "\033[1;35m$line\033[0m"  # Magenta for debug logs
        else
            echo "$line"
        fi
    done
}

# Monitor logs with formatting
railway logs | format_logs 