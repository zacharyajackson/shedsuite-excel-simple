const { VALIDATION_RULES, REGEX_PATTERNS } = require('./constants');

/**
 * Validation utility functions
 */
class Validators {
  /**
   * Validate pagination parameters
   * @param {number} page Page number
   * @param {number} pageSize Page size
   * @returns {Object} Validation result
   */
  static validatePagination(page, pageSize) {
    const errors = [];

    if (page !== undefined) {
      if (!Number.isInteger(page) || page < VALIDATION_RULES.PAGE.MIN || page > VALIDATION_RULES.PAGE.MAX) {
        errors.push(`Page must be an integer between ${VALIDATION_RULES.PAGE.MIN} and ${VALIDATION_RULES.PAGE.MAX}`);
      }
    }

    if (pageSize !== undefined) {
      if (!Number.isInteger(pageSize) || pageSize < VALIDATION_RULES.PAGE_SIZE.MIN || pageSize > VALIDATION_RULES.PAGE_SIZE.MAX) {
        errors.push(`Page size must be an integer between ${VALIDATION_RULES.PAGE_SIZE.MIN} and ${VALIDATION_RULES.PAGE_SIZE.MAX}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate email address
   * @param {string} email Email address
   * @returns {boolean} Is valid email
   */
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return REGEX_PATTERNS.EMAIL.test(email.trim());
  }

  /**
   * Validate phone number
   * @param {string} phone Phone number
   * @returns {boolean} Is valid phone
   */
  static isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    return REGEX_PATTERNS.PHONE.test(phone.trim());
  }

  /**
   * Validate ISO date string
   * @param {string} dateString Date string
   * @returns {boolean} Is valid ISO date
   */
  static isValidISODate(dateString) {
    if (!dateString || typeof dateString !== 'string') return false;

    if (!REGEX_PATTERNS.ISO_DATE.test(dateString)) return false;

    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }

  /**
   * Validate UUID
   * @param {string} uuid UUID string
   * @returns {boolean} Is valid UUID
   */
  static isValidUUID(uuid) {
    if (!uuid || typeof uuid !== 'string') return false;
    return REGEX_PATTERNS.UUID.test(uuid);
  }

  /**
   * Validate polling interval
   * @param {number} interval Polling interval in milliseconds
   * @returns {Object} Validation result
   */
  static validatePollingInterval(interval) {
    const errors = [];

    if (interval !== undefined) {
      if (!Number.isInteger(interval) || interval < VALIDATION_RULES.POLLING_INTERVAL.MIN || interval > VALIDATION_RULES.POLLING_INTERVAL.MAX) {
        errors.push(`Polling interval must be between ${VALIDATION_RULES.POLLING_INTERVAL.MIN}ms and ${VALIDATION_RULES.POLLING_INTERVAL.MAX}ms`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate batch size
   * @param {number} batchSize Batch size
   * @returns {Object} Validation result
   */
  static validateBatchSize(batchSize) {
    const errors = [];

    if (batchSize !== undefined) {
      if (!Number.isInteger(batchSize) || batchSize < VALIDATION_RULES.BATCH_SIZE.MIN || batchSize > VALIDATION_RULES.BATCH_SIZE.MAX) {
        errors.push(`Batch size must be between ${VALIDATION_RULES.BATCH_SIZE.MIN} and ${VALIDATION_RULES.BATCH_SIZE.MAX}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate cron expression
   * @param {string} cronExpression Cron expression
   * @returns {Object} Validation result
   */
  static validateCronExpression(cronExpression) {
    const errors = [];

    if (cronExpression !== undefined && cronExpression !== null && cronExpression !== '') {
      if (typeof cronExpression !== 'string') {
        errors.push('Cron expression must be a string');
      } else {
        // Basic cron validation (6 fields for node-cron: second minute hour day month dayOfWeek)
        const parts = cronExpression.trim().split(/\s+/);
        if (parts.length !== 6) {
          errors.push('Cron expression must have exactly 6 fields (second minute hour day month dayOfWeek)');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate monitoring configuration
   * @param {Object} config Monitoring configuration
   * @returns {Object} Validation result
   */
  static validateMonitoringConfig(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be an object');
      return { isValid: false, errors };
    }

    // Validate polling interval
    if (config.pollingIntervalMs !== undefined) {
      const pollingValidation = this.validatePollingInterval(config.pollingIntervalMs);
      if (!pollingValidation.isValid) {
        errors.push(...pollingValidation.errors);
      }
    }

    // Validate cron schedule
    if (config.cronSchedule !== undefined) {
      const cronValidation = this.validateCronExpression(config.cronSchedule);
      if (!cronValidation.isValid) {
        errors.push(...cronValidation.errors);
      }
    }

    // Validate full sync interval
    if (config.fullSyncInterval !== undefined) {
      if (!Number.isInteger(config.fullSyncInterval) || config.fullSyncInterval < 0 || config.fullSyncInterval > 168) {
        errors.push('Full sync interval must be between 0 and 168 hours');
      }
    }

    // Validate max concurrent syncs
    if (config.maxConcurrentSyncs !== undefined) {
      if (!Number.isInteger(config.maxConcurrentSyncs) || config.maxConcurrentSyncs < 1 || config.maxConcurrentSyncs > 10) {
        errors.push('Max concurrent syncs must be between 1 and 10');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate filter parameters
   * @param {Object} filters Filter object
   * @returns {Object} Validation result
   */
  static validateFilters(filters) {
    const errors = [];

    if (!filters || typeof filters !== 'object') {
      return { isValid: true, errors: [] }; // Filters are optional
    }

    // Validate updatedAfter date
    if (filters.updatedAfter !== undefined) {
      if (!this.isValidISODate(filters.updatedAfter)) {
        errors.push('updatedAfter must be a valid ISO date string');
      }
    }

    // Validate dateFrom
    if (filters.dateFrom !== undefined) {
      if (!this.isValidISODate(filters.dateFrom)) {
        errors.push('dateFrom must be a valid ISO date string');
      }
    }

    // Validate dateTo
    if (filters.dateTo !== undefined) {
      if (!this.isValidISODate(filters.dateTo)) {
        errors.push('dateTo must be a valid ISO date string');
      }
    }

    // Validate date range
    if (filters.dateFrom && filters.dateTo) {
      const fromDate = new Date(filters.dateFrom);
      const toDate = new Date(filters.dateTo);
      if (fromDate >= toDate) {
        errors.push('dateFrom must be earlier than dateTo');
      }
    }

    // Validate status (if provided, should be a non-empty string)
    if (filters.status !== undefined) {
      if (typeof filters.status !== 'string' || filters.status.trim().length === 0) {
        errors.push('status must be a non-empty string');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate environment configuration
   * @param {Object} env Environment variables
   * @returns {Object} Validation result
   */
  static validateEnvironmentConfig(env) {
    const errors = [];
    const required = [
      'API_BASE_URL',
      'API_TOKEN',
      'AZURE_CLIENT_ID',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_SECRET'
    ];

    // Check required variables
    for (const variable of required) {
      if (!env[variable] || typeof env[variable] !== 'string' || env[variable].trim().length === 0) {
        errors.push(`${variable} is required and must be a non-empty string`);
      }
    }

    // Validate URLs
    if (env.API_BASE_URL) {
      try {
        new URL(env.API_BASE_URL);
      } catch (error) {
        errors.push('API_BASE_URL must be a valid URL');
      }
    }

    // Validate numeric values
    const numericFields = [
      'PORT',
      'API_TIMEOUT',
      'API_MAX_RETRIES',
      'PAGE_SIZE',
      'EXCEL_BATCH_SIZE',
      'MONITORING_POLLING_INTERVAL_MS'
    ];

    for (const field of numericFields) {
      if (env[field] !== undefined) {
        const value = parseInt(env[field]);
        if (isNaN(value) || value < 0) {
          errors.push(`${field} must be a positive integer`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize and validate string input
   * @param {any} input Input to sanitize
   * @param {Object} options Sanitization options
   * @returns {string} Sanitized string
   */
  static sanitizeString(input, options = {}) {
    const {
      maxLength = 1000,
      allowEmpty = false,
      trim = true,
      toLowerCase = false,
      toUpperCase = false
    } = options;

    if (input === null || input === undefined) {
      return allowEmpty ? '' : null;
    }

    let sanitized = String(input);

    if (trim) {
      sanitized = sanitized.trim();
    }

    if (!allowEmpty && sanitized.length === 0) {
      return null;
    }

    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    if (toLowerCase) {
      sanitized = sanitized.toLowerCase();
    } else if (toUpperCase) {
      sanitized = sanitized.toUpperCase();
    }

    return sanitized;
  }

  /**
   * Validate and sanitize record data
   * @param {Object} record Record object
   * @returns {Object} Validation result with sanitized data
   */
  static validateAndSanitizeRecord(record) {
    const errors = [];
    const sanitized = {};

    if (!record || typeof record !== 'object') {
      errors.push('Record must be an object');
      return { isValid: false, errors, data: null };
    }

    // Required fields
    if (!record.id) {
      errors.push('Record ID is required');
    } else {
      sanitized.id = this.sanitizeString(record.id, { maxLength: 100 });
    }

    // Optional fields with sanitization
    const stringFields = [
      'order_number', 'customer_name', 'status', 'building_model_name',
      'building_size', 'customer_email', 'customer_phone_primary',
      'delivery_address', 'customer_source', 'dealer_id',
      'dealer_primary_delivery_address'
    ];

    for (const field of stringFields) {
      if (record[field] !== undefined) {
        sanitized[field] = this.sanitizeString(record[field], {
          maxLength: field === 'delivery_address' || field === 'dealer_primary_delivery_address' ? 500 : 255,
          allowEmpty: true
        });
      }
    }

    // Date fields
    const dateFields = [
      'date_ordered', 'date_updated', 'date_delivered', 'date_cancelled',
      'date_finished', 'date_processed', 'date_scheduled_for_delivery'
    ];

    for (const field of dateFields) {
      if (record[field] !== undefined && record[field] !== '') {
        if (!this.isValidISODate(record[field])) {
          errors.push(`${field} must be a valid ISO date string`);
        } else {
          sanitized[field] = record[field];
        }
      }
    }

    // Email validation
    if (record.customer_email && !this.isValidEmail(record.customer_email)) {
      errors.push('customer_email must be a valid email address');
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: sanitized
    };
  }
}

module.exports = Validators;
