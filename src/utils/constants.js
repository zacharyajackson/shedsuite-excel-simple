/**
 * Application constants and configuration values
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

// API Configuration
const API_DEFAULTS = {
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  PAGE_SIZE: 100,
  MAX_PAGES: 1000
};

// Excel Configuration
const EXCEL_DEFAULTS = {
  BATCH_SIZE: 25,
  SESSION_TIMEOUT: 300000,
  MAX_COLUMNS: 21,
  COLUMN_RANGE: 'A:U'
};

// Monitoring Configuration
const MONITORING_DEFAULTS = {
  POLLING_INTERVAL_MS: 60000,
  FULL_SYNC_INTERVAL_HOURS: 24,
  MAX_CONCURRENT_SYNCS: 1,
  MAX_EMPTY_PAGES: 3
};

// Rate Limiting
const RATE_LIMITING = {
  WINDOW_MS: 60000, // 1 minute
  MAX_REQUESTS: 5,
  MAX_GENERAL_REQUESTS: 100,
  GENERAL_WINDOW_MS: 900000 // 15 minutes
};

// Error Categories
const ERROR_CATEGORIES = {
  AUTHENTICATION: 'authentication',
  RATE_LIMIT: 'rate_limit',
  NETWORK: 'network',
  VALIDATION: 'validation',
  EXCEL: 'excel',
  API: 'api',
  CONFIGURATION: 'configuration'
};

// Retry Configuration
const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 1000,
  MAX_DELAY: 10000,
  EXPONENTIAL_BASE: 2,
  JITTER: true
};

// Health Check Status
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  DEGRADED: 'degraded'
};

// Sync Types
const SYNC_TYPES = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  TARGETED: 'targeted'
};

// Log Levels
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

// Field Mappings for ShedSuite to Excel
const FIELD_MAPPINGS = {
  ID: 'id',
  ORDER_NUMBER: 'order_number',
  CUSTOMER_NAME: 'customer_name',
  STATUS: 'status',
  DATE_ORDERED: 'date_ordered',
  DATE_UPDATED: 'date_updated',
  BUILDING_MODEL_NAME: 'building_model_name',
  BUILDING_SIZE: 'building_size',
  TOTAL_AMOUNT: 'total_amount_dollar_amount',
  BALANCE_AMOUNT: 'balance_dollar_amount',
  CUSTOMER_EMAIL: 'customer_email',
  CUSTOMER_PHONE: 'customer_phone_primary',
  DELIVERY_ADDRESS: 'delivery_address',
  CUSTOMER_SOURCE: 'customer_source',
  DATE_DELIVERED: 'date_delivered',
  DATE_CANCELLED: 'date_cancelled',
  DATE_FINISHED: 'date_finished',
  DATE_PROCESSED: 'date_processed',
  DATE_SCHEDULED_FOR_DELIVERY: 'date_scheduled_for_delivery',
  DEALER_ID: 'dealer_id',
  DEALER_PRIMARY_DELIVERY_ADDRESS: 'dealer_primary_delivery_address'
};

// Excel Column Headers
const EXCEL_HEADERS = [
  'ID',
  'Order Number',
  'Customer Name',
  'Status',
  'Date Ordered',
  'Date Updated',
  'Building Model',
  'Building Size',
  'Total Amount',
  'Balance Amount',
  'Customer Email',
  'Customer Phone',
  'Delivery Address',
  'Customer Source',
  'Date Delivered',
  'Date Cancelled',
  'Date Finished',
  'Date Processed',
  'Date Scheduled for Delivery',
  'Dealer ID',
  'Dealer Primary Delivery Address'
];

// Validation Rules
const VALIDATION_RULES = {
  PAGE: {
    MIN: 1,
    MAX: 10000
  },
  PAGE_SIZE: {
    MIN: 1,
    MAX: 1000
  },
  POLLING_INTERVAL: {
    MIN: 10000, // 10 seconds
    MAX: 3600000 // 1 hour
  },
  BATCH_SIZE: {
    MIN: 1,
    MAX: 100
  }
};

// Common Regex Patterns
const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s\-\(\)]+$/,
  ISO_DATE: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

// Cache Keys
const CACHE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  SITE_ID: 'site_id',
  EXCEL_METADATA: 'excel_metadata',
  API_RESPONSE: 'api_response'
};

// Time Constants (in milliseconds)
const TIME_CONSTANTS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000
};

module.exports = {
  HTTP_STATUS,
  API_DEFAULTS,
  EXCEL_DEFAULTS,
  MONITORING_DEFAULTS,
  RATE_LIMITING,
  ERROR_CATEGORIES,
  RETRY_CONFIG,
  HEALTH_STATUS,
  SYNC_TYPES,
  LOG_LEVELS,
  FIELD_MAPPINGS,
  EXCEL_HEADERS,
  VALIDATION_RULES,
  REGEX_PATTERNS,
  CACHE_KEYS,
  TIME_CONSTANTS
};
