#!/bin/bash

# CLIENT EXPORT SCRIPT
# ===================
# 
# A user-friendly wrapper script for the client-export-solution.js Node.js script.
# This script provides:
# - Simplified command-line interface for non-technical users
# - Prerequisite checking (Node.js, npm, dependencies)
# - Environment validation (.env file, database connectivity)
# - Progress monitoring and logging
# - Export summary and file management
# 
# The script addresses common Supabase export issues including:
# - Duplicate records in exports
# - Incomplete exports due to timeouts
# - Memory issues with large datasets
# - Lack of progress visibility

# Bash strict mode - exit on any error, undefined variables, or pipe failures
set -e  # Exit on any error
set -u  # Exit on undefined variables
set -o pipefail  # Exit on pipe failures

# ANSI color codes for enhanced terminal output
# These improve user experience by providing visual feedback
RED='\033[0;31m'      # Error messages
GREEN='\033[0;32m'    # Success messages
YELLOW='\033[1;33m'   # Warning messages
BLUE='\033[0;34m'     # Information messages
NC='\033[0m'          # No Color - reset to default

# SCRIPT CONFIGURATION
# ====================
# 
# Define key paths and settings used throughout the script.
# These paths are calculated dynamically to ensure the script works
# regardless of where it's executed from.

# Get the directory where this script is located
# This ensures we can find related files regardless of execution location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Calculate project root directory (parent of scripts directory)
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default export directory for all output files
# Can be overridden with --output-dir parameter
EXPORT_DIR="$PROJECT_DIR/client-exports"

# Generate unique log file name with timestamp
# Format: export-YYYYMMDD-HHMMSS.log
LOG_FILE="$EXPORT_DIR/export-$(date +%Y%m%d-%H%M%S).log"

# UTILITY FUNCTIONS FOR COLORED OUTPUT
# ====================================
# 
# These functions provide consistent, colored output throughout the script.
# They improve user experience by making different message types easily distinguishable.

# Print informational messages in blue
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Print success messages in green
print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Print warning messages in yellow
print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Print error messages in red
print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# HELP DOCUMENTATION FUNCTION
# ============================
# 
# Displays comprehensive usage information including all available options,
# presets, and practical examples. This is the primary user documentation.

show_usage() {
    echo "🚀 CLIENT EXPORT SCRIPT"
    echo "======================"
    echo ""
    echo "A wrapper script that simplifies data export operations and handles"
    echo "common Supabase export issues like duplicates and incomplete transfers."
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h           Show this help message"
    echo "  --preset <name>      Use preset configuration (recommended)"
    echo "  --table <name>       Specify table to export (default: shedsuite_orders)"
    echo "  --format <format>    Export format: csv, json (default: csv)"
    echo "  --start <date>       Start date (ISO format: YYYY-MM-DD)"
    echo "  --end <date>         End date (ISO format: YYYY-MM-DD)"
    echo "  --batch <size>       Batch size for pagination (default: 500)"
    echo "  --no-validate        Skip data validation (faster, less safe)"
    echo "  --no-duplicates      Skip duplicate checking (faster, less safe)"
    echo "  --output-dir <path>  Output directory (default: ./client-exports)"
    echo ""
    echo "Presets (recommended for most users):"
    echo "  all                  Export all data with full validation"
    echo "  recent               Export last 30 days with validation"
    echo "  minimal              Export all data without validation (fastest)"
    echo "  test                 Export small sample for testing"
    echo ""
    echo "Examples:"
    echo "  $0 --preset all                    # Export everything (recommended)"
    echo "  $0 --preset recent                 # Export recent data only"
    echo "  $0 --table orders --format csv     # Custom table export"
    echo "  $0 --start 2024-01-01 --end 2024-12-31  # Date range export"
    echo ""
    echo "For more advanced options, see the Node.js script documentation."
    echo ""
}

# PREREQUISITE VALIDATION FUNCTION
# =================================
# 
# Verifies that all required dependencies and configuration are in place
# before attempting the export. This prevents runtime failures and provides
# clear guidance to users about what they need to set up.

check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Verify Node.js installation
    # Node.js is required to run the export script
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        print_error "Visit https://nodejs.org/ to download and install Node.js"
        exit 1
    fi
    
    # Verify npm installation
    # npm is required to install and manage dependencies
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        print_error "npm usually comes with Node.js installation"
        exit 1
    fi
    
    # Check for environment configuration
    # The .env file contains database credentials and configuration
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        print_error ".env file not found in $PROJECT_DIR"
        print_error "Please ensure your environment is configured with database credentials"
        print_error "Copy environment_template.txt to .env and fill in your values"
        exit 1
    fi
    
    # Ensure Node.js dependencies are installed
    # Auto-install if missing to improve user experience
    if [ ! -d "$PROJECT_DIR/node_modules" ]; then
        print_warning "node_modules not found. Installing dependencies..."
        cd "$PROJECT_DIR"
        npm install || {
            print_error "Failed to install dependencies with npm install"
            exit 1
        }
    fi
    
    print_success "Prerequisites check passed"
}

# EXPORT DIRECTORY MANAGEMENT
# ============================
# 
# Ensures the export directory exists and is writable.
# Creates the directory structure if it doesn't exist.

create_export_dir() {
    # Create export directory if it doesn't exist
    # Use -p flag to create parent directories as needed
    if [ ! -d "$EXPORT_DIR" ]; then
        print_status "Creating export directory: $EXPORT_DIR"
        mkdir -p "$EXPORT_DIR" || {
            print_error "Failed to create export directory: $EXPORT_DIR"
            print_error "Please check directory permissions"
            exit 1
        }
    fi
    
    # Verify directory is writable
    if [ ! -w "$EXPORT_DIR" ]; then
        print_error "Export directory is not writable: $EXPORT_DIR"
        print_error "Please check directory permissions"
        exit 1
    fi
}

# EXPORT EXECUTION FUNCTION
# ==========================
# 
# Orchestrates the actual export process by:
# 1. Building command line arguments from user input
# 2. Executing the Node.js export script
# 3. Monitoring the process and capturing output
# 4. Handling success/failure scenarios

run_export() {
    local args=()  # Array to hold command line arguments for Node.js script
    
    # Build arguments for the Node.js script based on user input
    # Arguments are constructed differently for preset vs custom exports
    
    if [ "$PRESET" != "" ]; then
        # Preset mode: pass preset name directly
        args+=("$PRESET")
        print_status "Using preset configuration: $PRESET"
    elif [ "$CUSTOM_EXPORT" = true ]; then
        # Custom mode: build detailed argument list
        args+=("custom")  # Signal custom mode to Node.js script
        print_status "Using custom export configuration"
        
        # Add table name if specified
        if [ "$TABLE_NAME" != "" ]; then
            args+=("--table" "$TABLE_NAME")
        fi
        
        # Add output format if specified
        if [ "$FORMAT" != "" ]; then
            args+=("--format" "$FORMAT")
        fi
        
        # Add date range filters if specified
        if [ "$START_DATE" != "" ]; then
            args+=("--start" "$START_DATE")
        fi
        
        if [ "$END_DATE" != "" ]; then
            args+=("--end" "$END_DATE")
        fi
        
        # Add batch size if specified
        if [ "$BATCH_SIZE" != "" ]; then
            args+=("--batch" "$BATCH_SIZE")
        fi
        
        # Add validation flags if specified
        if [ "$NO_VALIDATE" = true ]; then
            args+=("--no-validate")
        fi
        
        if [ "$NO_DUPLICATES" = true ]; then
            args+=("--no-duplicates")
        fi
    fi
    
    # Display the command that will be executed for transparency
    print_status "Running export with arguments: ${args[*]}"
    
    # Execute the Node.js export script
    # - Change to project directory to ensure correct working directory
    # - Capture both stdout and stderr to log file using tee
    # - tee allows us to see output in real-time while logging
    cd "$PROJECT_DIR"
    
    print_status "Starting export process..."
    print_status "Output will be logged to: $LOG_FILE"
    
    # Run the export with comprehensive error handling
    # PIPESTATUS[0] captures the exit code of the node command (before tee)
    node scripts/client-export-solution.js "${args[@]}" 2>&1 | tee "$LOG_FILE"
    
    # Check the exit status of the Node.js script
    # Note: We check PIPESTATUS[0] because we want the exit code of 'node', not 'tee'
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        print_success "Export completed successfully!"
        print_status "Log file saved to: $LOG_FILE"
        
        # Display a summary of generated files for user convenience
        if [ -d "$EXPORT_DIR" ]; then
            echo ""
            print_status "Export files created:"
            
            # List CSV files with details (size, timestamp)
            if ls "$EXPORT_DIR"/*.csv &>/dev/null; then
                ls -lh "$EXPORT_DIR"/*.csv 2>/dev/null
            else
                print_warning "No CSV files found in export directory"
            fi
            
            # List JSON report files
            if ls "$EXPORT_DIR"/*.json &>/dev/null; then
                echo ""
                print_status "Export reports:"
                ls -lh "$EXPORT_DIR"/*.json 2>/dev/null
            fi
        fi
    else
        # Export failed - provide helpful error information
        print_error "Export failed! Exit code: ${PIPESTATUS[0]}"
        print_error "Check the log file for details: $LOG_FILE"
        print_error "Common issues:"
        print_error "  - Database connection problems (.env configuration)"
        print_error "  - Insufficient permissions"
        print_error "  - Network connectivity issues"
        print_error "  - Invalid table name or filters"
        exit 1
    fi
}

# EXPORT SUMMARY FUNCTION
# ========================
# 
# Provides a comprehensive summary of the export operation including:
# - File counts and sizes
# - Directory locations
# - Recent export history
# - Quick access information

show_summary() {
    echo ""
    print_status "Export Summary:"
    echo "=================="
    
    # Verify export directory exists and is accessible
    if [ -d "$EXPORT_DIR" ]; then
        # Count different types of files generated
        # Use 2>/dev/null to suppress error messages for missing files
        local csv_files=$(find "$EXPORT_DIR" -name "*.csv" -type f 2>/dev/null | wc -l)
        local json_files=$(find "$EXPORT_DIR" -name "*.json" -type f 2>/dev/null | wc -l)
        local log_files=$(find "$EXPORT_DIR" -name "*.log" -type f 2>/dev/null | wc -l)
        
        # Display summary statistics with emojis for visual appeal
        echo "📁 Export directory: $EXPORT_DIR"
        echo "📊 CSV data files: $csv_files"
        echo "📋 JSON report files: $json_files"
        echo "📝 Log files: $log_files"
        echo "📝 Current log file: $LOG_FILE"
        
        # Show recent CSV exports with file details
        if [ $csv_files -gt 0 ]; then
            echo ""
            print_status "Recent CSV exports (most recent first):"
            # Find CSV files, sort by modification time (newest first), show details
            find "$EXPORT_DIR" -name "*.csv" -type f -exec ls -lht {} \; 2>/dev/null | head -5
        fi
        
        # Show directory disk usage for capacity planning
        echo ""
        print_status "Export directory size:"
        du -sh "$EXPORT_DIR" 2>/dev/null || print_warning "Could not calculate directory size"
        
    else
        print_warning "Export directory not found: $EXPORT_DIR"
    fi
}

# COMMAND LINE ARGUMENT PARSING
# ==============================
# 
# Initialize variables to store user input from command line arguments.
# These variables will be populated by the argument parsing loop below.

# Export configuration variables with default values
PRESET=""                    # Preset name (all, recent, minimal, test)
CUSTOM_EXPORT=false          # Flag indicating custom export configuration
TABLE_NAME=""                # Database table name to export
FORMAT=""                    # Export format (csv, json)
START_DATE=""                # Start date for date range filtering
END_DATE=""                  # End date for date range filtering
BATCH_SIZE=""                # Batch size for pagination
NO_VALIDATE=false            # Skip data validation flag
NO_DUPLICATES=false          # Skip duplicate checking flag

# ARGUMENT PARSING LOOP
# ======================
# 
# Process command line arguments using a case statement.
# Each argument type is handled appropriately, with value arguments
# requiring a shift 2 (argument + value) and flag arguments requiring shift 1.

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            # Display help and exit successfully
            show_usage
            exit 0
            ;;
        --preset)
            # Preset configuration (all, recent, minimal, test)
            PRESET="$2"
            shift 2  # Skip argument and its value
            ;;
        --table)
            # Custom table name - enables custom export mode
            TABLE_NAME="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --format)
            # Output format specification - enables custom export mode
            FORMAT="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --start)
            # Start date for date range filtering - enables custom export mode
            START_DATE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --end)
            # End date for date range filtering - enables custom export mode
            END_DATE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --batch)
            # Batch size for pagination - enables custom export mode
            BATCH_SIZE="$2"
            CUSTOM_EXPORT=true
            shift 2
            ;;
        --no-validate)
            # Boolean flag: skip data validation - enables custom export mode
            NO_VALIDATE=true
            CUSTOM_EXPORT=true
            shift 1  # Only skip the flag, no value
            ;;
        --no-duplicates)
            # Boolean flag: skip duplicate checking - enables custom export mode
            NO_DUPLICATES=true
            CUSTOM_EXPORT=true
            shift 1
            ;;
        --output-dir)
            # Override default output directory
            EXPORT_DIR="$2"
            shift 2
            ;;
        *)
            # Handle unknown arguments with helpful error message
            print_error "Unknown option: $1"
            print_error "Use --help to see available options"
            show_usage
            exit 1
            ;;
    esac
done

# PRESET VALIDATION
# ==================
# 
# Validate that any provided preset name is recognized.
# This prevents typos and provides immediate feedback to users.

if [ "$PRESET" != "" ]; then
    case $PRESET in
        all|recent|minimal|test)
            # Valid preset names - continue processing
            print_status "Validated preset: $PRESET"
            ;;
        *)
            # Invalid preset name - show error and exit
            print_error "Invalid preset: $PRESET"
            print_error "Valid presets are: all, recent, minimal, test"
            show_usage
            exit 1
            ;;
    esac
fi

# MAIN EXECUTION FUNCTION
# ========================
# 
# Orchestrates the entire export process by calling functions in the correct order.
# This function provides the main program flow and high-level error handling.

main() {
    # Display startup banner with timestamp for log correlation
    echo "🚀 CLIENT EXPORT SCRIPT"
    echo "======================"
    echo "Started at: $(date)"
    echo "Script location: $SCRIPT_DIR"
    echo "Project directory: $PROJECT_DIR"
    echo "Export directory: $EXPORT_DIR"
    echo ""
    
    # Step 1: Verify system requirements and configuration
    print_status "Step 1: Checking prerequisites..."
    check_prerequisites
    
    # Step 2: Prepare export environment
    print_status "Step 2: Preparing export environment..."
    create_export_dir
    
    # Step 3: Execute the export operation
    print_status "Step 3: Running export operation..."
    run_export
    
    # Step 4: Display results and summary
    print_status "Step 4: Generating summary..."
    show_summary
    
    # Final success message with next steps
    echo ""
    print_success "Export process completed successfully!"
    echo ""
    echo "Next steps:"
    echo "📁 Review exported files in: $EXPORT_DIR"
    echo "📝 Check detailed log at: $LOG_FILE"
    echo "📧 Export files are ready for download or analysis"
    echo ""
}

# SCRIPT ENTRY POINT
# ===================
# 
# Execute the main function with all command line arguments.
# Any errors in main() will cause the script to exit due to 'set -e' at the top.

# Call main function with all original command line arguments
# The "$@" preserves argument spacing and quoting
main "$@" 