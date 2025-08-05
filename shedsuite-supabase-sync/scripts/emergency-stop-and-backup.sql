-- EMERGENCY DUPLICATE CRISIS - BACKUP AND ANALYSIS
-- Date: 2025-07-27
-- CRITICAL: Run this IMMEDIATELY in Supabase SQL Editor

-- Step 1: Create complete backup before any changes
CREATE TABLE IF NOT EXISTS shedsuite_orders_backup_crisis_20250727 AS 
SELECT * FROM shedsuite_orders;

-- Verify backup was created
SELECT 
    'Original Table' as table_name,
    COUNT(*) as record_count
FROM shedsuite_orders
UNION ALL
SELECT 
    'Backup Table' as table_name,
    COUNT(*) as record_count  
FROM shedsuite_orders_backup_crisis_20250727;

-- Step 2: Check if primary key constraint exists (THIS IS CRITICAL)
SELECT 
    tc.constraint_name, 
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.table_name = 'shedsuite_orders' 
    AND tc.constraint_type = 'PRIMARY KEY';

-- Step 3: Analyze duplicate patterns
SELECT 
    'Duplicate Analysis' as analysis_type,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) - COUNT(DISTINCT id) as duplicate_id_records,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT order_number) as duplicate_order_records
FROM shedsuite_orders;

-- Step 4: Find worst duplicate IDs
SELECT 
    id,
    COUNT(*) as copy_count,
    array_agg(DISTINCT customer_name) as customer_names,
    array_agg(DISTINCT order_number) as order_numbers,
    MIN(sync_timestamp) as first_sync,
    MAX(sync_timestamp) as latest_sync,
    MAX(sync_timestamp) - MIN(sync_timestamp) as time_span
FROM shedsuite_orders 
GROUP BY id 
HAVING COUNT(*) > 1 
ORDER BY COUNT(*) DESC, id
LIMIT 20;

-- Step 5: Find worst duplicate order numbers
SELECT 
    order_number,
    COUNT(*) as copy_count,
    array_agg(DISTINCT id::text) as different_ids,
    array_agg(DISTINCT customer_name) as customer_names,
    MIN(sync_timestamp) as first_sync,
    MAX(sync_timestamp) as latest_sync
FROM shedsuite_orders 
WHERE order_number IS NOT NULL
GROUP BY order_number 
HAVING COUNT(*) > 1 
ORDER BY COUNT(*) DESC, order_number
LIMIT 20;

-- Step 6: Check sync timestamp patterns (identify when duplicates started)
SELECT 
    DATE(sync_timestamp) as sync_date,
    COUNT(*) as records_synced,
    COUNT(DISTINCT id) as unique_ids_synced,
    COUNT(*) - COUNT(DISTINCT id) as duplicates_created
FROM shedsuite_orders 
WHERE sync_timestamp IS NOT NULL
GROUP BY DATE(sync_timestamp)
ORDER BY sync_date DESC
LIMIT 10;

-- Step 7: Sample duplicate records for analysis
SELECT 
    id,
    customer_name,
    order_number,
    sync_timestamp,
    created_at,
    updated_at,
    ctid  -- Physical row identifier
FROM shedsuite_orders 
WHERE id = '2755'  -- Worst duplicate from analysis
ORDER BY sync_timestamp DESC, ctid;