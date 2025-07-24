const { syncLogger } = require('./logger');

class DataTransformer {
  constructor() {
    this.transformers = {
      customer_orders: this.transformCustomerOrder.bind(this),
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

      const transformed = {
        id: this.safeValue(rawData.id),
        customer_id: this.safeValue(rawData.customer_id || rawData.customerId),
        order_number: this.safeValue(rawData.order_number || rawData.orderNumber),
        order_date: this.formatDate(rawData.order_date || rawData.orderDate),
        status: this.safeValue(rawData.status),
        total_amount: this.formatCurrency(rawData.total_amount || rawData.totalAmount),
        tax_amount: this.formatCurrency(rawData.tax_amount || rawData.taxAmount),
        shipping_amount: this.formatCurrency(rawData.shipping_amount || rawData.shippingAmount),
        discount_amount: this.formatCurrency(rawData.discount_amount || rawData.discountAmount),
        payment_method: this.safeValue(rawData.payment_method || rawData.paymentMethod),
        payment_status: this.safeValue(rawData.payment_status || rawData.paymentStatus),
        shipping_address: this.transformAddress(rawData.shipping_address || rawData.shippingAddress),
        billing_address: this.transformAddress(rawData.billing_address || rawData.billingAddress),
        items: this.transformOrderItems(rawData.items || rawData.orderItems),
        notes: this.safeValue(rawData.notes),
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
  transformBatch(records, recordType = 'customer_orders') {
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
        recordCount: records.length
      });
      throw error;
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