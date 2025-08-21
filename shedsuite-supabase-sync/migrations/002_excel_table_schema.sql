-- Excel Table Schema for ShedSuite Supabase Sync Service
-- This creates a single table that matches the Excel structure from the main project

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

-- Create the main Excel-style table with all fields from the main project
CREATE TABLE IF NOT EXISTS shedsuite_orders (
    -- Primary key
    id VARCHAR(255) PRIMARY KEY,
    
    -- Basic order information
    order_number VARCHAR(255),
    customer_name VARCHAR(500),
    status VARCHAR(100),
    date_ordered TIMESTAMPTZ,
    date_updated TIMESTAMPTZ,
    timestamp TIMESTAMPTZ,
    
    -- Building information
    building_model_name VARCHAR(255),
    building_size VARCHAR(255),
    building_length VARCHAR(255),
    building_width VARCHAR(255),
    building_roof_type VARCHAR(255),
    building_roof_color VARCHAR(255),
    building_siding_type VARCHAR(255),
    building_siding_color VARCHAR(255),
    building_condition VARCHAR(255),
    building_addons TEXT,
    building_custom_addons TEXT,
    
    -- Financial information
    total_amount_dollar_amount DECIMAL(15,2),
    balance_dollar_amount DECIMAL(15,2),
    sub_total_dollar_amount DECIMAL(15,2),
    sub_total_adjustment_dollar_amount DECIMAL(15,2),
    sub_total_adjustment_note TEXT,
    total_tax_dollar_amount DECIMAL(15,2),
    state_tax_dollar_amount DECIMAL(15,2),
    state_tax_rate DECIMAL(10,6),
    initial_payment_dollar_amount DECIMAL(15,2),
    initial_payment_type VARCHAR(255),
    
    -- Customer information
    customer_email VARCHAR(255),
    customer_phone_primary VARCHAR(255),
    customer_first_name VARCHAR(255),
    customer_last_name VARCHAR(255),
    customer_id VARCHAR(255),
    customer_source VARCHAR(255),
    
    -- Delivery address
    delivery_address_line_one VARCHAR(500),
    delivery_address_line_two VARCHAR(500),
    delivery_city VARCHAR(255),
    delivery_state VARCHAR(100),
    delivery_zip VARCHAR(20),
    
    -- Billing address
    billing_address_line_one VARCHAR(500),
    billing_address_line_two VARCHAR(500),
    billing_city VARCHAR(255),
    billing_state VARCHAR(100),
    billing_zip VARCHAR(20),
    
    -- Company and dealer information
    company_id VARCHAR(255),
    dealer_id VARCHAR(255),
    dealer_primary_sales_rep VARCHAR(255),
    sold_by_dealer VARCHAR(500),
    sold_by_dealer_id VARCHAR(255),
    sold_by_dealer_user VARCHAR(255),
    shop_name VARCHAR(255),
    driver_name VARCHAR(255),
    
    -- Order details
    serial_number VARCHAR(255),
    order_type VARCHAR(255),
    rto BOOLEAN,
    rto_company_name VARCHAR(255),
    rto_months_of_term INTEGER,
    invoice_url TEXT,
    
    -- Important dates
    date_delivered TIMESTAMPTZ,
    date_cancelled TIMESTAMPTZ,
    date_finished TIMESTAMPTZ,
    date_processed TIMESTAMPTZ,
    date_scheduled_for_delivery TIMESTAMPTZ,
    
    -- Promo code information
    promocode_code VARCHAR(255),
    promocode_name VARCHAR(255),
    promocode_amount_discounted DECIMAL(15,2),
    promocode_type VARCHAR(255),
    promocode_value DECIMAL(15,2),
    promocode_target VARCHAR(255),
    
    -- Tax information
    tax_city VARCHAR(255),
    tax_city_dollar_amount DECIMAL(15,2),
    tax_city_rate DECIMAL(10,6),
    tax_county VARCHAR(255),
    tax_county_dollar_amount DECIMAL(15,2),
    tax_county_rate DECIMAL(10,6),
    county_tax_rate DECIMAL(10,6),
    special_district VARCHAR(255),
    special_district_rate DECIMAL(10,6),
    special_district_tax_dollar_amount DECIMAL(15,2),
    state VARCHAR(100),
    
    -- Sync metadata
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_id ON shedsuite_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_order_number ON shedsuite_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_status ON shedsuite_orders(status);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_date_ordered ON shedsuite_orders(date_ordered);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_email ON shedsuite_orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_dealer_id ON shedsuite_orders(dealer_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_company_id ON shedsuite_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_sync_timestamp ON shedsuite_orders(sync_timestamp);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_created_at ON shedsuite_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_updated_at ON shedsuite_orders(updated_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_shedsuite_orders_updated_at 
    BEFORE UPDATE ON shedsuite_orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial sync metadata record
INSERT INTO sync_metadata (id, last_sync_timestamp, sync_status, created_at, updated_at)
VALUES (1, NULL, 'idle', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create views for common queries
CREATE OR REPLACE VIEW recent_orders AS
SELECT 
    id,
    order_number,
    customer_name,
    status,
    date_ordered,
    total_amount_dollar_amount,
    balance_dollar_amount,
    customer_email,
    dealer_id,
    created_at,
    updated_at
FROM shedsuite_orders
WHERE date_ordered >= NOW() - INTERVAL '30 days'
ORDER BY date_ordered DESC;

CREATE OR REPLACE VIEW order_summary AS
SELECT 
    status,
    COUNT(*) as order_count,
    SUM(total_amount_dollar_amount) as total_revenue,
    AVG(total_amount_dollar_amount) as average_order_value
FROM shedsuite_orders
GROUP BY status;

CREATE OR REPLACE VIEW customer_summary AS
SELECT 
    customer_id,
    customer_name,
    customer_email,
    COUNT(*) as total_orders,
    SUM(total_amount_dollar_amount) as total_spent,
    MAX(date_ordered) as last_order_date
FROM shedsuite_orders
WHERE customer_id IS NOT NULL
GROUP BY customer_id, customer_name, customer_email
ORDER BY total_spent DESC;

-- Add comments for documentation
COMMENT ON TABLE shedsuite_orders IS 'Main table storing ShedSuite order data matching Excel structure';
COMMENT ON TABLE sync_metadata IS 'Tracks sync operations and metadata';
COMMENT ON VIEW recent_orders IS 'View of recent orders for quick access';
COMMENT ON VIEW order_summary IS 'Summary statistics by order status';
COMMENT ON VIEW customer_summary IS 'Summary statistics by customer'; 