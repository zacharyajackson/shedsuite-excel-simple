#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

console.log('🚀 ShedSuite to Supabase Sync Tool');
console.log('=====================================');

// Configuration
const SHEDSUITE_API_URL = process.env.SHEDSUITE_API_BASE_URL || 'https://app.shedsuite.com';
const SHEDSUITE_API_TOKEN = process.env.SHEDSUITE_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate environment variables
if (!SHEDSUITE_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ShedSuite API client
const shedsuiteAPI = axios.create({
  baseURL: SHEDSUITE_API_URL,
  headers: {
    'Authorization': `Bearer ${SHEDSUITE_API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 60000
});

// Data transformation functions
function safeValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value).trim() || null;
}

function safeBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const stringValue = String(value).toLowerCase().trim();
  if (stringValue === 'true' || stringValue === '1' || stringValue === 'yes') {
    return true;
  }
  if (stringValue === 'false' || stringValue === '0' || stringValue === 'no') {
    return false;
  }
  return null;
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numValue = parseFloat(value);
  return isNaN(numValue) ? null : Math.round(numValue * 100) / 100;
}

function formatDate(dateValue) {
  if (!dateValue) return null;
  try {
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (error) {
    return null;
  }
}

function transformRecord(rawData) {
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

  return {
    // Main identifiers
    id: safeValue(rawData.id),
    balance_dollar_amount: formatCurrency(rawData.balanceDollarAmount),

    // Billing Address
    billing_address_line_one: safeValue(rawData.billingAddressLineOne),
    billing_address_line_two: safeValue(rawData.billingAddressLineTwo),
    billing_city: safeValue(rawData.billingCity),
    billing_state: safeValue(rawData.billingState),
    billing_zip: safeValue(rawData.billingZip),

    // Building Information
    building_addons: buildingAddonsStr,
    building_condition: safeValue(rawData.buildingCondition),
    building_custom_addons: customAddonsStr,
    building_length: safeValue(rawData.buildingLength),
    building_model_name: safeValue(rawData.buildingModelName),
    building_roof_color: safeValue(rawData.buildingRoofColor),
    building_roof_type: safeValue(rawData.buildingRoofType),
    building_siding_color: safeValue(rawData.buildingSidingColor),
    building_siding_type: safeValue(rawData.buildingSidingType),
    building_size: safeValue(rawData.buildingSize),
    building_width: safeValue(rawData.buildingWidth),

    // Company/Dealer Information
    company_id: safeValue(rawData.companyId),
    county_tax_rate: formatCurrency(rawData.countyTaxRate),

    // Customer Information
    customer_name: safeValue(rawData.customerName),
    customer_email: safeValue(rawData.customerEmail),
    customer_first_name: safeValue(rawData.customerFirstName),
    customer_id: safeValue(rawData.customerId),
    customer_last_name: safeValue(rawData.customerLastName),
    customer_phone_primary: safeValue(rawData.customerPhonePrimary),
    customer_source: safeValue(rawData.customerSource),

    // Dates
    date_delivered: formatDate(rawData.dateDelivered),
    date_cancelled: formatDate(rawData.dateCancelled),
    date_finished: formatDate(rawData.dateFinished),
    date_ordered: formatDate(rawData.dateOrdered),
    date_processed: formatDate(rawData.dateProcessed),
    date_scheduled_for_delivery: formatDate(rawData.dateScheduledForDelivery),

    // Dealer Information
    dealer_id: safeValue(rawData.dealerId),
    dealer_primary_sales_rep: safeValue(rawData.dealerPrimarySalesRep),

    // Delivery Address
    delivery_address_line_one: safeValue(rawData.deliveryAddressLineOne),
    delivery_address_line_two: safeValue(rawData.deliveryAddressLineTwo),
    delivery_city: safeValue(rawData.deliveryCity),
    delivery_state: safeValue(rawData.deliveryState),
    delivery_zip: safeValue(rawData.deliveryZip),

    // Driver and Payment
    driver_name: safeValue(rawData.driverName),
    initial_payment_dollar_amount: formatCurrency(rawData.initialPaymentDollarAmount),
    initial_payment_type: safeValue(rawData.initialPaymentType),
    invoice_url: safeValue(rawData.invoiceURL),

    // Order Information
    order_number: safeValue(rawData.orderNumber),
    order_type: safeValue(rawData.orderType),

    // Promocode Information
    promocode_code: safeValue(rawData.promocodeCode),
    promocode_name: safeValue(rawData.promocodeName),
    promocode_amount_discounted: formatCurrency(rawData.promocodeAmountDiscounted),
    promocode_type: safeValue(rawData.promocodeType),
    promocode_value: safeValue(rawData.promocodeValue),
    promocode_target: safeValue(rawData.promocodeTarget),

    // RTO Information
    rto: safeBoolean(rawData.rto),
    rto_company_name: safeValue(rawData.rtoCompanyName),
    rto_months_of_term: safeValue(rawData.rtoMonthsOfTerm),

    // Additional Information
    serial_number: safeValue(rawData.serialNumber),
    shop_name: safeValue(rawData.shopName),
    sold_by_dealer: safeBoolean(rawData.soldByDealer),
    sold_by_dealer_id: safeValue(rawData.soldByDealerId),
    sold_by_dealer_user: safeValue(rawData.soldByDealerUser),

    // Tax Information
    special_district: safeValue(rawData.specialDistrict),
    special_district_rate: formatCurrency(rawData.specialDistrictRate),
    special_district_tax_dollar_amount: formatCurrency(rawData.specialDistrictTaxDollarAmount),
    state: safeValue(rawData.state),
    state_tax_dollar_amount: formatCurrency(rawData.stateTaxDollarAmount),
    state_tax_rate: formatCurrency(rawData.stateTaxRate),
    status: safeValue(rawData.status),

    // Totals and Adjustments
    sub_total_dollar_amount: formatCurrency(rawData.subTotalDollarAmount),
    sub_total_adjustment_dollar_amount: formatCurrency(rawData.subTotalAdjustmentDollarAmount),
    sub_total_adjustment_note: safeValue(rawData.subTotalAdjustmentNote),
    total_amount_dollar_amount: formatCurrency(rawData.totalAmountDollarAmount),
    total_tax_dollar_amount: formatCurrency(rawData.totalTaxDollarAmount),

    // City/County Tax
    tax_city: safeValue(rawData.taxCity),
    tax_city_dollar_amount: formatCurrency(rawData.taxCityDollarAmount),
    tax_city_rate: formatCurrency(rawData.taxCityRate),
    tax_county: safeValue(rawData.taxCounty),
    tax_county_dollar_amount: formatCurrency(rawData.taxCountyDollarAmount),
    tax_county_rate: formatCurrency(rawData.taxCountyRate),

    // Timestamp
    timestamp: mostRecentDate.toISOString(),
    sync_timestamp: new Date().toISOString()
  };
}

// Fetch all records from ShedSuite
async function fetchAllShedSuiteRecords() {
  console.log('📥 Fetching all records from ShedSuite...');
  
  const allRecords = [];
  let page = 1;
  let hasMore = true;
  const pageSize = 100;
  
  while (hasMore) {
    try {
      console.log(`  📄 Fetching page ${page}...`);
      
      const response = await shedsuiteAPI.get('/api/public/customer-orders/v1', {
        params: {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          sortOrder: 'asc',
          sortBy: 'id'
        }
      });
      
      const records = response.data;
      
      if (!Array.isArray(records) || records.length === 0) {
        console.log(`  ✅ No more records found on page ${page}`);
        hasMore = false;
        break;
      }
      
      allRecords.push(...records);
      console.log(`  ✅ Fetched ${records.length} records from page ${page}`);
      
      // If we got fewer records than pageSize, we've reached the end
      if (records.length < pageSize) {
        hasMore = false;
      }
      
      page++;
      
      // Add a small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error fetching page ${page}:`, error.message);
      break;
    }
  }
  
  console.log(`✅ Total records fetched: ${allRecords.length}`);
  return allRecords;
}

// Sync records to Supabase
async function syncToSupabase(records) {
  console.log('🔄 Syncing records to Supabase...');
  
  if (records.length === 0) {
    console.log('⚠️  No records to sync');
    return;
  }
  
  // Transform records
  console.log('  🔄 Transforming records...');
  const transformedRecords = records.map(record => transformRecord(record)).filter(record => record !== null);
  console.log(`  ✅ Transformed ${transformedRecords.length} records`);
  
  // Sync to Supabase using upsert (insert or update)
  try {
    console.log('  🔄 Upserting to Supabase...');
    const { data, error } = await supabase
      .from('shedsuite_orders')
      .upsert(transformedRecords, {
        onConflict: 'id',
        ignoreDuplicates: false
      })
      .select();
    
    if (error) {
      throw error;
    }
    
    console.log(`✅ Successfully synced ${data.length} records to Supabase`);
    return data.length;
    
  } catch (error) {
    console.error('❌ Error syncing to Supabase:', error.message);
    throw error;
  }
}

// Main sync function
async function performFullSync() {
  try {
    console.log('🚀 Starting full sync...');
    
    // Fetch all records from ShedSuite
    const records = await fetchAllShedSuiteRecords();
    
    if (records.length === 0) {
      console.log('⚠️  No records found in ShedSuite');
      return;
    }
    
    // Sync to Supabase
    const syncedCount = await syncToSupabase(records);
    
    console.log('🎉 Full sync completed successfully!');
    console.log(`📊 Summary: ${records.length} records fetched, ${syncedCount} records synced`);
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Continuous sync function (updates only)
async function performContinuousSync() {
  try {
    console.log('🔄 Starting continuous sync (updates only)...');
    
    // For continuous sync, we'll fetch recent records and update existing ones
    const response = await shedsuiteAPI.get('/api/public/customer-orders/v1', {
      params: {
        limit: 100,
        sortOrder: 'desc',
        sortBy: 'id'
      }
    });
    
    const records = response.data;
    
    if (Array.isArray(records) && records.length > 0) {
      const transformedRecords = records.map(record => transformRecord(record)).filter(record => record !== null);
      
      const { data, error } = await supabase
        .from('shedsuite_orders')
        .upsert(transformedRecords, {
          onConflict: 'id',
          ignoreDuplicates: false
        })
        .select();
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ Continuous sync: Updated ${data.length} records`);
    }
    
  } catch (error) {
    console.error('❌ Continuous sync failed:', error.message);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';
  
  switch (command) {
    case 'full':
      await performFullSync();
      break;
    case 'continuous':
      console.log('🔄 Starting continuous sync mode...');
      console.log('Press Ctrl+C to stop');
      
      // Run continuous sync every 5 minutes
      setInterval(performContinuousSync, 5 * 60 * 1000);
      
      // Run initial sync
      await performContinuousSync();
      break;
    default:
      console.log('Usage:');
      console.log('  node start-sync.js full        - Perform full sync (all records)');
      console.log('  node start-sync.js continuous  - Start continuous sync (updates only)');
      break;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Run the main function
main().catch(error => {
  console.error('❌ Application failed:', error);
  process.exit(1);
}); 