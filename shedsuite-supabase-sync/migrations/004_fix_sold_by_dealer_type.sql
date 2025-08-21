-- Migration: Fix sold_by_dealer type to store dealer name (string)
-- Safely change column type from BOOLEAN to VARCHAR(500)

BEGIN;

-- Only run if the column exists and is not already text
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'shedsuite_orders'
      AND column_name = 'sold_by_dealer'
  ) THEN
    -- If column is boolean, convert to text; otherwise leave as-is
    PERFORM 1
    FROM information_schema.columns
    WHERE table_name = 'shedsuite_orders'
      AND column_name = 'sold_by_dealer'
      AND data_type = 'boolean';

    IF FOUND THEN
      ALTER TABLE shedsuite_orders
      ALTER COLUMN sold_by_dealer TYPE VARCHAR(500)
      USING CASE
        WHEN sold_by_dealer IS TRUE THEN 'true'
        WHEN sold_by_dealer IS FALSE THEN 'false'
        ELSE NULL
      END;
    END IF;
  END IF;
END $$;

COMMIT;


