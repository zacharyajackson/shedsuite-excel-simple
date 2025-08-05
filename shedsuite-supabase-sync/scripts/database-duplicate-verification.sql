-- DATABASE DUPLICATE VERIFICATION
-- This mirrors the CSV analysis logic exactly to verify what's actually in the database

-- Step 1: Check specific duplicates that CSV found
SELECT 'VERIFY CSV FINDINGS' as check_type;

-- Check for ID "6675" (James Rylee) that CSV shows 5 times
SELECT 
    'ID 6675 CHECK' as analysis,
    COUNT(*) as occurrences,
    STRING_AGG(DISTINCT order_number, ', ') as order_numbers,
    STRING_AGG(DISTINCT customer_name, ', ') as customer_names
FROM shedsuite_orders 
WHERE id = '6675';

-- Check for Order "51-43104" (Joshua Landry) that CSV shows 5 times  
SELECT 
    'ORDER 51-43104 CHECK' as analysis,
    COUNT(*) as occurrences,
    STRING_AGG(DISTINCT id::text, ', ') as all_ids,
    STRING_AGG(DISTINCT customer_name, ', ') as customer_names
FROM shedsuite_orders 
WHERE order_number = '51-43104';

-- Step 2: Count duplicates using EXACT same logic as CSV
SELECT 
    'DUPLICATE COUNT ANALYSIS' as analysis,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT id) as duplicate_id_records,
    COUNT(*) - COUNT(DISTINCT order_number) as duplicate_order_records
FROM shedsuite_orders;

-- Step 3: Find duplicate IDs (same as CSV logic)
SELECT 
    'TOP ID DUPLICATES' as analysis,
    id,
    COUNT(*) as occurrence_count,
    STRING_AGG(DISTINCT order_number, ', ') as order_numbers,
    STRING_AGG(DISTINCT customer_name, ', ') as customer_names
FROM shedsuite_orders
GROUP BY id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Step 4: Find duplicate order numbers (same as CSV logic)
SELECT 
    'TOP ORDER NUMBER DUPLICATES' as analysis,
    order_number,
    COUNT(*) as occurrence_count,
    STRING_AGG(DISTINCT id::text, ', ') as all_ids,
    STRING_AGG(DISTINCT customer_name, ', ') as customer_names
FROM shedsuite_orders
GROUP BY order_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Step 5: TEST our DELETE logic - show what WOULD be deleted
SELECT 
    'DELETE PREVIEW' as analysis,
    COUNT(*) as records_that_would_be_deleted
FROM (
    SELECT 
        ctid,
        id,
        order_number,
        customer_name,
        sync_timestamp,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY order_number 
            ORDER BY 
                sync_timestamp DESC NULLS LAST,
                created_at DESC NULLS LAST,
                id DESC
        ) as rn
    FROM shedsuite_orders
) ranked
WHERE rn > 1;

-- Step 6: Show sample records that WOULD be deleted
SELECT 
    'SAMPLE RECORDS TO DELETE' as analysis,
    id,
    order_number,
    customer_name,
    sync_timestamp,
    rn as row_number_within_order
FROM (
    SELECT 
        id,
        order_number,
        customer_name,
        sync_timestamp,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY order_number 
            ORDER BY 
                sync_timestamp DESC NULLS LAST,
                created_at DESC NULLS LAST,
                id DESC
        ) as rn
    FROM shedsuite_orders
) ranked
WHERE rn > 1
ORDER BY order_number, rn
LIMIT 20;

-- Step 7: Check if data types are causing issues
SELECT 
    'DATA TYPE CHECK' as analysis,
    pg_typeof(id) as id_type,
    pg_typeof(order_number) as order_number_type,
    pg_typeof(sync_timestamp) as sync_timestamp_type,
    pg_typeof(created_at) as created_at_type
FROM shedsuite_orders
LIMIT 1;