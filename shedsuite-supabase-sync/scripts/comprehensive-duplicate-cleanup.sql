-- COMPREHENSIVE DUPLICATE CLEANUP
-- This script removes ALL duplicates found in the CSV analysis
-- Removes 33,921 duplicate records, keeping only 64,007 unique records

-- Step 1: EMERGENCY BACKUP - Backup ALL data before mass deletion
DROP TABLE IF EXISTS shedsuite_orders_full_backup;
CREATE TABLE shedsuite_orders_full_backup AS 
SELECT * FROM shedsuite_orders;

-- Step 2: Get current state before cleanup
SELECT 
    'BEFORE COMPREHENSIVE CLEANUP' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT order_number) as duplicate_order_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicate_id_records
FROM shedsuite_orders;

-- Step 3: Show the scale of duplicates
SELECT 
    'DUPLICATE SCALE ANALYSIS' as analysis,
    COUNT(*) as records_with_duplicates
FROM (
    SELECT order_number
    FROM shedsuite_orders
    GROUP BY order_number
    HAVING COUNT(*) > 1
) duplicated_orders;

-- Step 4: Sample of worst duplicates
SELECT 
    order_number,
    COUNT(*) as occurrence_count,
    STRING_AGG(DISTINCT id::text, ', ' ORDER BY id::text) as all_ids
FROM shedsuite_orders
GROUP BY order_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Step 5: COMPREHENSIVE CLEANUP - Remove ALL duplicates
-- Keep only the record with the latest sync_timestamp for each order_number
-- This matches the CSV analysis findings
DELETE FROM shedsuite_orders 
WHERE ctid IN (
    SELECT ctid
    FROM (
        SELECT 
            ctid,
            order_number,
            sync_timestamp,
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
);

-- Step 6: Verify cleanup results
SELECT 
    'AFTER COMPREHENSIVE CLEANUP' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT order_number) as remaining_duplicate_order_records,
    COUNT(*) - COUNT(DISTINCT id) as remaining_duplicate_id_records
FROM shedsuite_orders;

-- Step 7: Verify expected target of 64,007 unique records
SELECT 
    CASE 
        WHEN COUNT(*) = 64007 THEN '✅ SUCCESS: Achieved target of 64,007 unique records'
        ELSE CONCAT('❌ MISMATCH: Expected 64,007, got ', COUNT(*))
    END as cleanup_result
FROM shedsuite_orders;

-- Step 8: Verify no duplicates remain
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ NO DUPLICATES: All order_number values are unique'
        ELSE CONCAT('❌ ', COUNT(*), ' DUPLICATE PATTERNS STILL EXIST')
    END as duplicate_check
FROM (
    SELECT order_number
    FROM shedsuite_orders
    GROUP BY order_number
    HAVING COUNT(*) > 1
) remaining_duplicates;

-- Step 9: Show backup table statistics
SELECT 
    'BACKUP VERIFICATION' as backup_status,
    COUNT(*) as original_records_backed_up,
    COUNT(DISTINCT order_number) as unique_orders_in_backup
FROM shedsuite_orders_full_backup;

-- Step 10: Calculate cleanup impact
SELECT 
    b.total_original,
    c.total_remaining,
    b.total_original - c.total_remaining as records_removed,
    ROUND(((b.total_original - c.total_remaining)::numeric / b.total_original::numeric) * 100, 2) as percent_removed
FROM 
    (SELECT COUNT(*) as total_original FROM shedsuite_orders_full_backup) b,
    (SELECT COUNT(*) as total_remaining FROM shedsuite_orders) c;

-- After running this script successfully:
-- 1. Verify the results show exactly 64,007 records
-- 2. Add the unique constraint: ALTER TABLE shedsuite_orders ADD CONSTRAINT unique_order_number UNIQUE (order_number);
-- 3. Deploy the fixed upsert logic to production
-- 4. Resume sync operations