-- Create a view that flattens add-on JSON arrays into row-level records for analytics
CREATE OR REPLACE VIEW public.shedsuite_order_addons_flat AS
WITH base AS (
  SELECT 
    o.id AS order_id,
    o.order_number,
    o.customer_name,
    o.status,
    o.date_ordered,
    o.total_amount_dollar_amount,
    o.building_addons_details,
    o.building_custom_addons_details
  FROM public.shedsuite_orders o
)
-- Standard add-ons
, addons AS (
  SELECT 
    order_id,
    order_number,
    customer_name,
    status,
    date_ordered,
    total_amount_dollar_amount,
    'standard'::text AS addon_type,
    addon->>'name' AS addon_name,
    (addon->>'price')::numeric AS addon_price,
    COALESCE(NULLIF(addon->>'quantity',''), NULL)::numeric AS addon_quantity,
    CASE 
      WHEN lower(coalesce(addon->>'priceIncluded','')) IN ('true','1','yes') THEN true
      WHEN lower(coalesce(addon->>'priceIncluded','')) IN ('false','0','no') THEN false
      ELSE NULL
    END AS addon_price_included
  FROM base
  CROSS JOIN LATERAL jsonb_array_elements(building_addons_details) AS addon
  WHERE building_addons_details IS NOT NULL AND jsonb_typeof(building_addons_details) = 'array'
)
-- Custom add-ons
, custom_addons AS (
  SELECT 
    order_id,
    order_number,
    customer_name,
    status,
    date_ordered,
    total_amount_dollar_amount,
    'custom'::text AS addon_type,
    addon->>'name' AS addon_name,
    (addon->>'price')::numeric AS addon_price,
    COALESCE(NULLIF(addon->>'quantity',''), NULL)::numeric AS addon_quantity,
    NULL::boolean AS addon_price_included
  FROM base
  CROSS JOIN LATERAL jsonb_array_elements(building_custom_addons_details) AS addon
  WHERE building_custom_addons_details IS NOT NULL AND jsonb_typeof(building_custom_addons_details) = 'array'
)
SELECT * FROM addons
UNION ALL
SELECT * FROM custom_addons;

-- Helpful index on the base table for common filters
CREATE INDEX IF NOT EXISTS idx_shedsuite_orders_date_ordered ON public.shedsuite_orders (date_ordered);


