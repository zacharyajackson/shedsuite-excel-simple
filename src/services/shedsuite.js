const https = require('https');
const { URL } = require('url');
const { logger } = require('../utils/logger');
const { ErrorHandler } = require('../utils/error-handler');
const shedSuiteLog = require('../utils/shedsuite-logger');

class ShedSuiteService {
  constructor() {
    this._initialized = false;
    this.config = null;
    this.errorHandler = null;
  }

  _initialize() {
    if (this._initialized) {
      return;
    }

    // Validate required environment variables with more graceful handling
    if (!process.env.API_BASE_URL) {
      logger.warn('API_BASE_URL is not available yet, service will be unavailable');
      throw new Error('API_BASE_URL is required');
    }
    if (!process.env.API_TOKEN) {
      logger.warn('API_TOKEN is not available yet, service will be unavailable');
      throw new Error('API_TOKEN is required');
    }

    this.config = {
      baseUrl: process.env.API_BASE_URL.replace(/\/+$/, '').replace('API_BASE_URL=', ''),
      apiPath: process.env.API_PATH || 'api/public',
      endpoint: process.env.API_ENDPOINT || 'customer-orders/v1',
      authToken: process.env.API_TOKEN,
      pageSize: parseInt(process.env.PAGE_SIZE) || 100,
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

    this._initialized = true;
  }

  async makeRequest(url, context = {}) {
    this._initialize(); // Ensure config and errorHandler are initialized
    const operationContext = this.errorHandler.createErrorContext('api_request', {
      service: 'ShedSuiteService',
      url: url.replace(this.config.authToken, '***'),
      ...context
    });

    // Check if this is an authentication error and don't retry
    try {
      const result = await this.executeRequest(url);
      return result;
    } catch (error) {
      // If it's an authentication error (401, 403), don't retry
      if (error.statusCode === 401 || error.statusCode === 403) {
        logger.error('Authentication failed - API token may be expired:', {
          statusCode: error.statusCode,
          message: error.message,
          url: url.replace(this.config.authToken, '***')
        });
        throw new Error(`Authentication failed: ${error.message}`);
      }
      
      // For other errors, use the retry mechanism
      return await this.errorHandler.executeWithRetry(
        () => this.executeRequest(url),
        operationContext
      );
    }
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

      console.log(`🌐 Starting HTTP request (timeout: ${this.config.timeout}ms)...`);
      logger.debug('Making API request:', { url: url.replace(this.config.authToken, '***') });

      const request = https.get(url, options, (res) => {
        console.log(`📡 HTTP response received: ${res.statusCode} ${res.statusMessage}`);
        let data = '';
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
          data += chunk;
        });

        res.on('end', () => {
          console.log(`📦 Response body received (${data.length} characters)`);
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsedData = JSON.parse(data);
              console.log(`✅ JSON parsed successfully`);
              resolve(parsedData);
            } else {
              const error = new Error(`HTTP ${res.statusCode}: ${data}`);
              error.statusCode = res.statusCode;
              error.response = data;
              console.error(`❌ HTTP error: ${res.statusCode}`);
              reject(error);
            }
          } catch (parseError) {
            console.error(`❌ JSON parsing failed: ${parseError.message}`);
            reject(new Error(`JSON parsing failed: ${parseError.message}`));
          }
        });
      });

      request.on('error', (err) => {
        console.error(`❌ Request error: ${err.message}`);
        logger.error('Request error:', err);
        reject(err);
      });

      request.on('timeout', () => {
        console.error(`⏰ Request timeout after ${this.config.timeout}ms`);
        request.destroy();
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      });

      // Set timeout
      request.setTimeout(this.config.timeout);
    });
  }

  async getTotalRecordCount() {
    this._initialize(); // Ensure config and errorHandler are initialized
    const startTime = Date.now();
    
    try {
      shedSuiteLog.fetching(`Getting total record count`);
      
      // Since the API doesn't provide total count metadata, we'll make a conservative estimate
      // based on the fact that this is a production system with many records
      const duration = Date.now() - startTime;
      
      shedSuiteLog.fetching(`API does not provide total count metadata, using conservative estimate`, {
        estimate: 100000,
        duration: `${duration}ms`,
        reason: 'production_system_conservative_estimate'
      });
      
      return 100000; // Conservative estimate for production
    } catch (error) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.error(`Error getting total record count`, error, {
        duration: `${duration}ms`
      });
      
      // Return a conservative estimate instead of throwing
      shedSuiteLog.warn(`Using conservative estimate of 100k records due to error`, {
        estimate: 100000,
        reason: 'error_fallback'
      });
      
      return 100000;
    }
  }

  buildApiUrl(page, filters = {}, countOnly = false) {
    this._initialize(); // Ensure config and errorHandler are initialized
    const startTime = Date.now();
    
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
      const duration = Date.now() - startTime;
      
      shedSuiteLog.http(`Built API URL`, {
        page: page,
        countOnly: countOnly,
        pageSize: pageSize,
        filters: Object.keys(filters),
        duration: `${duration}ms`,
        url: finalUrl.replace(this.config.authToken, '***')
      });
      
      return finalUrl;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.error(`Error building API URL`, error, {
        duration: `${duration}ms`,
        page: page,
        countOnly: countOnly,
        filters: Object.keys(filters)
      });
      
      throw error;
    }
  }

  async fetchAllRecords(filters = {}) {
    this._initialize(); // Ensure config and errorHandler are initialized
    const startTime = Date.now();
    
    shedSuiteLog.fetching(`Starting data fetch from ShedSuite API`, {
      filters: filters,
      config: {
        pageSize: filters.pageSize || this.config.pageSize,
        maxPages: this.config.maxPages,
        maxRecords: parseInt(process.env.MAX_RECORDS) || 100000
      },
      timestamp: new Date().toISOString()
    });

    try {
      let allRecords = [];
      let page = 1;
      let hasMoreData = true;
      const pageSize = filters.pageSize || this.config.pageSize;
      let consecutiveEmptyPages = 0;
      const maxEmptyPages = parseInt(process.env.MAX_CONSECUTIVE_EMPTY_PAGES) || 5;
      let successfulPages = 0;
      let failedPages = 0;
      let totalRequestTime = 0;
      
      // Get total count for progress tracking
      let totalExpectedRecords = null;
      try {
        const countStartTime = Date.now();
        totalExpectedRecords = await this.getTotalRecordCount();
        const countDuration = Date.now() - countStartTime;
        
        shedSuiteLog.fetching(`Total record count retrieved`, {
          totalExpectedRecords: totalExpectedRecords,
          countDuration: `${countDuration}ms`
        });
      } catch (error) {
        shedSuiteLog.warn(`Could not get total record count for progress tracking`, {
          error: error.message
        });
      }

      shedSuiteLog.pagination(`Pagination configuration`, {
        maxPages: this.config.maxPages,
        pageSize: pageSize,
        maxEmptyPages: maxEmptyPages
      });

      while (hasMoreData && page <= this.config.maxPages) {
        const pageStartTime = Date.now();
        const pageUrl = this.buildApiUrl(page, filters);
        
        shedSuiteLog.fetching(`Fetching page ${page}`, {
          pageNumber: page,
          totalRecordsSoFar: allRecords.length,
          expectedTotal: totalExpectedRecords,
          url: pageUrl.replace(this.config.authToken, '***'),
          offset: (page - 1) * pageSize
        });

        try {
          const requestStartTime = Date.now();
          const pageData = await this.makeRequest(pageUrl);
          const requestDuration = Date.now() - requestStartTime;
          totalRequestTime += requestDuration;
          
          shedSuiteLog.http(`Page ${page} request completed`, {
            pageNumber: page,
            requestDuration: `${requestDuration}ms`,
            responseSize: JSON.stringify(pageData).length
          });
          
          const extractStartTime = Date.now();
          const pageRecords = this.extractRecords(pageData);
          const extractDuration = Date.now() - extractStartTime;
          
          const pageDuration = Date.now() - pageStartTime;
          successfulPages++;

          shedSuiteLog.processing(`Page ${page} records extracted`, {
            pageNumber: page,
            recordsInPage: pageRecords.length,
            totalRecordsSoFar: allRecords.length + pageRecords.length,
            extractDuration: `${extractDuration}ms`,
            pageDuration: `${pageDuration}ms`,
            consecutiveEmptyPages: consecutiveEmptyPages
          });

          if (pageRecords.length === 0) {
            consecutiveEmptyPages++;
            
            shedSuiteLog.pagination(`Empty page ${page} detected`, {
              pageNumber: page,
              consecutiveEmptyPages: consecutiveEmptyPages,
              maxEmptyPages: maxEmptyPages
            });

            if (consecutiveEmptyPages >= maxEmptyPages) {
              shedSuiteLog.pagination(`Multiple consecutive empty pages found, stopping pagination`, {
                pageNumber: page,
                consecutiveEmptyPages: consecutiveEmptyPages,
                maxEmptyPages: maxEmptyPages
              });
              hasMoreData = false;
            } else {
              page++;
            }
          } else {
            consecutiveEmptyPages = 0;
            allRecords = allRecords.concat(pageRecords);

            // Check if we've reached a reasonable limit to prevent infinite loops
            const maxRecords = parseInt(process.env.MAX_RECORDS) || 100000;
            if (allRecords.length >= maxRecords) {
              shedSuiteLog.pagination(`Reached maximum record limit`, {
                pageNumber: page,
                currentRecords: allRecords.length,
                maxRecords: maxRecords
              });
              hasMoreData = false;
            }
            // Stop if we get a significantly smaller page than expected (end of data)
            else if (pageRecords.length < (pageSize * 0.5)) {
              shedSuiteLog.pagination(`Page ${page} had significantly fewer records than expected`, {
                pageNumber: page,
                recordsInPage: pageRecords.length,
                pageSize: pageSize,
                threshold: pageSize * 0.5
              });
              hasMoreData = false;
            } else {
              // Test if there's more data by checking the next page
              shedSuiteLog.pagination(`Testing if there's more data beyond page ${page}`, {
                pageNumber: page,
                testPageNumber: page + 1
              });
              
              try {
                const testStartTime = Date.now();
                const testPageUrl = this.buildApiUrl(page + 1, filters);
                const testData = await this.makeRequest(testPageUrl);
                const testRecords = this.extractRecords(testData);
                const testDuration = Date.now() - testStartTime;
                
                if (testRecords.length === 0) {
                  shedSuiteLog.pagination(`Test page ${page + 1} returned 0 records - end of data reached`, {
                    pageNumber: page,
                    testPageNumber: page + 1,
                    testDuration: `${testDuration}ms`
                  });
                  hasMoreData = false;
                } else {
                  shedSuiteLog.pagination(`Test page ${page + 1} returned ${testRecords.length} records - continuing`, {
                    pageNumber: page,
                    testPageNumber: page + 1,
                    testRecords: testRecords.length,
                    testDuration: `${testDuration}ms`
                  });
                  page++;
                }
              } catch (testError) {
                shedSuiteLog.error(`Test page ${page + 1} failed - likely end of data`, testError, {
                  pageNumber: page,
                  testPageNumber: page + 1
                });
                hasMoreData = false;
              }
            }
          }
        } catch (pageError) {
          const pageDuration = Date.now() - pageStartTime;
          failedPages++;
          
          shedSuiteLog.error(`Error fetching page ${page}`, pageError, {
            pageNumber: page,
            pageDuration: `${pageDuration}ms`,
            url: pageUrl.replace(this.config.authToken, '***')
          });

          // If it's a date-related error, try to continue
          if (pageError.message.includes('date') || pageError.message.includes('5/27') || pageError.message.includes('parsing')) {
            shedSuiteLog.warn(`Date-related error detected, skipping to next page`, {
              pageNumber: page,
              errorMessage: pageError.message
            });
            page++;
            continue;
          }

          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= maxEmptyPages) {
            shedSuiteLog.error(`Too many consecutive errors, stopping pagination`, {
              pageNumber: page,
              consecutiveEmptyPages: consecutiveEmptyPages,
              maxEmptyPages: maxEmptyPages
            });
            break;
          }
          page++;
        }

        // Add a small delay between requests to avoid overwhelming the API
        if (hasMoreData && page <= this.config.maxPages) {
          const delay = filters.retryDelay || 100; // Use configurable delay or default to 100ms
          
          shedSuiteLog.rateLimit(`Adding delay between requests`, {
            pageNumber: page,
            delay: delay
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      const duration = Date.now() - startTime;
      const averageRequestTime = successfulPages > 0 ? Math.round(totalRequestTime / successfulPages) : 0;
      const recordsPerSecond = duration > 0 ? Math.round((allRecords.length / duration) * 1000) : 0;
      
      shedSuiteLog.performance(`Data fetch completed successfully`, {
        totalRecords: allRecords.length,
        pagesProcessed: page,
        successfulPages: successfulPages,
        failedPages: failedPages,
        totalDuration: `${duration}ms`,
        totalRequestTime: `${totalRequestTime}ms`,
        averageRequestTime: `${averageRequestTime}ms`,
        averageTimePerPage: `${Math.round(duration / page)}ms`,
        recordsPerSecond: recordsPerSecond,
        averageRecordsPerPage: Math.round(allRecords.length / page)
      });

      return allRecords;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.error(`Data fetch failed`, error, {
        duration: `${duration}ms`,
        totalRecords: allRecords.length,
        pagesProcessed: page,
        successfulPages: successfulPages,
        failedPages: failedPages
      });
      
      throw error;
    }
  }

  extractRecords(data) {
    const startTime = Date.now();
    
    shedSuiteLog.processing(`Extracting records from response`, {
      responseType: typeof data,
      isArray: Array.isArray(data),
      responseKeys: Object.keys(data || {}),
      responseSize: JSON.stringify(data).length
    });
    
    // Handle the actual API response format we're seeing
    if (Array.isArray(data)) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.processing(`Processing array response`, {
        recordCount: data.length,
        duration: `${duration}ms`,
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
      const duration = Date.now() - startTime;
      
      shedSuiteLog.processing(`Processing data.data array`, {
        recordCount: data.data.length,
        duration: `${duration}ms`
      });
      return data.data;
    }

    if (data.results && Array.isArray(data.results)) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.processing(`Processing data.results array`, {
        recordCount: data.results.length,
        duration: `${duration}ms`
      });
      return data.results;
    }

    if (data.records && Array.isArray(data.records)) {
      const duration = Date.now() - startTime;
      
      shedSuiteLog.processing(`Processing data.records array`, {
        recordCount: data.records.length,
        duration: `${duration}ms`
      });
      return data.records;
    }

    if (data.items && Array.isArray(data.items)) {
      console.log(`✅ Processing data.items array with ${data.items.length} records`);
      return data.items;
    }

    console.log(`⚠️  Unexpected API response format`);
    logger.warn('Unexpected API response format:', {
      keys: Object.keys(data),
      dataType: typeof data,
      isArray: Array.isArray(data),
      sampleData: JSON.stringify(data).substring(0, 500)
    });

    return [];
  }

  formatRecordsForExport(records) {
    this._initialize(); // Ensure config and errorHandler are initialized
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
    this._initialize(); // Ensure config and errorHandler are initialized
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
    this._initialize(); // Ensure config and errorHandler are initialized
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
