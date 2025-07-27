#!/bin/bash

# Health Check Script for ShedSuite Supabase Sync
# This script can be used for monitoring and alerting

set -e

# Configuration
SERVICE_URL="${SERVICE_URL:-http://localhost:3001}"
HEALTH_ENDPOINT="$SERVICE_URL/health"
SYNC_STATUS_ENDPOINT="$SERVICE_URL/api/sync/status"
TIMEOUT=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to make HTTP request with timeout
http_request() {
    local url="$1"
    local timeout="$2"
    
    curl -s -m "$timeout" -H "Accept: application/json" "$url" 2>/dev/null || echo "ERROR"
}

# Check basic health endpoint
check_health() {
    print_status "Checking health endpoint: $HEALTH_ENDPOINT"
    
    local response=$(http_request "$HEALTH_ENDPOINT" "$TIMEOUT")
    
    if [ "$response" = "ERROR" ]; then
        print_error "Health check failed - service unreachable"
        return 1
    fi
    
    # Parse JSON response
    local status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "unknown")
    local uptime=$(echo "$response" | grep -o '"uptime":[0-9.]*' | cut -d':' -f2 2>/dev/null || echo "0")
    
    if [ "$status" = "healthy" ]; then
        print_success "Service is healthy (uptime: ${uptime}s)"
        return 0
    elif [ "$status" = "starting" ]; then
        print_warning "Service is starting up"
        return 0
    else
        print_error "Service is unhealthy (status: $status)"
        return 1
    fi
}

# Check sync status
check_sync_status() {
    print_status "Checking sync status: $SYNC_STATUS_ENDPOINT"
    
    local response=$(http_request "$SYNC_STATUS_ENDPOINT" "$TIMEOUT")
    
    if [ "$response" = "ERROR" ]; then
        print_warning "Could not fetch sync status"
        return 0
    fi
    
    # Parse sync status
    local is_running=$(echo "$response" | grep -o '"isRunning":[^,]*' | cut -d':' -f2 2>/dev/null || echo "false")
    local last_sync=$(echo "$response" | grep -o '"lastSyncTime":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "never")
    local total_syncs=$(echo "$response" | grep -o '"totalSyncs":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")
    local failed_syncs=$(echo "$response" | grep -o '"failedSyncs":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")
    
    if [ "$is_running" = "true" ]; then
        print_warning "Sync is currently running"
    else
        print_success "Sync is not running (last sync: $last_sync)"
    fi
    
    echo "  Total syncs: $total_syncs"
    echo "  Failed syncs: $failed_syncs"
    
    # Check if there are too many failed syncs
    if [ "$failed_syncs" -gt 5 ]; then
        print_warning "High number of failed syncs detected"
        return 1
    fi
    
    return 0
}

# Check memory usage
check_memory() {
    print_status "Checking memory usage"
    
    local response=$(http_request "$HEALTH_ENDPOINT" "$TIMEOUT")
    
    if [ "$response" = "ERROR" ]; then
        print_warning "Could not fetch memory information"
        return 0
    fi
    
    # Parse memory usage
    local memory_used=$(echo "$response" | grep -o '"heapUsed":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")
    local memory_total=$(echo "$response" | grep -o '"heapTotal":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")
    
    if [ "$memory_total" -gt 0 ]; then
        local memory_percent=$((memory_used * 100 / memory_total))
        echo "  Memory usage: ${memory_used}MB / ${memory_total}MB (${memory_percent}%)"
        
        if [ "$memory_percent" -gt 80 ]; then
            print_warning "High memory usage detected"
            return 1
        fi
    fi
    
    return 0
}

# Main health check
main() {
    echo "🏥 Health Check for ShedSuite Supabase Sync"
    echo "=========================================="
    echo "Service URL: $SERVICE_URL"
    echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    echo ""
    
    local exit_code=0
    
    # Run all checks
    if ! check_health; then
        exit_code=1
    fi
    
    if ! check_sync_status; then
        exit_code=1
    fi
    
    if ! check_memory; then
        exit_code=1
    fi
    
    echo ""
    if [ $exit_code -eq 0 ]; then
        print_success "All health checks passed"
    else
        print_error "Some health checks failed"
    fi
    
    exit $exit_code
}

# Handle command line arguments
case "${1:-check}" in
    "check")
        main
        ;;
    "health")
        check_health
        ;;
    "sync")
        check_sync_status
        ;;
    "memory")
        check_memory
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  check   - Run all health checks (default)"
        echo "  health  - Check basic health endpoint"
        echo "  sync    - Check sync status"
        echo "  memory  - Check memory usage"
        echo "  help    - Show this help message"
        echo ""
        echo "Environment Variables:"
        echo "  SERVICE_URL - Service URL (default: http://localhost:3001)"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac 