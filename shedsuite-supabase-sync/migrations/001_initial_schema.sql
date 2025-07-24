-- Initial schema for ShedSuite Supabase Sync Service
-- This creates the main tables needed for storing customer orders and sync metadata

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create sync_metadata table to track sync operations
CREATE TABLE IF NOT EXISTS sync_metadata (
    id BIGSERIAL PRIMARY KEY,
    last_sync_timestamp TIMESTAMPTZ,
    sync_status VARCHAR(50) DEFAULT 'idle',
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    sync_duration_ms INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer_orders table
CREATE TABLE IF NOT EXISTS customer_orders (
    id VARCHAR(255) PRIMARY KEY,
    customer_id VARCHAR(255),
    order_number VARCHAR(255),
    order_date TIMESTAMPTZ,
    status VARCHAR(100),
    total_amount DECIMAL(10,2),
    tax_amount DECIMAL(10,2),
    shipping_amount DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    payment_method VARCHAR(100),
    payment_status VARCHAR(100),
    shipping_address JSONB,
    billing_address JSONB,
    items JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Create customers table (if you want to separate customer data)
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(255) PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(100),
    company VARCHAR(255),
    address JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Create orders table (if you want to separate order data)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(255) PRIMARY KEY,
    order_number VARCHAR(255),
    customer_id VARCHAR(255),
    order_date TIMESTAMPTZ,
    status VARCHAR(100),
    total_amount DECIMAL(10,2),
    items_count INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_date ON customer_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_created_at ON customer_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_orders_updated_at ON customer_orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_customer_orders_sync_timestamp ON customer_orders(sync_timestamp);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_sync_timestamp ON customers(sync_timestamp);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_sync_timestamp ON orders(sync_timestamp);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_customer_orders_updated_at 
    BEFORE UPDATE ON customer_orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at 
    BEFORE UPDATE ON customers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial sync metadata record
INSERT INTO sync_metadata (id, last_sync_timestamp, sync_status, created_at, updated_at)
VALUES (1, NULL, 'idle', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create RLS (Row Level Security) policies if needed
-- Note: You may want to enable RLS and create policies based on your security requirements

-- Example RLS policy for customer_orders (uncomment if needed)
-- ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all operations for authenticated users" ON customer_orders
--     FOR ALL USING (auth.role() = 'authenticated');

-- Create views for common queries
CREATE OR REPLACE VIEW recent_orders AS
SELECT 
    co.id,
    co.order_number,
    co.customer_id,
    co.order_date,
    co.status,
    co.total_amount,
    co.payment_status,
    co.created_at,
    co.updated_at
FROM customer_orders co
WHERE co.order_date >= NOW() - INTERVAL '30 days'
ORDER BY co.order_date DESC;

CREATE OR REPLACE VIEW order_summary AS
SELECT 
    status,
    COUNT(*) as order_count,
    SUM(total_amount) as total_revenue,
    AVG(total_amount) as average_order_value
FROM customer_orders
GROUP BY status;

-- Grant necessary permissions (adjust based on your Supabase setup)
-- These are typically handled by Supabase automatically, but you can customize if needed

COMMENT ON TABLE customer_orders IS 'Stores customer order data synced from ShedSuite API';
COMMENT ON TABLE customers IS 'Stores customer data synced from ShedSuite API';
COMMENT ON TABLE orders IS 'Stores order data synced from ShedSuite API';
COMMENT ON TABLE sync_metadata IS 'Tracks sync operations and metadata'; 