const { syncLogger } = require('./logger');

class DataTransformer {
  constructor() {
    this.transformers = {
      shedsuite_orders: this.transformCustomerOrder.bind(this),
      customers: this.transformCustomer.bind(this),
      orders: this.transformOrder.bind(this)
    };
  }

  // Transform ShedSuite customer order data to Supabase format
  transformCustomerOrder(rawData) {
    try {
      if (!rawData || typeof rawData !== 'object') {
        throw new Error('Invalid raw data provided');
      }

      // Transform building addons arrays to strings
      const buildingAddonsStr = rawData.buildingAddons && Array.isArray(rawData.buildingAddons) 
        ? rawData.buildingAddons.map(addon => `${addon.name}: $${addon.price}`).join('; ')
        : null;
      
      const customAddonsStr = rawData.buildingCustomAddons && Array.isArray(rawData.buildingCustomAddons)
        ? rawData.buildingCustomAddons.map(addon => `${addon.name}: $${addon.price}`).join('; ')
        : null;

      // Get the most recent date for timestamp
      const dates = [
        rawData.dateOrdered,
        rawData.dateDelivered,
        rawData.dateCancelled,
        rawData.dateFinished,
        rawData.dateProcessed,
        rawData.dateScheduledForDelivery
      ].filter(date => date);
      
      const mostRecentDate = dates.length > 0 
        ? new Date(Math.max(...dates.map(d => new Date(d))))
        : new Date();

      const transformed = {
        // Main identifiers
        id: this.safeValue(rawData.id),
        balance_dollar_amount: this.formatCurrency(rawData.balanceDollarAmount),

        // Billing Address
        billing_address_line_one: this.safeValue(rawData.billingAddressLineOne),
        billing_address_line_two: this.safeValue(rawData.billingAddressLineTwo),
        billing_city: this.safeValue(rawData.billingCity),
        billing_state: this.safeValue(rawData.billingState),
        billing_zip: this.safeValue(rawData.billingZip),

        // Building Information
        building_addons: buildingAddonsStr,
        building_condition: this.safeValue(rawData.buildingCondition),
        building_custom_addons: customAddonsStr,
        building_length: this.safeValue(rawData.buildingLength),
        building_model_name: this.safeValue(rawData.buildingModelName),
        building_roof_color: this.safeValue(rawData.buildingRoofColor),
        building_roof_type: this.safeValue(rawData.buildingRoofType),
        building_siding_color: this.safeValue(rawData.buildingSidingColor),
        building_siding_type: this.safeValue(rawData.buildingSidingType),
        building_size: this.safeValue(rawData.buildingSize),
        building_width: this.safeValue(rawData.buildingWidth),

        // Company/Dealer Information
        company_id: this.safeValue(rawData.companyId),
        county_tax_rate: this.formatCurrency(rawData.countyTaxRate),

        // Customer Information
        customer_name: this.safeValue(rawData.customerName),
        customer_email: this.safeValue(rawData.customerEmail),
        customer_first_name: this.safeValue(rawData.customerFirstName),
        customer_id: this.safeValue(rawData.customerId),
        customer_last_name: this.safeValue(rawData.customerLastName),
        customer_phone_primary: this.safeValue(rawData.customerPhonePrimary),
        customer_source: this.safeValue(rawData.customerSource),

        // Dates
        date_delivered: this.formatDate(rawData.dateDelivered),
        date_cancelled: this.formatDate(rawData.dateCancelled),
        date_finished: this.formatDate(rawData.dateFinished),
        date_ordered: this.formatDate(rawData.dateOrdered),
        date_processed: this.formatDate(rawData.dateProcessed),
        date_scheduled_for_delivery: this.formatDate(rawData.dateScheduledForDelivery),

        // Dealer Information
        dealer_id: this.safeValue(rawData.dealerId),
        dealer_primary_sales_rep: this.safeValue(rawData.dealerPrimarySalesRep),

        // Delivery Address
        delivery_address_line_one: this.safeValue(rawData.deliveryAddressLineOne),
        delivery_address_line_two: this.safeValue(rawData.deliveryAddressLineTwo),
        delivery_city: this.safeValue(rawData.deliveryCity),
        delivery_state: this.safeValue(rawData.deliveryState),
        delivery_zip: this.safeValue(rawData.deliveryZip),

        // Driver and Payment
        driver_name: this.safeValue(rawData.driverName),
        initial_payment_dollar_amount: this.formatCurrency(rawData.initialPaymentDollarAmount),
        initial_payment_type: this.safeValue(rawData.initialPaymentType),
        invoice_url: this.safeValue(rawData.invoiceURL),

        // Order Information
        order_number: this.safeValue(rawData.orderNumber),
        order_type: this.safeValue(rawData.orderType),

        // Promocode Information
        promocode_code: this.safeValue(rawData.promocodeCode),
        promocode_name: this.safeValue(rawData.promocodeName),
        promocode_amount_discounted: this.formatCurrency(rawData.promocodeAmountDiscounted),
        promocode_type: this.safeValue(rawData.promocodeType),
        promocode_value: this.safeValue(rawData.promocodeValue),
        promocode_target: this.safeValue(rawData.promocodeTarget),

        // RTO Information
        rto: this.safeBoolean(rawData.rto),
        rto_company_name: this.safeValue(rawData.rtoCompanyName),
        rto_months_of_term: this.safeValue(rawData.rtoMonthsOfTerm),

        // Additional Information
        serial_number: this.safeValue(rawData.serialNumber),
        shop_name: this.safeValue(rawData.shopName),
        sold_by_dealer: this.safeValue(rawData.soldByDealer),
        sold_by_dealer_id: this.safeValue(rawData.soldByDealerId),
        sold_by_dealer_user: this.safeValue(rawData.soldByDealerUser),

        // Tax Information
        special_district: this.safeValue(rawData.specialDistrict),
        special_district_rate: this.formatCurrency(rawData.specialDistrictRate),
        special_district_tax_dollar_amount: this.formatCurrency(rawData.specialDistrictTaxDollarAmount),
        state: this.safeValue(rawData.state),
        state_tax_dollar_amount: this.formatCurrency(rawData.stateTaxDollarAmount),
        state_tax_rate: this.formatCurrency(rawData.stateTaxRate),
        status: this.safeValue(rawData.status),

        // Totals and Adjustments
        sub_total_dollar_amount: this.formatCurrency(rawData.subTotalDollarAmount),
        sub_total_adjustment_dollar_amount: this.formatCurrency(rawData.subTotalAdjustmentDollarAmount),
        sub_total_adjustment_note: this.safeValue(rawData.subTotalAdjustmentNote),
        total_amount_dollar_amount: this.formatCurrency(rawData.totalAmountDollarAmount),
        total_tax_dollar_amount: this.formatCurrency(rawData.totalTaxDollarAmount),

        // City/County Tax
        tax_city: this.safeValue(rawData.taxCity),
        tax_city_dollar_amount: this.formatCurrency(rawData.taxCityDollarAmount),
        tax_city_rate: this.formatCurrency(rawData.taxCityRate),
        tax_county: this.safeValue(rawData.taxCounty),
        tax_county_dollar_amount: this.formatCurrency(rawData.taxCountyDollarAmount),
        tax_county_rate: this.formatCurrency(rawData.taxCountyRate),

        // Timestamp - most recent update
        timestamp: mostRecentDate.toISOString(),
        
        // Sync metadata
        sync_timestamp: new Date().toISOString()
      };

      // Remove undefined values
      Object.keys(transformed).forEach(key => {
        if (transformed[key] === undefined) {
          delete transformed[key];
        }
      });

      return transformed;
    } catch (error) {
      syncLogger.error('Failed to transform customer order', {
        error: error.message,
        rawData: JSON.stringify(rawData).substring(0, 200)
      });
      throw error;
    }
  }

  // Transform customer data
  transformCustomer(rawData) {
    try {
      if (!rawData || typeof rawData !== 'object') {
        throw new Error('Invalid raw data provided');
      }

      const transformed = {
        id: this.safeValue(rawData.id),
        first_name: this.safeValue(rawData.first_name || rawData.firstName),
        last_name: this.safeValue(rawData.last_name || rawData.lastName),
        email: this.safeValue(rawData.email),
        phone: this.safeValue(rawData.phone),
        company: this.safeValue(rawData.company),
        address: this.transformAddress(rawData.address),
        created_at: this.formatDate(rawData.created_at || rawData.createdAt),
        updated_at: this.formatDate(rawData.updated_at || rawData.updatedAt),
        sync_timestamp: new Date().toISOString()
      };

      // Remove undefined values
      Object.keys(transformed).forEach(key => {
        if (transformed[key] === undefined) {
          delete transformed[key];
        }
      });

      return transformed;
    } catch (error) {
      syncLogger.error('Failed to transform customer', {
        error: error.message,
        rawData: JSON.stringify(rawData).substring(0, 200)
      });
      throw error;
    }
  }

  // Transform order data
  transformOrder(rawData) {
    try {
      if (!rawData || typeof rawData !== 'object') {
        throw new Error('Invalid raw data provided');
      }

      const transformed = {
        id: this.safeValue(rawData.id),
        order_number: this.safeValue(rawData.order_number || rawData.orderNumber),
        customer_id: this.safeValue(rawData.customer_id || rawData.customerId),
        order_date: this.formatDate(rawData.order_date || rawData.orderDate),
        status: this.safeValue(rawData.status),
        total_amount: this.formatCurrency(rawData.total_amount || rawData.totalAmount),
        items_count: this.safeValue(rawData.items_count || rawData.itemsCount),
        created_at: this.formatDate(rawData.created_at || rawData.createdAt),
        updated_at: this.formatDate(rawData.updated_at || rawData.updatedAt),
        sync_timestamp: new Date().toISOString()
      };

      // Remove undefined values
      Object.keys(transformed).forEach(key => {
        if (transformed[key] === undefined) {
          delete transformed[key];
        }
      });

      return transformed;
    } catch (error) {
      syncLogger.error('Failed to transform order', {
        error: error.message,
        rawData: JSON.stringify(rawData).substring(0, 200)
      });
      throw error;
    }
  }

  // Transform address data
  transformAddress(addressData) {
    if (!addressData || typeof addressData !== 'object') {
      return null;
    }

    return {
      street: this.safeValue(addressData.street || addressData.address1),
      street2: this.safeValue(addressData.street2 || addressData.address2),
      city: this.safeValue(addressData.city),
      state: this.safeValue(addressData.state || addressData.province),
      postal_code: this.safeValue(addressData.postal_code || addressData.zip || addressData.postalCode),
      country: this.safeValue(addressData.country)
    };
  }

  // Transform order items
  transformOrderItems(itemsData) {
    if (!Array.isArray(itemsData)) {
      return [];
    }

    return itemsData.map(item => ({
      id: this.safeValue(item.id),
      product_id: this.safeValue(item.product_id || item.productId),
      product_name: this.safeValue(item.product_name || item.productName),
      sku: this.safeValue(item.sku),
      quantity: this.safeValue(item.quantity),
      unit_price: this.formatCurrency(item.unit_price || item.unitPrice),
      total_price: this.formatCurrency(item.total_price || item.totalPrice),
      options: this.safeValue(item.options)
    }));
  }

  // Safe value conversion
  safeValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    
    // Convert to string and trim
    const stringValue = String(value).trim();
    
    // Return null for empty strings
    if (stringValue === '') {
      return null;
    }
    
    return stringValue;
  }

  // Safe boolean value conversion
  safeBoolean(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    
    // Handle boolean values
    if (typeof value === 'boolean') {
      return value;
    }
    
    // Handle string representations
    const stringValue = String(value).toLowerCase().trim();
    
    if (stringValue === 'true' || stringValue === '1' || stringValue === 'yes') {
      return true;
    }
    
    if (stringValue === 'false' || stringValue === '0' || stringValue === 'no') {
      return false;
    }
    
    // If it's not a clear boolean value, return null
    return null;
  }

  // Format date values
  formatDate(dateValue) {
    if (!dateValue) {
      return null;
    }

    try {
      const date = new Date(dateValue);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return null;
      }
      
      return date.toISOString();
    } catch (error) {
      syncLogger.warn('Failed to format date', {
        dateValue,
        error: error.message
      });
      return null;
    }
  }

  // Format currency values
  formatCurrency(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    try {
      // Convert to number
      const numValue = parseFloat(value);
      
      // Check if it's a valid number
      if (isNaN(numValue)) {
        return null;
      }
      
      // Round to 2 decimal places
      return Math.round(numValue * 100) / 100;
    } catch (error) {
      syncLogger.warn('Failed to format currency', {
        value,
        error: error.message
      });
      return null;
    }
  }

  // Transform batch of records
  transformBatch(records, recordType = 'shedsuite_orders') {
    try {
      if (!Array.isArray(records)) {
        throw new Error('Records must be an array');
      }

      const transformer = this.transformers[recordType];
      if (!transformer) {
        throw new Error(`Unknown record type: ${recordType}`);
      }

      const transformed = [];
      const errors = [];

      records.forEach((record, index) => {
        try {
          const transformedRecord = transformer(record);
          if (transformedRecord) {
            transformed.push(transformedRecord);
          }
        } catch (error) {
          errors.push({
            index,
            recordId: record.id || `record_${index}`,
            error: error.message
          });
        }
      });

      syncLogger.info('Batch transformation completed', {
        recordType,
        totalRecords: records.length,
        transformedCount: transformed.length,
        errorCount: errors.length
      });

      return {
        transformed,
        errors,
        success: errors.length === 0
      };
    } catch (error) {
      syncLogger.error('Batch transformation failed', {
        error: error.message,
        recordType,
        recordCount: records.length,
        stack: error.stack
      });
      // Don't throw the error to prevent application shutdown
      return {
        transformed: [],
        errors: [{ error: error.message }],
        success: false
      };
    }
  }

  // Validate transformed data
  validateTransformedData(data, schema) {
    const errors = [];

    // Basic validation
    if (!data || typeof data !== 'object') {
      errors.push('Data must be an object');
      return errors;
    }

    // Check required fields
    if (schema.required) {
      schema.required.forEach(field => {
        if (!data.hasOwnProperty(field) || data[field] === null || data[field] === undefined) {
          errors.push(`Missing required field: ${field}`);
        }
      });
    }

    // Check field types
    if (schema.fields) {
      Object.entries(schema.fields).forEach(([field, type]) => {
        if (data.hasOwnProperty(field) && data[field] !== null) {
          const value = data[field];
          
          switch (type) {
            case 'string':
              if (typeof value !== 'string') {
                errors.push(`Field ${field} must be a string`);
              }
              break;
            case 'number':
              if (typeof value !== 'number' || isNaN(value)) {
                errors.push(`Field ${field} must be a number`);
              }
              break;
            case 'date':
              if (!(value instanceof Date) && isNaN(new Date(value).getTime())) {
                errors.push(`Field ${field} must be a valid date`);
              }
              break;
            case 'boolean':
              if (typeof value !== 'boolean') {
                errors.push(`Field ${field} must be a boolean`);
              }
              break;
          }
        }
      });
    }

    return errors;
  }
}

// Export singleton instance
module.exports = new DataTransformer(); 