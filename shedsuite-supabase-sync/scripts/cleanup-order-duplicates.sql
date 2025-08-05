-- EMERGENCY DUPLICATE CLEANUP SCRIPT
-- This script removes duplicate order_number records, keeping the most recent one
-- Run this BEFORE adding the unique constraint

-- Step 1: Backup the duplicates we're about to delete
CREATE TABLE IF NOT EXISTS shedsuite_orders_duplicates_backup AS
SELECT *
FROM shedsuite_orders s1
WHERE EXISTS (
    SELECT 1 
    FROM shedsuite_orders s2 
    WHERE s2.order_number = s1.order_number 
    AND s2.ctid != s1.ctid
);

-- Step 2: Get count of duplicates before cleanup
SELECT 
    'BEFORE CLEANUP' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT order_number) as duplicate_records
FROM shedsuite_orders;

-- Step 3: Show sample duplicates that will be removed
SELECT 
    order_number,
    COUNT(*) as occurrence_count,
    STRING_AGG(id::text, ', ' ORDER BY sync_timestamp DESC) as all_ids,
    STRING_AGG(sync_timestamp::text, ', ' ORDER BY sync_timestamp DESC) as all_timestamps
FROM shedsuite_orders
GROUP BY order_number
HAVING COUNT(*) > 1
ORDER BY occurrence_count DESC
LIMIT 10;

-- Step 4: Delete duplicates, keeping the most recent sync_timestamp for each order_number
-- This uses a window function to identify which records to keep
DELETE FROM shedsuite_orders 
WHERE ctid IN (
    SELECT ctid
    FROM (
        SELECT 
            ctid,
            ROW_NUMBER() OVER (
                PARTITION BY order_number 
                ORDER BY sync_timestamp DESC, id DESC
            ) as rn
        FROM shedsuite_orders
    ) ranked
    WHERE rn > 1
);

-- Step 5: Verify cleanup results
SELECT 
    'AFTER CLEANUP' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) - COUNT(DISTINCT order_number) as duplicate_records
FROM shedsuite_orders;

-- Step 6: Check that FF-67197 is now unique
SELECT 
    order_number,
    COUNT(*) as count,
    STRING_AGG(id::text, ', ') as remaining_ids
FROM shedsuite_orders 
WHERE order_number = 'FF-67197'
GROUP BY order_number;

-- Step 7: Show backup table statistics
SELECT 
    'BACKUP TABLE' as status,
    COUNT(*) as backed_up_duplicates
FROM shedsuite_orders_duplicates_backup;

-- After running this script successfully, you can then add the unique constraint:
-- ALTER TABLE shedsuite_orders ADD CONSTRAINT unique_order_number UNIQUE (order_number);