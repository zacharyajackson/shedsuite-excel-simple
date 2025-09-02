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
  // Transform building addons arrays to strings and JSON details
  const buildingAddonsArray = Array.isArray(rawData.buildingAddons) ? rawData.buildingAddons : null;
  const buildingAddonsStr = buildingAddonsArray 
    ? buildingAddonsArray.map(addon => `${addon.name}: $${addon.price}`).join('; ')
    : null;
  
  const customAddonsArray = Array.isArray(rawData.buildingCustomAddons) ? rawData.buildingCustomAddons : null;
  const customAddonsStr = customAddonsArray
    ? customAddonsArray.map(addon => `${addon.name}: $${addon.price}`).join('; ')
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
    building_addons_details: buildingAddonsArray ? buildingAddonsArray.map(a => ({
      name: a.name ?? null,
      price: a.price ?? null,
      priceIncluded: typeof a.priceIncluded === 'boolean' ? a.priceIncluded : safeBoolean(a.priceIncluded),
      quantity: a.quantity ?? null
    })) : null,
    building_condition: safeValue(rawData.buildingCondition),
    building_custom_addons: customAddonsStr,
    building_custom_addons_details: customAddonsArray ? customAddonsArray.map(a => ({
      name: a.name ?? null,
      price: a.price ?? null,
      quantity: a.quantity ?? null
    })) : null,
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
    sold_by_dealer: safeValue(rawData.soldByDealer),
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
  const startTime = Date.now();
  
  while (hasMore) {
    try {
      const pageStartTime = Date.now();
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
      const pageDuration = Date.now() - pageStartTime;
      
      if (!Array.isArray(records) || records.length === 0) {
        console.log(`  ✅ No more records found on page ${page}`);
        hasMore = false;
        break;
      }
      
      allRecords.push(...records);
      console.log(`  ✅ Fetched ${records.length} records from page ${page} (${pageDuration}ms) - Total: ${allRecords.length}`);
      
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
  
  const totalDuration = Date.now() - startTime;
  console.log(`✅ Total records fetched: ${allRecords.length} (${totalDuration}ms)`);
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
  const transformStartTime = Date.now();
  
  const transformedRecords = [];
  for (let i = 0; i < records.length; i++) {
    const record = transformRecord(records[i]);
    if (record !== null) {
      transformedRecords.push(record);
    }
    
    // Show progress every 1000 records
    if ((i + 1) % 1000 === 0) {
      console.log(`    🔄 Transformed ${i + 1}/${records.length} records...`);
    }
  }
  
  const transformDuration = Date.now() - transformStartTime;
  console.log(`  ✅ Transformed ${transformedRecords.length} records (${transformDuration}ms)`);
  
  // Batch size for upsert operations
  const batchSize = 1000;
  let totalSynced = 0;
  
  console.log(`  🔄 Upserting to Supabase in batches of ${batchSize}...`);
  
  // Process in batches
  for (let i = 0; i < transformedRecords.length; i += batchSize) {
    const batch = transformedRecords.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(transformedRecords.length / batchSize);
    
    try {
      console.log(`    📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);
      
      const startTime = Date.now();
      const { data, error } = await supabase
        .from('shedsuite_orders')
        .upsert(batch, {
          onConflict: 'id',
          ignoreDuplicates: false
        })
        .select();
      
      const duration = Date.now() - startTime;
      
      if (error) {
        console.error(`    ❌ Batch ${batchNumber} failed:`, error.message);
        throw error;
      }
      
      totalSynced += data.length;
      console.log(`    ✅ Batch ${batchNumber} completed: ${data.length} records synced (${duration}ms)`);
      
      // Add a small delay between batches to be respectful to the database
      if (i + batchSize < transformedRecords.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(`❌ Error in batch ${batchNumber}:`, error.message);
      throw error;
    }
  }
  
  console.log(`✅ Successfully synced ${totalSynced} records to Supabase`);
  return totalSynced;
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

// Continuous sync function with smart deduplication and updates
async function performContinuousSync() {
  try {
    console.log('🔄 Starting continuous sync with smart deduplication...');
    
    // Get the last sync timestamp from our metadata
    const { data: metadata } = await supabase
      .from('sync_metadata')
      .select('last_sync_timestamp')
      .order('id', { ascending: false })
      .limit(1);
    
    const lastSyncTime = metadata && metadata[0] ? metadata[0].last_sync_timestamp : null;
    
    if (lastSyncTime) {
      console.log(`  📅 Last sync: ${lastSyncTime}`);
    } else {
      console.log('  📅 No previous sync found - will fetch recent records');
    }
    
    // Fetch recent records (either since last sync or most recent 1000)
    const params = {
      limit: 1000,
      sortOrder: 'desc',
      sortBy: 'id'
    };
    
    if (lastSyncTime) {
      // Add filter for records updated since last sync
      params.updated_after = lastSyncTime;
    }
    
    console.log('  📥 Fetching recent records from ShedSuite...');
    const response = await shedsuiteAPI.get('/api/public/customer-orders/v1', { params });
    const records = response.data;
    
    if (!Array.isArray(records) || records.length === 0) {
      console.log('  ✅ No new records to sync');
      return;
    }
    
    console.log(`  📊 Found ${records.length} records to process`);
    
    // Transform records
    const transformedRecords = records.map(record => transformRecord(record)).filter(record => record !== null);
    console.log(`  🔄 Transformed ${transformedRecords.length} records`);
    
    if (transformedRecords.length === 0) {
      console.log('  ✅ No valid records to sync');
      return;
    }
    
    // Perform smart upsert with deduplication
    const result = await performSmartUpsert(transformedRecords);
    
    // Update sync metadata
    const newSyncTime = new Date().toISOString();
    await supabase
      .from('sync_metadata')
      .upsert({
        id: 1,
        last_sync_timestamp: newSyncTime,
        sync_status: 'completed',
        records_processed: result.totalProcessed,
        records_inserted: result.inserted,
        records_updated: result.updated,
        sync_duration_ms: result.duration,
        updated_at: newSyncTime
      });
    
    console.log(`✅ Continuous sync completed: ${result.inserted} inserted, ${result.updated} updated`);
    
  } catch (error) {
    console.error('❌ Continuous sync failed:', error.message);
    
    // Update sync metadata with error
    await supabase
      .from('sync_metadata')
      .upsert({
        id: 1,
        sync_status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      });
  }
}

// Smart upsert function with detailed deduplication logic
async function performSmartUpsert(records) {
  console.log('  🔄 Performing smart upsert with deduplication...');
  
  const startTime = Date.now();
  let inserted = 0;
  let updated = 0;
  let totalProcessed = 0;
  
  // Process in smaller batches for better control
  const batchSize = 100;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(records.length / batchSize);
    
    console.log(`    📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);
    
    try {
      // First, check which records already exist
      const recordIds = batch.map(record => record.id).filter(id => id);
      
      if (recordIds.length === 0) {
        console.log(`    ⚠️  No valid IDs in batch ${batchNumber}`);
        continue;
      }
      
      // Check existing records
      const { data: existingRecords, error: checkError } = await supabase
        .from('shedsuite_orders')
        .select('id, sync_timestamp')
        .in('id', recordIds);
      
      if (checkError) {
        throw checkError;
      }
      
      const existingIds = new Set(existingRecords.map(r => r.id));
      const existingSyncTimes = new Map(existingRecords.map(r => [r.id, r.sync_timestamp]));
      
      // Separate new and existing records
      const newRecords = [];
      const updateRecords = [];
      
      batch.forEach(record => {
        if (record.id) {
          if (existingIds.has(record.id)) {
            // Check if this record is newer than what we have
            const existingSyncTime = existingSyncTimes.get(record.id);
            const recordSyncTime = record.sync_timestamp;
            
            if (!existingSyncTime || new Date(recordSyncTime) > new Date(existingSyncTime)) {
              updateRecords.push(record);
            }
            // If not newer, skip it (deduplication)
          } else {
            newRecords.push(record);
          }
        }
      });
      
      console.log(`      📊 Batch ${batchNumber}: ${newRecords.length} new, ${updateRecords.length} updates`);
      
      // Insert new records
      if (newRecords.length > 0) {
        const { data: insertData, error: insertError } = await supabase
          .from('shedsuite_orders')
          .insert(newRecords)
          .select();
        
        if (insertError) {
          throw insertError;
        }
        
        inserted += insertData.length;
        console.log(`      ✅ Inserted ${insertData.length} new records`);
      }
      
      // Update existing records
      if (updateRecords.length > 0) {
        const { data: updateData, error: updateError } = await supabase
          .from('shedsuite_orders')
          .upsert(updateRecords, {
            onConflict: 'id',
            ignoreDuplicates: false
          })
          .select();
        
        if (updateError) {
          throw updateError;
        }
        
        updated += updateData.length;
        console.log(`      ✅ Updated ${updateData.length} existing records`);
      }
      
      totalProcessed += batch.length;
      
      // Small delay between batches
      if (i + batchSize < records.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
    } catch (error) {
      console.error(`    ❌ Batch ${batchNumber} failed:`, error.message);
      throw error;
    }
  }
  
  const duration = Date.now() - startTime;
  
  return {
    inserted,
    updated,
    totalProcessed,
    duration
  };
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';
  const interval = args[1] || '5'; // Default 5 minutes
  
  try {
    switch (command) {
      case 'full':
        await performFullSync();
        break;
      case 'continuous':
        console.log('🔄 Starting continuous sync mode...');
        console.log(`⏰ Sync interval: ${interval} minutes`);
        console.log('Press Ctrl+C to stop');
        
        // Run continuous sync at specified interval
        const intervalMs = parseInt(interval) * 60 * 1000;
        setInterval(async () => {
          try {
            await performContinuousSync();
          } catch (error) {
            console.error('❌ Error in continuous sync interval:', error.message);
          }
        }, intervalMs);
        
        // Run initial sync
        await performContinuousSync();
        break;
      case 'once':
        console.log('🔄 Running single continuous sync...');
        await performContinuousSync();
        break;
      default:
        console.log('🚀 ShedSuite to Supabase Sync Tool');
        console.log('=====================================');
        console.log('');
        console.log('Usage:');
        console.log('  node start-sync.js full                    - Perform full sync (all records)');
        console.log('  node start-sync.js continuous [minutes]    - Start continuous sync (default: 5 min)');
        console.log('  node start-sync.js once                    - Run single continuous sync');
        console.log('');
        console.log('Examples:');
        console.log('  node start-sync.js full                    - Sync all 97k+ records');
        console.log('  node start-sync.js continuous              - Continuous sync every 5 minutes');
        console.log('  node start-sync.js continuous 10           - Continuous sync every 10 minutes');
        console.log('  node start-sync.js once                    - Single sync of recent changes');
        console.log('');
        console.log('Features:');
        console.log('  ✅ Smart deduplication (no duplicates)');
        console.log('  ✅ Incremental updates (only changed records)');
        console.log('  ✅ Timestamp-based sync tracking');
        console.log('  ✅ Detailed progress logging');
        console.log('  ✅ Error handling and recovery');
        break;
    }
  } catch (error) {
    console.error('❌ Application failed:', error.message);
    process.exit(1);
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