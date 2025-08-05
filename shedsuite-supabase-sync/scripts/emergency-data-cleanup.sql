-- Emergency Data Cleanup Script for ShedSuite Orders
-- ⚠️  CRITICAL: Run this ONLY after backing up your data!
-- Date: 2025-07-27
-- Purpose: Remove duplicate records and prepare for clean resync

-- Step 1: Create backup table (REQUIRED before any cleanup)
CREATE TABLE IF NOT EXISTS shedsuite_orders_backup_emergency_20250727 AS 
SELECT * FROM shedsuite_orders;

-- Step 2: Analyze current duplicate situation
-- This will show you the scope of the duplicate problem
SELECT 
    'Duplicate Analysis' as report_type,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) - COUNT(DISTINCT id) as duplicate_count,
    ROUND(((COUNT(*) - COUNT(DISTINCT id))::decimal / COUNT(*)) * 100, 2) as duplicate_percentage
FROM shedsuite_orders;

-- Step 3: Show top duplicated IDs
SELECT 
    id,
    COUNT(*) as duplicate_count,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created,
    array_agg(DISTINCT sync_timestamp ORDER BY sync_timestamp) as sync_timestamps
FROM shedsuite_orders 
GROUP BY id 
HAVING COUNT(*) > 1 
ORDER BY duplicate_count DESC 
LIMIT 20;

-- Step 4: Remove duplicates (keeping the most recent sync_timestamp)
-- ⚠️  This is the dangerous part - only run after confirming backup
WITH ranked_records AS (
    SELECT 
        id,
        ctid,
        ROW_NUMBER() OVER (
            PARTITION BY id 
            ORDER BY 
                sync_timestamp DESC NULLS LAST,
                created_at DESC NULLS LAST,
                ctid
        ) as rn
    FROM shedsuite_orders
)
DELETE FROM shedsuite_orders 
WHERE ctid IN (
    SELECT ctid 
    FROM ranked_records 
    WHERE rn > 1
);

-- Step 5: Verify cleanup results
SELECT 
    'After Cleanup' as report_type,
    COUNT(*) as total_records,
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) - COUNT(DISTINCT id) as remaining_duplicates
FROM shedsuite_orders;

-- Step 6: Create temporary unique constraint to prevent future duplicates
-- (Remove this if you need to do a full resync)
ALTER TABLE shedsuite_orders 
ADD CONSTRAINT temp_unique_id_constraint UNIQUE (id);