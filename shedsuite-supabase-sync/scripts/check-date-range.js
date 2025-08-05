#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDateRange() {
  console.log('📅 Checking Date Range in Database...\n');

  try {
    // Get date range
    const { data: dateRange, error: dateError } = await supabase
      .from('shedsuite_orders')
      .select('date_ordered, timestamp, sync_timestamp')
      .order('date_ordered', { ascending: true, nullsFirst: false });

    if (dateError) throw dateError;

    const validDates = dateRange.filter(r => r.date_ordered).map(r => new Date(r.date_ordered));
    const oldestOrder = validDates.length > 0 ? new Date(Math.min(...validDates)) : null;
    const newestOrder = validDates.length > 0 ? new Date(Math.max(...validDates)) : null;

    console.log('📊 Date Range Analysis:');
    console.log(`   Oldest order date: ${oldestOrder ? oldestOrder.toISOString().split('T')[0] : 'Unknown'}`);
    console.log(`   Newest order date: ${newestOrder ? newestOrder.toISOString().split('T')[0] : 'Unknown'}`);
    console.log(`   Date span: ${oldestOrder && newestOrder ? Math.ceil((newestOrder - oldestOrder) / (1000 * 60 * 60 * 24)) : 'Unknown'} days`);

    // Check first sync timestamp
    const { data: syncInfo, error: syncError } = await supabase
      .from('shedsuite_orders')
      .select('sync_timestamp')
      .order('sync_timestamp', { ascending: true })
      .limit(1);

    if (!syncError && syncInfo.length > 0) {
      const firstSync = new Date(syncInfo[0].sync_timestamp);
      console.log(`   First sync: ${firstSync.toISOString().split('T')[0]}`);
    }

    // Get some sample older and newer orders
    const { data: sampleOld, error: oldError } = await supabase
      .from('shedsuite_orders')
      .select('id, customer_name, order_number, date_ordered')
      .order('date_ordered', { ascending: true, nullsFirst: false })
      .limit(3);

    const { data: sampleNew, error: newError } = await supabase
      .from('shedsuite_orders')
      .select('id, customer_name, order_number, date_ordered')
      .order('date_ordered', { ascending: false, nullsFirst: false })
      .limit(3);

    if (!oldError && sampleOld.length > 0) {
      console.log('\n📦 Oldest Orders in Database:');
      sampleOld.forEach((order, i) => {
        console.log(`   ${i + 1}. ${order.date_ordered?.split('T')[0]} - ${order.customer_name} (${order.order_number})`);
      });
    }

    if (!newError && sampleNew.length > 0) {
      console.log('\n📦 Newest Orders in Database:');
      sampleNew.forEach((order, i) => {
        console.log(`   ${i + 1}. ${order.date_ordered?.split('T')[0]} - ${order.customer_name} (${order.order_number})`);
      });
    }

    // Check for any status patterns
    const { data: statusCounts, error: statusError } = await supabase
      .from('shedsuite_orders')
      .select('status')
      .limit(1000);

    if (!statusError && statusCounts.length > 0) {
      const statusMap = {};
      statusCounts.forEach(record => {
        statusMap[record.status] = (statusMap[record.status] || 0) + 1;
      });

      console.log('\n📊 Order Status Distribution (sample):');
      Object.entries(statusMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([status, count]) => {
          console.log(`   ${status}: ${count}`);
        });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkDateRange().catch(console.error);