-- Create inventory_items table for ShedSuite Inventory sync
-- Run this SQL in your Supabase SQL Editor (Dashboard -> SQL Editor)

CREATE TABLE IF NOT EXISTS inventory_items (
  inventory_id text PRIMARY KEY,
  sku text,
  status text,
  location text,
  width_inches bigint,
  length_inches bigint,
  height_inches bigint,
  color text,
  material text,
  price double precision,
  cost double precision,
  created_at timestamptz,
  updated_at timestamptz,
  is_available boolean,
  vendor_name text,
  model text,
  synced_at timestamptz
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inventory_items_synced_at ON inventory_items(synced_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);

-- Add comment to table
COMMENT ON TABLE inventory_items IS 'ShedSuite Inventory items synced from the Inventory API';

