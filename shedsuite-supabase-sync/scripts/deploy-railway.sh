#!/bin/bash

# Railway Deployment Helper Script
# This script helps set up and deploy the ShedSuite Supabase Sync to Railway

set -e

echo "🚂 Railway Deployment Helper for ShedSuite Supabase Sync"
echo "========================================================"

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

# Check if Railway CLI is installed
check_railway_cli() {
    if ! command -v railway &> /dev/null; then
        print_warning "Railway CLI not found. Installing..."
        npm install -g @railway/cli
        print_success "Railway CLI installed"
    else
        print_success "Railway CLI found"
    fi
}

# Check if user is logged in to Railway
check_railway_auth() {
    if ! railway whoami &> /dev/null; then
        print_warning "Not logged in to Railway. Please login:"
        railway login
    else
        print_success "Logged in to Railway"
    fi
}

# Validate environment variables
validate_env() {
    print_status "Validating environment variables..."
    
    local missing_vars=()
    
    # Check required variables
    if [ -z "$SHEDSUITE_API_BASE_URL" ]; then
        missing_vars+=("SHEDSUITE_API_BASE_URL")
    fi
    
    if [ -z "$SHEDSUITE_API_TOKEN" ]; then
        missing_vars+=("SHEDSUITE_API_TOKEN")
    fi
    
    if [ -z "$SUPABASE_URL" ]; then
        missing_vars+=("SUPABASE_URL")
    fi
    
    if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
        missing_vars+=("SUPABASE_SERVICE_ROLE_KEY")
    fi
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
        print_warning "Please set these variables in your Railway project dashboard"
        return 1
    fi
    
    print_success "All required environment variables are set"
}

# Deploy to Railway
deploy_to_railway() {
    print_status "Deploying to Railway..."
    
    # Check if we're already linked to a project
    if railway project &> /dev/null; then
        local project_name=$(railway project 2>/dev/null | grep "Project:" | cut -d':' -f2 | xargs)
        print_status "Using existing Railway project: $project_name"
    else
        print_status "No existing project found. Please run 'railway link' to connect to your project first."
        print_warning "You can link to an existing project or create a new one."
        print_status "Running 'railway link'..."
        railway link
    fi
    
    # Deploy
    print_status "Building and deploying..."
    railway up
    
    print_success "Deployment completed!"
}

# Show deployment info
show_deployment_info() {
    print_status "Getting deployment information..."
    
    local url=$(railway domain 2>/dev/null || echo "Not available")
    local status=$(railway status 2>/dev/null || echo "Unknown")
    
    echo ""
    echo "📊 Deployment Information:"
    echo "=========================="
    echo "URL: $url"
    echo "Status: $status"
    echo ""
    echo "🔗 Useful Endpoints:"
    echo "Health Check: $url/health"
    echo "Sync Status: $url/api/sync/status"
    echo "Manual Sync: $url/api/sync/trigger"
    echo ""
    echo "📝 Next Steps:"
    echo "1. Monitor the deployment in Railway dashboard"
    echo "2. Check health endpoint: curl $url/health"
    echo "3. Test sync status: curl $url/api/sync/status"
    echo "4. Trigger manual sync: curl -X POST $url/api/sync/trigger"
}

# Main deployment flow
main() {
    echo ""
    
    # Check prerequisites
    check_railway_cli
    check_railway_auth
    
    # Skip local environment validation since variables are set in Railway
    print_status "Skipping local environment validation - variables are set in Railway"
    
    # Deploy
    deploy_to_railway
    
    # Show info
    show_deployment_info
    
    print_success "Railway deployment setup complete!"
    echo ""
    print_warning "Remember to:"
    echo "  - Monitor logs in Railway dashboard"
    echo "  - Set up alerts for sync failures"
    echo "  - Configure custom domain if needed"
}

# Handle command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "check")
        check_railway_cli
        check_railway_auth
        validate_env
        ;;
    "info")
        show_deployment_info
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  deploy  - Deploy to Railway (default)"
        echo "  check   - Check prerequisites and environment"
        echo "  info    - Show deployment information"
        echo "  help    - Show this help message"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac 