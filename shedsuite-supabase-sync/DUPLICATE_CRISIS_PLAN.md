# 🚨 DUPLICATE CRISIS - IMMEDIATE ACTION PLAN

**Date:** July 27, 2025  
**Status:** CRITICAL - 35,589 duplicate records found  
**Impact:** Database integrity compromised

---

## 📊 **CONFIRMED PROBLEM SCOPE:**

- **Total Records:** 98,266
- **Unique IDs:** 62,677  
- **Unique Order Numbers:** 62,531
- **Duplicate Records:** ~35,589 (36.2% of database!)
- **Worst Duplicate:** ID "2755" has 4 copies

---

## 🚨 **IMMEDIATE ACTIONS (Next 30 minutes):**

### 1. STOP ALL SYNC PROCESSES
```bash
# On Railway dashboard - STOP the service NOW
# This prevents creating more duplicates
```

### 2. CREATE EMERGENCY BACKUP
```sql
-- Run in Supabase SQL Editor
CREATE TABLE shedsuite_orders_backup_crisis_20250727 AS 
SELECT * FROM shedsuite_orders;
```

### 3. INVESTIGATE PRIMARY KEY ISSUE
The database supposedly has a primary key on `id`, but duplicates exist. This suggests:
- Primary key constraint doesn't exist
- Constraint was dropped
- Upsert logic is bypassing constraints

---

## 🔍 **ROOT CAUSE ANALYSIS:**

### Why Duplicates Exist:
1. **Missing Primary Key Constraint** - Database allowing duplicate IDs
2. **Faulty Upsert Logic** - System inserting instead of updating
3. **Race Conditions** - Multiple sync processes running simultaneously 
4. **Sync Logic Bugs** - Not checking for existing records properly

### Evidence from Logs:
- Railway logs showed "successful" upserts
- But these were actually creating duplicates, not updating
- System marked operations as "successful" while corrupting data

---

## 🛠️ **DUPLICATE CLEANUP STRATEGY:**

### Phase 1: Safe Identification (Low Risk)
```sql
-- Find all duplicate IDs and their details
SELECT 
    id,
    COUNT(*) as copy_count,
    array_agg(DISTINCT customer_name) as customers,
    array_agg(DISTINCT order_number) as order_numbers,
    MIN(sync_timestamp) as first_sync,
    MAX(sync_timestamp) as latest_sync
FROM shedsuite_orders 
GROUP BY id 
HAVING COUNT(*) > 1 
ORDER BY COUNT(*) DESC
LIMIT 50;
```

### Phase 2: Smart Deduplication (Medium Risk)
**Strategy:** Keep the record with the latest `sync_timestamp` for each ID

```sql
-- DANGER: Only run after backup!
WITH ranked_records AS (
    SELECT 
        ctid,
        id,
        sync_timestamp,
        ROW_NUMBER() OVER (
            PARTITION BY id 
            ORDER BY 
                sync_timestamp DESC NULLS LAST,
                updated_at DESC NULLS LAST,
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
```

### Phase 3: Add Proper Constraints (Low Risk)
```sql
-- After cleanup, add proper constraints
ALTER TABLE shedsuite_orders 
ADD CONSTRAINT shedsuite_orders_pkey PRIMARY KEY (id);

-- Prevent future order number duplicates too
CREATE UNIQUE INDEX idx_unique_order_number 
ON shedsuite_orders (order_number) 
WHERE order_number IS NOT NULL;
```

---

## 🔧 **SYNC LOGIC FIXES REQUIRED:**

### Issue 1: Upsert Configuration
Current code uses:
```javascript
.upsert(orders, {
  onConflict: 'id',
  ignoreDuplicates: false
})
```

**Problem:** If no primary key constraint exists, this becomes an INSERT operation.

### Issue 2: No Pre-Check Logic
The sync doesn't verify existing records before inserting.

### Issue 3: Race Conditions
Multiple sync processes may be running simultaneously.

---

## 📋 **STEP-BY-STEP RECOVERY PLAN:**

### Step 1: EMERGENCY STOP (NOW)
- [ ] Stop Railway service
- [ ] Create database backup
- [ ] Document current state

### Step 2: ANALYSIS (30 minutes)
- [ ] Check if primary key constraint exists
- [ ] Analyze worst duplicate records
- [ ] Identify data inconsistencies

### Step 3: CLEANUP (1-2 hours)
- [ ] Test cleanup strategy on backup
- [ ] Execute duplicate removal
- [ ] Verify record counts

### Step 4: PREVENTION (2-3 hours)
- [ ] Add proper database constraints
- [ ] Fix sync logic
- [ ] Add duplicate detection
- [ ] Test with small dataset

### Step 5: RECOVERY (1 hour)
- [ ] Restart sync with fixed logic
- [ ] Monitor for new duplicates
- [ ] Validate data integrity

---

## 🎯 **EXPECTED OUTCOMES:**

### After Cleanup:
- **Records:** ~62,677 (unique IDs only)
- **Data Integrity:** 100% unique IDs and order numbers
- **Database Size:** Reduced by ~36%
- **Sync Performance:** Improved (fewer records to process)

### After Fixes:
- **No New Duplicates:** Proper constraints prevent them
- **Reliable Sync:** Upsert logic works correctly
- **Data Confidence:** Can trust the data for business decisions

---

## ⚠️ **RISKS & MITIGATION:**

### Risk 1: Data Loss During Cleanup
**Mitigation:** Complete backup before any changes

### Risk 2: Wrong Records Deleted
**Mitigation:** Keep records with latest sync_timestamp (most recent data)

### Risk 3: Business Impact
**Mitigation:** Cleanup during low-usage hours, communicate with stakeholders

---

## 🚀 **IMMEDIATE NEXT STEPS:**

1. **STOP Railway service** (prevent more damage)
2. **Run emergency backup** (protect current state)
3. **Check database constraints** (understand why duplicates exist)
4. **Plan cleanup execution** (safe duplicate removal)
5. **Fix sync logic** (prevent recurrence)

**This is fixable, but requires immediate action to prevent further data corruption!**