-- Add JSONB columns to store structured add-on details
ALTER TABLE IF EXISTS shedsuite_orders
  ADD COLUMN IF NOT EXISTS building_addons_details JSONB,
  ADD COLUMN IF NOT EXISTS building_custom_addons_details JSONB;

-- Optional: create GIN indexes for JSONB columns to enable key lookups (safe no-op if rerun)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_shedsuite_orders_building_addons_details'
  ) THEN
    CREATE INDEX idx_shedsuite_orders_building_addons_details ON shedsuite_orders USING GIN (building_addons_details);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_shedsuite_orders_building_custom_addons_details'
  ) THEN
    CREATE INDEX idx_shedsuite_orders_building_custom_addons_details ON shedsuite_orders USING GIN (building_custom_addons_details);
  END IF;
END$$;


