const https = require('https');
const { URL } = require('url');
const { apiLogger } = require('../utils/logger');

class ShedSuiteAPI {
  constructor() {
    this._initialized = false;
    this.config = null;
  }

  _initialize() {
    if (this._initialized) {
      return;
    }

    // Validate required environment variables
    if (!process.env.SHEDSUITE_API_BASE_URL) {
      throw new Error('SHEDSUITE_API_BASE_URL is required');
    }
    if (!process.env.SHEDSUITE_API_TOKEN) {
      throw new Error('SHEDSUITE_API_TOKEN is required');
    }

    this.config = {
      baseUrl: process.env.SHEDSUITE_API_BASE_URL.replace(/\/+$/, ''),
      apiPath: process.env.SHEDSUITE_API_PATH || 'api/public',
      endpoint: process.env.SHEDSUITE_API_ENDPOINT || 'customer-orders/v1',
      authToken: process.env.SHEDSUITE_API_TOKEN,
      pageSize: parseInt(process.env.SHEDSUITE_PAGE_SIZE) || 100,
      maxPages: parseInt(process.env.SHEDSUITE_MAX_PAGES) || 1000,
      sortBy: process.env.SHEDSUITE_SORT_BY || 'id',
      sortOrder: process.env.SHEDSUITE_SORT_ORDER || 'asc',
      timeout: parseInt(process.env.SHEDSUITE_TIMEOUT) || 60000,
      maxRetries: parseInt(process.env.SHEDSUITE_MAX_RETRIES) || 3,
      retryDelay: parseInt(process.env.SHEDSUITE_RETRY_DELAY) || 1000,
      maxConcurrentRequests: parseInt(process.env.SHEDSUITE_MAX_CONCURRENT_REQUESTS) || 3
    };

    apiLogger.info('ShedSuite API configured', {
      baseUrl: this.config.baseUrl,
      endpoint: this.config.endpoint,
      pageSize: this.config.pageSize,
      maxPages: this.config.maxPages,
      sortBy: this.config.sortBy,
      sortOrder: this.config.sortOrder,
      timeout: this.config.timeout,
      maxConcurrentRequests: this.config.maxConcurrentRequests
    });

    this._initialized = true;
  }

  async makeRequest(url, context = {}) {
    this._initialize();
    
    const operationContext = {
      service: 'ShedSuiteAPI',
      url: url.replace(this.config.authToken, '***'),
      ...context
    };

    try {
      const result = await this.executeRequest(url);
      return result;
    } catch (error) {
      // If it's an authentication error (401, 403), don't retry
      if (error.statusCode === 401 || error.statusCode === 403) {
        apiLogger.error('Authentication failed - API token may be expired:', {
          statusCode: error.statusCode,
          message: error.message,
          url: url.replace(this.config.authToken, '***')
        });
        throw new Error(`Authentication failed: ${error.message}`);
      }
      
      // For other errors, use retry mechanism
      return this.retryRequest(url, error, operationContext);
    }
  }

  async executeRequest(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ShedSuite-Supabase-Sync/1.0.0'
        },
        timeout: this.config.timeout
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const jsonData = JSON.parse(data);
              resolve(jsonData);
            } catch (parseError) {
              reject(new Error(`Failed to parse JSON response: ${parseError.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  async retryRequest(url, originalError, context, attempt = 1) {
    if (attempt > this.config.maxRetries) {
      apiLogger.error('Max retries exceeded', {
        ...context,
        attempt,
        maxRetries: this.config.maxRetries,
        originalError: originalError.message
      });
      throw originalError;
    }

    const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
    apiLogger.warn('Retrying request', {
      ...context,
      attempt,
      delay,
      originalError: originalError.message
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      return await this.executeRequest(url);
    } catch (error) {
      return this.retryRequest(url, error, context, attempt + 1);
    }
  }

  async getTotalRecordCount() {
    try {
      const url = this.buildApiUrl(1, {}, true);
      const data = await this.makeRequest(url, { operation: 'getTotalCount' });
      
      const totalCount = data.total || data.count || 0;
      apiLogger.info('Total record count retrieved', { totalCount });
      
      return totalCount;
    } catch (error) {
      apiLogger.error('Failed to get total record count', { error: error.message });
      throw error;
    }
  }

  buildApiUrl(page, filters = {}, countOnly = false) {
    this._initialize();
    
    const baseUrl = `${this.config.baseUrl}/${this.config.apiPath}/${this.config.endpoint}`;
    const params = new URLSearchParams();

    if (!countOnly) {
      // Use limit and offset for pagination (like the main application)
      params.append('limit', this.config.pageSize.toString());
      params.append('offset', ((page - 1) * this.config.pageSize).toString());
      params.append('sortBy', this.config.sortBy);
      params.append('sortOrder', this.config.sortOrder);
    }

    // Add filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Handle different filter formats like the main application
        if (key === 'updated_after' && value) {
          params.append('dateUpdated[gte]', value.toString());
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  }

  async fetchAllRecords(filters = {}) {
    try {
      this._initialize();
      
      console.log('🔧 ShedSuiteAPI.fetchAllRecords() - Starting to fetch all records with filters:', filters);
      apiLogger.info('Starting to fetch all records', {
        filters,
        pageSize: this.config.pageSize,
        maxPages: this.config.maxPages
      });

      const allRecords = [];
      let currentPage = 1;
      let hasMorePages = true;
      let totalProcessed = 0;
      let totalPagesFetched = 0;

      while (hasMorePages && currentPage <= this.config.maxPages) {
        try {
          const url = this.buildApiUrl(currentPage, filters);
          console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Fetching page ${currentPage} from:`, url.replace(this.config.authToken, '***'));
          apiLogger.debug('Fetching page', { page: currentPage, url: url.replace(this.config.authToken, '***') });

          const data = await this.makeRequest(url, {
            operation: 'fetchRecords',
            page: currentPage,
            filters
          });

          console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Page ${currentPage} raw response length:`, data ? (Array.isArray(data) ? data.length : JSON.stringify(data).length) : 0);
          
          const records = this.extractRecords(data);
          console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Page ${currentPage} extracted ${records ? records.length : 0} records`);
          
          if (!records || records.length === 0) {
            console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - No more records found on page ${currentPage}`);
            apiLogger.info('No more records found', { page: currentPage });
            hasMorePages = false;
            break;
          }

          // Log sample record from this page
          if (records.length > 0) {
            console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Sample record from page ${currentPage}:`, JSON.stringify(records[0], null, 2));
          }

          allRecords.push(...records);
          totalProcessed += records.length;
          totalPagesFetched++;

          console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Page ${currentPage} processed: ${records.length} records, total so far: ${totalProcessed}`);
          
          // Progress tracking for large datasets
          if (currentPage % 50 === 0) {
            const progressPercent = ((currentPage / this.config.maxPages) * 100).toFixed(1);
            console.log(`📊 PAGINATION PROGRESS - Page ${currentPage}/${this.config.maxPages} (${progressPercent}%) - Records: ${totalProcessed}`);
            apiLogger.info('Pagination progress update', {
              currentPage,
              maxPages: this.config.maxPages,
              progressPercent: parseFloat(progressPercent),
              totalRecords: totalProcessed,
              averageRecordsPerPage: Math.round(totalProcessed / currentPage)
            });
          }
          
          apiLogger.info('Page processed', {
            page: currentPage,
            recordsInPage: records.length,
            totalProcessed,
            hasMore: records.length === this.config.pageSize
          });

          // Check if we have more pages - continue until we get an empty response
          if (records.length === 0) {
            console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - No records returned. Stopping pagination.`);
            hasMorePages = false;
          } else {
            console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Got ${records.length} records. Continuing to next page.`);
            currentPage++;
          }

          // Add small delay to be respectful to the API
          if (hasMorePages) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (pageError) {
          console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - Failed to fetch page ${currentPage} with error:`, pageError.message);
          apiLogger.error('Failed to fetch page', {
            page: currentPage,
            error: pageError.message,
            stack: pageError.stack
          });
          
          // If it's an authentication error, stop trying
          if (pageError.message.includes('Authentication failed')) {
            throw pageError;
          }
          
          // For other errors, continue to next page
          currentPage++;
        }
      }

      console.log(`🔧 ShedSuiteAPI.fetchAllRecords() - All records fetched successfully: ${allRecords.length} total records from ${totalPagesFetched} pages`);
      
      // Memory usage tracking for large datasets
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
      };
      
      console.log(`💾 MEMORY USAGE AFTER FETCH - RSS: ${memUsageMB.rss}MB, Heap Used: ${memUsageMB.heapUsed}MB, Heap Total: ${memUsageMB.heapTotal}MB`);
      
      if (memUsageMB.heapUsed > 500) {
        console.log(`⚠️  HIGH MEMORY USAGE WARNING - ${memUsageMB.heapUsed}MB heap used for ${allRecords.length} records`);
      }
      
      apiLogger.info('All records fetched successfully', {
        totalRecords: allRecords.length,
        pagesProcessed: totalPagesFetched,
        filters,
        memoryUsage: memUsageMB,
        recordsPerMB: Math.round(allRecords.length / memUsageMB.heapUsed)
      });

      return allRecords;

    } catch (error) {
      console.log('🔧 ShedSuiteAPI.fetchAllRecords() - Failed to fetch all records with error:', error.message);
      apiLogger.error('Failed to fetch all records', {
        error: error.message,
        filters,
        stack: error.stack
      });
      // Don't throw the error to prevent application shutdown
      return [];
    }
  }

  extractRecords(data) {
    if (!data) {
      return [];
    }

    // Handle different response formats
    if (Array.isArray(data)) {
      return data;
    }

    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }

    if (data.records && Array.isArray(data.records)) {
      return data.records;
    }

    if (data.items && Array.isArray(data.items)) {
      return data.items;
    }

    // If data is an object with numeric keys, extract values
    if (typeof data === 'object' && !Array.isArray(data)) {
      const records = [];
      for (const key in data) {
        if (!isNaN(key) && data[key]) {
          records.push(data[key]);
        }
      }
      return records;
    }

    apiLogger.warn('Unknown data format', {
      dataType: typeof data,
      hasData: !!data.data,
      hasRecords: !!data.records,
      hasItems: !!data.items
    });

    return [];
  }

  async healthCheck() {
    try {
      this._initialize();
      
      const url = this.buildApiUrl(1, {}, true);
      const data = await this.makeRequest(url, { operation: 'healthCheck' });

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apiResponse: data,
        config: {
          baseUrl: this.config.baseUrl,
          endpoint: this.config.endpoint,
          pageSize: this.config.pageSize
        }
      };
    } catch (error) {
      apiLogger.error('ShedSuite API health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

// Export singleton instance
module.exports = new ShedSuiteAPI(); 