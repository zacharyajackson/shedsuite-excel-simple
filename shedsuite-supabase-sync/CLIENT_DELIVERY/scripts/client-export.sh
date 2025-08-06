#!/bin/bash

# CLIENT EXPORT SCRIPT
# Simple script for clients to export data without Supabase UI issues
# This script handles the common duplication and incomplete export problems

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EXPORT_DIR="$PROJECT_DIR/client-exports"
LOG_FILE="$EXPORT_DIR/export-$(date +%Y%m%d-%H%M%S).log"

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

# Function to show usage
show_usage() {
    echo "🚀 CLIENT EXPORT SCRIPT"
    echo "======================"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h           Show this help message"
    echo "  --preset <name>      Use preset configuration"
    echo "  --table <name>       Specify table to export (default: shedsuite_orders)"
    echo "  --format <format>    Export format: csv, json (default: csv)"
    echo "  --start <date>       Start date (ISO format: YYYY-MM-DD)"
    echo "  --end <date>         End date (ISO format: YYYY-MM-DD)"
    echo "  --batch <size>       Batch size (default: 500)"
    echo "  --no-validate        Skip data validation"
    echo "  --no-duplicates      Skip duplicate checking"
    echo "  --output-dir <path>  Output directory (default: ./client-exports)"
    echo ""
    echo "Presets:"
    echo "  all                  Export all data with full validation"
    echo "  recent               Export last 30 days with validation"
    echo "  minimal              Export all data without validation"
    echo "  test                 Export small sample for testing"
    echo ""
    echo "Examples:"
    echo "  $0 --preset all"
    echo "  $0 --preset recent"
    echo "  $0 --table shedsuite_orders --format csv --start 2024-01-01"
    echo "  $0 --table shedsuite_orders --no-validate --no-duplicates"
    echo ""
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
    
    # Check if .env file exists
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        print_error ".env file not found. Please ensure your environment is configured."
        exit 1
    fi
    
    # Check if node_modules exists
    if [ ! -d "$PROJECT_DIR/node_modules" ]; then
        print_warning "node_modules not found. Installing dependencies..."
        cd "$PROJECT_DIR"
        npm install
    fi
    
    print_success "Prerequisites check passed"
}

# Function to create export directory
create_export_dir() {
    if [ ! -d "$EXPORT_DIR" ]; then
        print_status "Creating export directory: $EXPORT_DIR"
        mkdir -p "$EXPORT_DIR"
    fi
}

# Function to run the export
run_export() {
    local args=()
    
    # Build arguments for the Node.js script
    if [ "$PRESET" != "" ]; then
        args+=("$PRESET")
    elif [ "$CUSTOM_EXPORT" = true ]; then
        args+=("custom")
        
        if [ "$TABLE_NAME" != "" ]; then
            args+=("--table" "$TABLE_NAME")
        fi
        
        if [ "$FORMAT" != "" ]; then
            args+=("--format" "$FORMAT")
        fi
        
        if [ "$START_DATE" != "" ]; then
            args+=("--start" "$START_DATE")
        fi
        
        if [ "$END_DATE" != "" ]; then
            args+=("--end" "$END_DATE")
        fi
        
        if [ "$BATCH_SIZE" != "" ]; then
            args+=("--batch" "$BATCH_SIZE")
        fi
        
        if [ "$NO_VALIDATE" = true ]; then
            args+=("--no-validate")
        fi
        
        if [ "$NO_DUPLICATES" = true ]; then
            args+=("--no-duplicates")
        fi
    fi
    
    print_status "Running export with arguments: ${args[*]}"
    
    # Run the Node.js export script
    cd "$PROJECT_DIR"
    node scripts/client-export-solution.js "${args[@]}" 2>&1 | tee "$LOG_FILE"
    
    # Check exit status
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        print_success "Export completed successfully!"
        print_status "Log file: $LOG_FILE"
        
        # Show export summary
        if [ -d "$EXPORT_DIR" ]; then
            echo ""
            print_status "Export files:"
            ls -la "$EXPORT_DIR"/*.csv 2>/dev/null || print_warning "No CSV files found"
            ls -la "$EXPORT_DIR"/*.json 2>/dev/null || print_warning "No JSON files found"
        fi
    else
        print_error "Export failed! Check the log file: $LOG_FILE"
        exit 1
    fi
}

# Function to show export summary
show_summary() {
    echo ""
    print_status "Export Summary:"
    echo "=================="
    
    if [ -d "$EXPORT_DIR" ]; then
        local csv_files=$(find "$EXPORT_DIR" -name "*.csv" -type f 2>/dev/null | wc -l)
        local json_files=$(find "$EXPORT_DIR" -name "*.json" -type f 2>/dev/null | wc -l)
        
        echo "📁 Export directory: $EXPORT_DIR"
        echo "📊 CSV files: $csv_files"
        echo "📋 JSON files: $json_files"
        echo "📝 Log file: $LOG_FILE"
        
        if [ $csv_files -gt 0 ]; then
            echo ""
            print_status "Recent CSV exports:"
            find "$EXPORT_DIR" -name "*.csv" -type f -exec ls -lh {} \; 2>/dev/null | head -5
        fi
    fi
}

# Parse command line arguments
PRESET=""
CUSTOM_EXPORT=false
TABLE_NAME=""
FORMAT=""
START_DATE=""
END_DATE=""
BATCH_SIZE=""
NO_VALIDATE=false
NO_DUPLICATES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_usage
            exit 0
            ;;
        --preset)
            PRESET="$2"
            shift 2
            ;;
        --table)
            TABLE_NAME="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --format)
            FORMAT="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --start)
            START_DATE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --end)
            END_DATE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --batch)
            BATCH_SIZE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --no-validate)
            NO_VALIDATE=true
            CUSTOM_EXPORT=true
            shift
            ;;
        --no-duplicates)
            NO_DUPLICATES=true
            CUSTOM_EXPORT=true
            shift
            ;;
        --output-dir)
            EXPORT_DIR="$2"
            shift 2
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate preset if provided
if [ "$PRESET" != "" ]; then
    case $PRESET in
        all|recent|minimal|test)
            ;;
        *)
            print_error "Invalid preset: $PRESET"
            show_usage
            exit 1
            ;;
    esac
fi

# Main execution
main() {
    echo "🚀 CLIENT EXPORT SCRIPT"
    echo "======================"
    echo "Started at: $(date)"
    echo ""
    
    # Check prerequisites
    check_prerequisites
    
    # Create export directory
    create_export_dir
    
    # Run the export
    run_export
    
    # Show summary
    show_summary
    
    echo ""
    print_success "Export process completed!"
    echo "📁 Check the export directory: $EXPORT_DIR"
    echo "📝 Check the log file: $LOG_FILE"
}

# Run main function
main "$@" 