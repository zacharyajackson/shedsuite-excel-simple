-- Complete ShedSuite Orders Schema - All Fields from API Extraction
-- This creates a table with ALL fields that are actually extracted from the ShedSuite API

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

-- Create the main table with ALL fields from the ShedSuite API extraction
CREATE TABLE IF NOT EXISTS shedsuite_orders (
    -- Primary key
    id VARCHAR(255) PRIMARY KEY,
    
    -- Main identifiers and basic info
    balance_dollar_amount DECIMAL(15,2),
    status VARCHAR(100),
    
    -- Billing Address
    billing_address_line_one VARCHAR(500),
    billing_address_line_two VARCHAR(500),
    billing_city VARCHAR(255),
    billing_state VARCHAR(100),
    billing_zip VARCHAR(20),
    
    -- Building Information
    building_addons TEXT,
    building_condition VARCHAR(255),
    building_custom_addons TEXT,
    building_length VARCHAR(255),
    building_model_name VARCHAR(255),
    building_roof_color VARCHAR(255),
    building_roof_type VARCHAR(255),
    building_siding_color VARCHAR(255),
    building_siding_type VARCHAR(255),
    building_size VARCHAR(255),
    building_width VARCHAR(255),
    
    -- Company/Dealer Information
    company_id VARCHAR(255),
    county_tax_rate DECIMAL(10,6),
    
    -- Customer Information
    customer_name VARCHAR(500),
    customer_email VARCHAR(255),
    customer_first_name VARCHAR(255),
    customer_id VARCHAR(255),
    customer_last_name VARCHAR(255),
    customer_phone_primary VARCHAR(255),
    customer_source VARCHAR(255),
    
    -- Dates
    date_delivered TIMESTAMPTZ,
    date_cancelled TIMESTAMPTZ,
    date_finished TIMESTAMPTZ,
    date_ordered TIMESTAMPTZ,
    date_processed TIMESTAMPTZ,
    date_scheduled_for_delivery TIMESTAMPTZ,
    
    -- Dealer Information
    dealer_id VARCHAR(255),
    dealer_primary_sales_rep VARCHAR(255),
    
    -- Delivery Address
    delivery_address_line_one VARCHAR(500),
    delivery_address_line_two VARCHAR(500),
    delivery_city VARCHAR(255),
    delivery_state VARCHAR(100),
    delivery_zip VARCHAR(20),
    
    -- Driver and Payment
    driver_name VARCHAR(255),
    initial_payment_dollar_amount DECIMAL(15,2),
    initial_payment_type VARCHAR(255),
    invoice_url TEXT,
    
    -- Order Information
    order_number VARCHAR(255),
    order_type VARCHAR(255),
    
    -- Promocode Information
    promocode_code VARCHAR(255),
    promocode_name VARCHAR(255),
    promocode_amount_discounted DECIMAL(15,2),
    promocode_type VARCHAR(255),
    promocode_value DECIMAL(15,2),
    promocode_target VARCHAR(255),
    
    -- RTO Information
    rto BOOLEAN,
    rto_company_name VARCHAR(255),
    rto_months_of_term INTEGER,
    
    -- Additional Information
    serial_number VARCHAR(255),
    shop_name VARCHAR(255),
    sold_by_dealer BOOLEAN,
    sold_by_dealer_id VARCHAR(255),
    sold_by_dealer_user VARCHAR(255),
    
    -- Tax Information
    special_district VARCHAR(255),
    special_district_rate DECIMAL(10,6),
    special_district_tax_dollar_amount DECIMAL(15,2),
    state VARCHAR(100),
    state_tax_dollar_amount DECIMAL(15,2),
    state_tax_rate DECIMAL(10,6),
    
    -- Totals and Adjustments
    sub_total_dollar_amount DECIMAL(15,2),
    sub_total_adjustment_dollar_amount DECIMAL(15,2),
    sub_total_adjustment_note TEXT,
    total_amount_dollar_amount DECIMAL(15,2),
    total_tax_dollar_amount DECIMAL(15,2),
    
    -- City/County Tax
    tax_city VARCHAR(255),
    tax_city_dollar_amount DECIMAL(15,2),
    tax_city_rate DECIMAL(10,6),
    tax_county VARCHAR(255),
    tax_county_dollar_amount DECIMAL(15,2),
    tax_county_rate DECIMAL(10,6),
    
    -- Timestamp
    timestamp TIMESTAMPTZ,
    
    -- Sync metadata
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create comprehensive indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_id ON shedsuite_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_order_number ON shedsuite_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_status ON shedsuite_orders(status);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_date_ordered ON shedsuite_orders(date_ordered);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_email ON shedsuite_orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_dealer_id ON shedsuite_orders(dealer_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_company_id ON shedsuite_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_name ON shedsuite_orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_billing_city ON shedsuite_orders(billing_city);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_billing_state ON shedsuite_orders(billing_state);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_delivery_city ON shedsuite_orders(delivery_city);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_delivery_state ON shedsuite_orders(delivery_state);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_building_model_name ON shedsuite_orders(building_model_name);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_total_amount ON shedsuite_orders(total_amount_dollar_amount);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_balance_amount ON shedsuite_orders(balance_dollar_amount);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_sync_timestamp ON shedsuite_orders(sync_timestamp);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_created_at ON shedsuite_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_updated_at ON shedsuite_orders(updated_at);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_status_date ON shedsuite_orders(status, date_ordered);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_dealer_status ON shedsuite_orders(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_customer_dealer ON shedsuite_orders(customer_id, dealer_id);

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

-- Create comprehensive views for common queries
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
    billing_city,
    billing_state,
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
    AVG(total_amount_dollar_amount) as average_order_value,
    SUM(balance_dollar_amount) as total_balance
FROM shedsuite_orders
GROUP BY status;

CREATE OR REPLACE VIEW customer_summary AS
SELECT 
    customer_id,
    customer_name,
    customer_email,
    COUNT(*) as total_orders,
    SUM(total_amount_dollar_amount) as total_spent,
    SUM(balance_dollar_amount) as total_balance,
    MAX(date_ordered) as last_order_date
FROM shedsuite_orders
WHERE customer_id IS NOT NULL
GROUP BY customer_id, customer_name, customer_email
ORDER BY total_spent DESC;

CREATE OR REPLACE VIEW dealer_summary AS
SELECT 
    dealer_id,
    COUNT(*) as total_orders,
    SUM(total_amount_dollar_amount) as total_revenue,
    AVG(total_amount_dollar_amount) as average_order_value,
    COUNT(DISTINCT customer_id) as unique_customers
FROM shedsuite_orders
WHERE dealer_id IS NOT NULL
GROUP BY dealer_id
ORDER BY total_revenue DESC;

CREATE OR REPLACE VIEW building_summary AS
SELECT 
    building_model_name,
    building_size,
    COUNT(*) as order_count,
    SUM(total_amount_dollar_amount) as total_revenue,
    AVG(total_amount_dollar_amount) as average_price
FROM shedsuite_orders
WHERE building_model_name IS NOT NULL
GROUP BY building_model_name, building_size
ORDER BY total_revenue DESC;

CREATE OR REPLACE VIEW state_summary AS
SELECT 
    billing_state,
    COUNT(*) as order_count,
    SUM(total_amount_dollar_amount) as total_revenue,
    AVG(total_amount_dollar_amount) as average_order_value
FROM shedsuite_orders
WHERE billing_state IS NOT NULL
GROUP BY billing_state
ORDER BY total_revenue DESC;

-- Add comments for documentation
COMMENT ON TABLE shedsuite_orders IS 'Complete ShedSuite orders table with all fields from API extraction';
COMMENT ON TABLE sync_metadata IS 'Tracks sync operations and metadata';
COMMENT ON VIEW recent_orders IS 'View of recent orders for quick access';
COMMENT ON VIEW order_summary IS 'Summary statistics by order status';
COMMENT ON VIEW customer_summary IS 'Summary statistics by customer';
COMMENT ON VIEW dealer_summary IS 'Summary statistics by dealer';
COMMENT ON VIEW building_summary IS 'Summary statistics by building model';
COMMENT ON VIEW state_summary IS 'Summary statistics by state'; 