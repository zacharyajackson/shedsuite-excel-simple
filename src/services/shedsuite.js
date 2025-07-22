const https = require('https');
const { URL } = require('url');
const { logger } = require('../utils/logger');
const { ErrorHandler } = require('../utils/error-handler');

class ShedSuiteService {
  constructor() {
    // Validate required environment variables
    if (!process.env.API_BASE_URL) {
      throw new Error('API_BASE_URL is required');
    }
    if (!process.env.API_TOKEN) {
      throw new Error('API_TOKEN is required');
    }

    this.config = {
      baseUrl: process.env.API_BASE_URL.replace(/\/+$/, '').replace('API_BASE_URL=', ''),
      apiPath: process.env.API_PATH || 'api/public',
      endpoint: process.env.API_ENDPOINT || 'customer-orders/v1',
      authToken: process.env.API_TOKEN,
      pageSize: parseInt(process.env.PAGE_SIZE) || 1000,
      maxPages: parseInt(process.env.MAX_PAGES) || 1000,
      sortBy: process.env.SORT_BY || 'id',
      sortOrder: process.env.SORT_ORDER || 'asc',
      timeout: parseInt(process.env.API_TIMEOUT) || 60000,
      maxRetries: parseInt(process.env.API_MAX_RETRIES) || 3,
      retryDelay: parseInt(process.env.API_RETRY_DELAY) || 1000,
      maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 3
    };

    // Initialize enhanced error handler
    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.maxRetries,
      baseDelay: this.config.retryDelay,
      maxDelay: parseInt(process.env.API_MAX_RETRY_DELAY) || 30000,
      backoffMultiplier: parseFloat(process.env.API_BACKOFF_MULTIPLIER) || 2,
      jitterEnabled: process.env.API_JITTER_ENABLED !== 'false',
      circuitBreaker: {
        failureThreshold: parseInt(process.env.API_CIRCUIT_BREAKER_THRESHOLD) || 5,
        recoveryTimeout: parseInt(process.env.API_CIRCUIT_BREAKER_TIMEOUT) || 60000,
        monitoringPeriod: parseInt(process.env.API_CIRCUIT_BREAKER_MONITORING) || 10000
      }
    });

    logger.info('ShedSuite service configured:', {
      baseUrl: this.config.baseUrl,
      endpoint: this.config.endpoint,
      pageSize: this.config.pageSize,
      maxPages: this.config.maxPages,
      sortBy: this.config.sortBy,
      sortOrder: this.config.sortOrder,
      timeout: this.config.timeout,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      errorHandling: {
        maxRetries: this.config.maxRetries,
        baseDelay: this.config.retryDelay,
        circuitBreakerEnabled: true
      }
    });
  }

  async makeRequest(url, context = {}) {
    const operationContext = this.errorHandler.createErrorContext('api_request', {
      service: 'ShedSuiteService',
      url: url.replace(this.config.authToken, '***'),
      ...context
    });

    return await this.errorHandler.executeWithRetry(
      () => this.executeRequest(url),
      operationContext
    );
  }

  executeRequest(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          Authorization: `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'ShedSuite-Excel-Integration/2.0.0'
        },
        timeout: this.config.timeout
      };

      logger.debug('Making API request:', { url: url.replace(this.config.authToken, '***') });

      const request = https.get(url, options, (res) => {
        let data = '';
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsedData = JSON.parse(data);
              resolve(parsedData);
            } else {
              const error = new Error(`HTTP ${res.statusCode}: ${data}`);
              error.statusCode = res.statusCode;
              error.response = data;
              reject(error);
            }
          } catch (parseError) {
            reject(new Error(`JSON parsing failed: ${parseError.message}`));
          }
        });
      });

      request.on('error', (err) => {
        logger.error('Request error:', err);
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      });

      // Set timeout
      request.setTimeout(this.config.timeout);
    });
  }

  async getTotalRecordCount() {
    try {
      logger.debug('Getting total record count...');
      const url = this.buildApiUrl(1, {}, true);
      logger.info('API request for record count:', { url: url.replace(this.config.authToken, '***') });

      const data = await this.makeRequest(url);
      logger.info('API response received:', {
        keys: Object.keys(data),
        responseSize: JSON.stringify(data).length,
        hasData: !!data,
        dataStructure: typeof data,
        isArray: Array.isArray(data)
      });

      // Handle array response (no pagination)
      if (Array.isArray(data)) {
        logger.info(`Total records from array response: ${data.length}`);
        return data.length;
      }

      // Try different response formats for paginated responses
      let total = null;
      if (data.meta?.total !== undefined) total = data.meta.total;
      else if (data.total !== undefined) total = data.total;
      else if (data.pagination?.total !== undefined) total = data.pagination.total;
      else if (data.count !== undefined) total = data.count;
      else if (data.totalCount !== undefined) total = data.totalCount;

      if (total !== null) {
        logger.info(`Total records from metadata: ${total}`);
        return total;
      }

      // If we can't determine the count, use a reasonable default
      logger.warn('Unable to determine total record count from API response, using default page size', {
        availableFields: Object.keys(data),
        sampleData: JSON.stringify(data).substring(0, 500)
      });
      return this.config.pageSize;
    } catch (error) {
      logger.error('Error getting total record count:', error);
      throw error;
    }
  }

  buildApiUrl(page, filters = {}, countOnly = false) {
    try {
      // Build the full API path
      let apiPath = this.config.endpoint;
      if (this.config.apiPath) {
        apiPath = `${this.config.apiPath}/${this.config.endpoint}`;
      }

      const url = new URL(apiPath, this.config.baseUrl + '/');

      const pageSize = filters.pageSize || this.config.pageSize;

      // Add pagination parameters
      url.searchParams.append('limit', countOnly ? 1 : pageSize);
      url.searchParams.append('offset', countOnly ? 0 : (page - 1) * pageSize);

      // Add sorting parameters (not for count-only requests)
      if (!countOnly) {
        url.searchParams.append('sortOrder', this.config.sortOrder);
        url.searchParams.append('sortBy', this.config.sortBy);
      }

      // Add filter parameters
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && key !== 'page' && key !== 'pageSize') {
          // Handle different filter formats
          if (key === 'updatedAfter' && value) {
            url.searchParams.append('dateUpdated[gte]', value);
          } else {
            url.searchParams.append(key, value);
          }
        }
      });

      const finalUrl = url.toString();
      logger.debug('Built API URL:', finalUrl.replace(this.config.authToken, '***'));
      return finalUrl;
    } catch (error) {
      logger.error('Error building API URL:', error);
      throw error;
    }
  }

  async fetchAllRecords(filters = {}) {
    const startTime = Date.now();
    logger.info('Starting data fetch from ShedSuite API...', { filters });

    try {
      let allRecords = [];
      let page = 1;
      let hasMoreData = true;
      const pageSize = filters.pageSize || this.config.pageSize;
      let consecutiveEmptyPages = 0;
      const maxEmptyPages = parseInt(process.env.MAX_CONSECUTIVE_EMPTY_PAGES) || 5;

      while (hasMoreData && page <= this.config.maxPages) {
        const pageUrl = this.buildApiUrl(page, filters);
        logger.info(`Fetching page ${page}...`, {
          url: pageUrl.replace(this.config.authToken, '***'),
          offset: (page - 1) * pageSize
        });

        try {
          const pageData = await this.makeRequest(pageUrl);
          const pageRecords = this.extractRecords(pageData);

          logger.info(`Page ${page} fetched:`, {
            recordsInPage: pageRecords.length,
            totalRecordsSoFar: allRecords.length + pageRecords.length,
            consecutiveEmptyPages
          });

          if (pageRecords.length === 0) {
            consecutiveEmptyPages++;
            logger.info(`Empty page ${page} (${consecutiveEmptyPages}/${maxEmptyPages} consecutive empty pages)`);

            if (consecutiveEmptyPages >= maxEmptyPages) {
              logger.info('Multiple consecutive empty pages found, stopping pagination');
              hasMoreData = false;
            } else {
              page++;
            }
          } else {
            consecutiveEmptyPages = 0;
            allRecords = allRecords.concat(pageRecords);

            // More forgiving stopping condition to handle date parsing issues
            if (pageRecords.length < (pageSize * (parseFloat(process.env.MIN_PAGE_SIZE_THRESHOLD) || 0.05))) {
              logger.info(`Page ${page} had only ${pageRecords.length} records (very small compared to page size ${pageSize}), stopping pagination`);
              hasMoreData = false;
            } else {
              page++;
            }
          }
        } catch (pageError) {
          logger.error(`Error fetching page ${page}:`, {
            error: pageError.message,
            page,
            url: pageUrl.replace(this.config.authToken, '***')
          });

          // If it's a date-related error, try to continue
          if (pageError.message.includes('date') || pageError.message.includes('5/27') || pageError.message.includes('parsing')) {
            logger.warn('Date-related error detected, skipping to next page...');
            page++;
            continue;
          }

          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= maxEmptyPages) {
            logger.error('Too many consecutive errors, stopping pagination');
            break;
          }
          page++;
        }

        // Add a small delay between requests to avoid overwhelming the API
        if (hasMoreData && page <= this.config.maxPages) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Data fetch completed:', {
        totalRecords: allRecords.length,
        pagesProcessed: page,
        totalDuration: `${duration}ms`,
        averageTimePerPage: `${Math.round(duration / page)}ms`,
        recordsPerSecond: Math.round((allRecords.length / duration) * 1000)
      });

      return allRecords;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Data fetch failed:', {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });
      throw error;
    }
  }

  extractRecords(data) {
    // Handle the actual API response format we're seeing
    if (Array.isArray(data)) {
      logger.info('Processing array response:', {
        recordCount: data.length,
        sampleRecord: data[0]
          ? {
            id: data[0].id,
            balanceDollarAmount: data[0].balanceDollarAmount,
            billingCity: data[0].billingCity,
            billingState: data[0].billingState
          }
          : 'No records'
      });
      return data;
    }

    // Try other response formats if array format changes
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }

    if (data.results && Array.isArray(data.results)) {
      return data.results;
    }

    if (data.records && Array.isArray(data.records)) {
      return data.records;
    }

    if (data.items && Array.isArray(data.items)) {
      return data.items;
    }

    logger.warn('Unexpected API response format:', {
      keys: Object.keys(data),
      dataType: typeof data,
      isArray: Array.isArray(data),
      sampleData: JSON.stringify(data).substring(0, 500)
    });

    return [];
  }

  formatRecordsForExport(records) {
    const startTime = Date.now();
    logger.info(`Formatting ${records.length} records for export...`);

    if (!records || records.length === 0) {
      logger.warn('No records to format');
      return [];
    }

    // Add deduplication to handle duplicate customer records
    const deduplicatedRecords = this.deduplicateByCustomerId(records);

    const sampleRecord = deduplicatedRecords[0];
    logger.info('Sample record structure:', {
      keys: Object.keys(sampleRecord),
      sampleValues: {
        id: sampleRecord.id,
        balanceDollarAmount: sampleRecord.balanceDollarAmount,
        billingCity: sampleRecord.billingCity,
        billingState: sampleRecord.billingState,
        buildingAddons: sampleRecord.buildingAddons
      }
    });

    const formattedRecords = deduplicatedRecords.map(record => {
      try {
        // Format building addons as a string
        let buildingAddonsStr = '';
        if (record.buildingAddons && Array.isArray(record.buildingAddons)) {
          buildingAddonsStr = record.buildingAddons.map(addon =>
            `${addon.name || ''} (${addon.quantity || 1}x @ $${addon.price || '0.00'})`).join('; ');
        }

        // Format custom addons similarly
        let customAddonsStr = '';
        if (record.buildingCustomAddons && Array.isArray(record.buildingCustomAddons)) {
          customAddonsStr = record.buildingCustomAddons.map(addon =>
            `${addon.name || ''} (${addon.quantity || 1}x @ $${addon.price || '0.00'})`).join('; ');
        }

        // Determine the most recent date for timestamp
        const dates = [
          record.dateOrdered,
          record.dateUpdated,
          record.dateDelivered,
          record.dateCancelled,
          record.dateFinished,
          record.dateProcessed,
          record.dateScheduledForDelivery
        ].filter(d => d).map(d => new Date(d)).filter(d => !isNaN(d.getTime()));

        const mostRecentDate = dates.length > 0
          ? new Date(Math.max(...dates))
          : new Date();

        return {
          // Main identifiers
          id: this.safeValue(record.id),
          balance_dollar_amount: this.formatCurrency(record.balanceDollarAmount),

          // Billing Address
          billing_address_line_one: this.safeValue(record.billingAddressLineOne),
          billing_address_line_two: this.safeValue(record.billingAddressLineTwo),
          billing_city: this.safeValue(record.billingCity),
          billing_state: this.safeValue(record.billingState),
          billing_zip: this.safeValue(record.billingZip),

          // Building Information
          building_addons: buildingAddonsStr,
          building_condition: this.safeValue(record.buildingCondition),
          building_custom_addons: customAddonsStr,
          building_length: this.safeValue(record.buildingLength),
          building_model_name: this.safeValue(record.buildingModelName),
          building_roof_color: this.safeValue(record.buildingRoofColor),
          building_roof_type: this.safeValue(record.buildingRoofType),
          building_siding_color: this.safeValue(record.buildingSidingColor),
          building_siding_type: this.safeValue(record.buildingSidingType),
          building_size: this.safeValue(record.buildingSize),
          building_width: this.safeValue(record.buildingWidth),

          // Company/Dealer Information
          company_id: this.safeValue(record.companyId),
          county_tax_rate: this.formatCurrency(record.countyTaxRate),

          // Customer Information
          customer_name: this.safeValue(record.customerName),
          customer_email: this.safeValue(record.customerEmail),
          customer_first_name: this.safeValue(record.customerFirstName),
          customer_id: this.safeValue(record.customerId),
          customer_last_name: this.safeValue(record.customerLastName),
          customer_phone_primary: this.safeValue(record.customerPhonePrimary),
          customer_source: this.safeValue(record.customerSource),

          // Dates
          date_delivered: this.formatDate(record.dateDelivered),
          date_cancelled: this.formatDate(record.dateCancelled),
          date_finished: this.formatDate(record.dateFinished),
          date_ordered: this.formatDate(record.dateOrdered),
          date_processed: this.formatDate(record.dateProcessed),
          date_scheduled_for_delivery: this.formatDate(record.dateScheduledForDelivery),

          // Dealer Information
          dealer_id: this.safeValue(record.dealerId),
          dealer_primary_sales_rep: this.safeValue(record.dealerPrimarySalesRep),

          // Delivery Address
          delivery_address_line_one: this.safeValue(record.deliveryAddressLineOne),
          delivery_address_line_two: this.safeValue(record.deliveryAddressLineTwo),
          delivery_city: this.safeValue(record.deliveryCity),
          delivery_state: this.safeValue(record.deliveryState),
          delivery_zip: this.safeValue(record.deliveryZip),

          // Driver and Payment
          driver_name: this.safeValue(record.driverName),
          initial_payment_dollar_amount: this.formatCurrency(record.initialPaymentDollarAmount),
          initial_payment_type: this.safeValue(record.initialPaymentType),
          invoice_url: this.safeValue(record.invoiceURL),

          // Order Information
          order_number: this.safeValue(record.orderNumber),
          order_type: this.safeValue(record.orderType),

          // Promocode Information
          promocode_code: this.safeValue(record.promocodeCode),
          promocode_name: this.safeValue(record.promocodeName),
          promocode_amount_discounted: this.formatCurrency(record.promocodeAmountDiscounted),
          promocode_type: this.safeValue(record.promocodeType),
          promocode_value: this.safeValue(record.promocodeValue),
          promocode_target: this.safeValue(record.promocodeTarget),

          // RTO Information
          rto: this.safeValue(record.rto),
          rto_company_name: this.safeValue(record.rtoCompanyName),
          rto_months_of_term: this.safeValue(record.rtoMonthsOfTerm),

          // Additional Information
          serial_number: this.safeValue(record.serialNumber),
          shop_name: this.safeValue(record.shopName),
          sold_by_dealer: this.safeValue(record.soldByDealer),
          sold_by_dealer_id: this.safeValue(record.soldByDealerId),
          sold_by_dealer_user: this.safeValue(record.soldByDealerUser),

          // Tax Information
          special_district: this.safeValue(record.specialDistrict),
          special_district_rate: this.formatCurrency(record.specialDistrictRate),
          special_district_tax_dollar_amount: this.formatCurrency(record.specialDistrictTaxDollarAmount),
          state: this.safeValue(record.state),
          state_tax_dollar_amount: this.formatCurrency(record.stateTaxDollarAmount),
          state_tax_rate: this.formatCurrency(record.stateTaxRate),
          status: this.safeValue(record.status),

          // Totals and Adjustments
          sub_total_dollar_amount: this.formatCurrency(record.subTotalDollarAmount),
          sub_total_adjustment_dollar_amount: this.formatCurrency(record.subTotalAdjustmentDollarAmount),
          sub_total_adjustment_note: this.safeValue(record.subTotalAdjustmentNote),
          total_amount_dollar_amount: this.formatCurrency(record.totalAmountDollarAmount),
          total_tax_dollar_amount: this.formatCurrency(record.totalTaxDollarAmount),

          // City/County Tax
          tax_city: this.safeValue(record.taxCity),
          tax_city_dollar_amount: this.formatCurrency(record.taxCityDollarAmount),
          tax_city_rate: this.formatCurrency(record.taxCityRate),
          tax_county: this.safeValue(record.taxCounty),
          tax_county_dollar_amount: this.formatCurrency(record.taxCountyDollarAmount),
          tax_county_rate: this.formatCurrency(record.taxCountyRate),

          // Timestamp - most recent update
          timestamp: mostRecentDate.toISOString()
        };
      } catch (error) {
        logger.error('Error formatting record:', {
          recordId: record.id,
          error: error.message,
          recordData: JSON.stringify(record).substring(0, 500)
        });
        return null;
      }
    }).filter(record => record !== null); // Remove any records that failed to format

    // Log statistics about the data
    const recordsWithCountyTaxRate = formattedRecords.filter(r => r.county_tax_rate && r.county_tax_rate !== '').length;
    const recordsWithStateTaxRate = formattedRecords.filter(r => r.state_tax_rate && r.state_tax_rate !== '').length;

    logger.info('Data field statistics:', {
      totalRecords: formattedRecords.length,
      recordsWithCountyTaxRate,
      recordsWithStateTaxRate,
      countyTaxRatePercentage: `${Math.round((recordsWithCountyTaxRate / formattedRecords.length) * 100)}%`,
      stateTaxRatePercentage: `${Math.round((recordsWithStateTaxRate / formattedRecords.length) * 100)}%`
    });

    const duration = Date.now() - startTime;
    logger.info('Record formatting completed:', {
      originalCount: records.length,
      formattedCount: formattedRecords.length,
      duration: `${duration}ms`,
      sampleFormatted: formattedRecords[0]
        ? {
          id: formattedRecords[0].id,
          order_number: formattedRecords[0].order_number,
          customer_name: formattedRecords[0].customer_name,
          timestamp: formattedRecords[0].timestamp,
          balance_dollar_amount: formattedRecords[0].balance_dollar_amount
        }
        : 'No records formatted'
    });

    return formattedRecords;
  }

  safeValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  formatDate(dateValue) {
    if (!dateValue) return '';

    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '';

      // Return ISO date string
      return date.toISOString().split('T')[0];
    } catch (error) {
      logger.warn('Invalid date value:', dateValue);
      return '';
    }
  }

  formatCurrency(value) {
    if (!value) return '';

    try {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) return '';

      return numValue.toFixed(2);
    } catch (error) {
      logger.warn('Invalid currency value:', value);
      return '';
    }
  }

  // Health check method
  async healthCheck() {
    try {
      logger.debug('Performing ShedSuite API health check...');

      // Try to get total count as a simple connectivity test
      const url = this.buildApiUrl(1, {}, true);
      const startTime = Date.now();
      await this.makeRequest(url);
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
        endpoint: this.config.baseUrl
      };
    } catch (error) {
      logger.error('ShedSuite API health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
        endpoint: this.config.baseUrl
      };
    }
  }

  deduplicateByCustomerId(records) {
    const customerMap = new Map();
    let duplicatesRemoved = 0;

    logger.info(`Starting deduplication of ${records.length} records...`);

    records.forEach((record, index) => {
      const customerId = record.customerId || record.customer_id;
      if (!customerId) {
        logger.warn(`Record at index ${index} has no customer ID`, {
          recordId: record.id,
          orderNumber: record.orderNumber
        });
        return;
      }

      const existing = customerMap.get(customerId);
      if (!existing) {
        customerMap.set(customerId, record);
      } else {
        duplicatesRemoved++;

        // Keep the record with the most recent update
        const existingDate = new Date(existing.dateUpdated || existing.dateOrdered || existing.timestamp || 0);
        const currentDate = new Date(record.dateUpdated || record.dateOrdered || record.timestamp || 0);

        if (currentDate > existingDate) {
          logger.debug(`Replacing older record for customer ${customerId}`, {
            oldDate: existingDate.toISOString(),
            newDate: currentDate.toISOString(),
            oldStatus: existing.status,
            newStatus: record.status,
            oldId: existing.id,
            newId: record.id
          });
          customerMap.set(customerId, record);
        }
      }
    });

    const deduplicated = Array.from(customerMap.values());
    logger.info('Deduplication complete:', {
      originalCount: records.length,
      deduplicatedCount: deduplicated.length,
      duplicatesRemoved,
      uniqueCustomers: customerMap.size
    });

    return deduplicated;
  }
}

module.exports = new ShedSuiteService();
