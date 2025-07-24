#!/bin/bash

# ShedSuite Supabase Sync Service - Start and Test Script

set -e

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

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

print_success "Node.js version: $(node -v)"

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning ".env file not found. Creating from template..."
    cp env.example .env
    print_warning "Please edit .env file with your configuration before running the service."
    print_warning "Required variables:"
    print_warning "  - SHEDSUITE_API_BASE_URL"
    print_warning "  - SHEDSUITE_API_TOKEN"
    print_warning "  - SUPABASE_URL"
    print_warning "  - SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
fi

# Check if logs directory exists
if [ ! -d "logs" ]; then
    print_status "Creating logs directory..."
    mkdir -p logs
fi

# Function to check if port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        return 0
    else
        return 1
    fi
}

# Check if port 3001 is already in use
if check_port 3001; then
    print_warning "Port 3001 is already in use. Checking if it's our service..."
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        print_success "Service is already running on port 3001"
        RUNNING=true
    else
        print_error "Port 3001 is in use by another process. Please stop it first."
        exit 1
    fi
else
    RUNNING=false
fi

# Start the service if not running
if [ "$RUNNING" = false ]; then
    print_status "Starting ShedSuite Supabase Sync Service..."
    
    # Start the service in the background
    npm start &
    SERVICE_PID=$!
    
    # Wait for service to start
    print_status "Waiting for service to start..."
    for i in {1..30}; do
        if curl -s http://localhost:3001/health > /dev/null 2>&1; then
            print_success "Service started successfully!"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "Service failed to start within 30 seconds"
            kill $SERVICE_PID 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done
fi

# Wait a moment for service to fully initialize
sleep 2

# Run the test script
print_status "Running service tests..."
node test-service.js

# Show service information
echo ""
print_status "Service Information:"
echo "  URL: http://localhost:3001"
echo "  Health Check: http://localhost:3001/health"
echo "  API Documentation: http://localhost:3001/"
echo "  Logs: logs/app.log"

# Show useful commands
echo ""
print_status "Useful Commands:"
echo "  Test service: node test-service.js"
echo "  View logs: tail -f logs/app.log"
echo "  Stop service: pkill -f 'node.*src/index.js'"
echo "  Manual sync: curl -X POST http://localhost:3001/api/sync/trigger"
echo "  Check status: curl http://localhost:3001/api/sync/status"

echo ""
print_success "Setup complete! The service is running and ready for testing." 