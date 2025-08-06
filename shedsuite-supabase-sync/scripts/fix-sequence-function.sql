-- Fix Sequence Function for Supabase Export Issues
-- This function helps resolve the "duplicate key violates unique constraint" error
-- that commonly occurs when exporting data from Supabase

-- Create a function to reset sequences
CREATE OR REPLACE FUNCTION reset_sequence(
    table_name text,
    column_name text DEFAULT 'id',
    new_value bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    sequence_name text;
    current_max bigint;
    next_val bigint;
BEGIN
    -- Get the sequence name for the table and column
    SELECT pg_get_serial_sequence(table_name, column_name) INTO sequence_name;
    
    IF sequence_name IS NULL THEN
        RAISE EXCEPTION 'No sequence found for table % column %', table_name, column_name;
    END IF;
    
    -- Get the current maximum value in the table
    EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', column_name, table_name) INTO current_max;
    
    -- Use provided new_value or current_max + 1
    IF new_value IS NULL THEN
        next_val := current_max + 1;
    ELSE
        next_val := new_value;
    END IF;
    
    -- Reset the sequence
    EXECUTE format('SELECT setval(%L, %s, false)', sequence_name, next_val);
    
    RAISE NOTICE 'Sequence % reset to % for table % column %', sequence_name, next_val, table_name, column_name;
END;
$$;

-- Create a function to check sequence status
CREATE OR REPLACE FUNCTION check_sequence_status(
    table_name text,
    column_name text DEFAULT 'id'
)
RETURNS TABLE(
    sequence_name text,
    current_value bigint,
    max_table_value bigint,
    is_synced boolean,
    next_value bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    seq_name text;
    current_seq_val bigint;
    max_table_val bigint;
BEGIN
    -- Get the sequence name
    SELECT pg_get_serial_sequence(table_name, column_name) INTO seq_name;
    
    IF seq_name IS NULL THEN
        RAISE EXCEPTION 'No sequence found for table % column %', table_name, column_name;
    END IF;
    
    -- Get current sequence value
    EXECUTE format('SELECT last_value FROM %I', seq_name) INTO current_seq_val;
    
    -- Get maximum value in table
    EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', column_name, table_name) INTO max_table_val;
    
    RETURN QUERY SELECT 
        seq_name,
        current_seq_val,
        max_table_val,
        (current_seq_val > max_table_val) as is_synced,
        (max_table_val + 1) as next_value;
END;
$$;

-- Create a function to fix all sequences in a schema
CREATE OR REPLACE FUNCTION fix_all_sequences(schema_name text DEFAULT 'public')
RETURNS TABLE(
    table_name text,
    column_name text,
    sequence_name text,
    was_fixed boolean,
    old_value bigint,
    new_value bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    table_record record;
    column_record record;
    seq_name text;
    current_val bigint;
    max_val bigint;
    fixed boolean;
BEGIN
    -- Loop through all tables in the schema
    FOR table_record IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = schema_name
    LOOP
        -- Loop through columns in each table
        FOR column_record IN
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = schema_name 
            AND table_name = table_record.tablename
            AND column_default LIKE 'nextval%'
        LOOP
            -- Get sequence name
            SELECT pg_get_serial_sequence(
                schema_name || '.' || table_record.tablename, 
                column_record.column_name
            ) INTO seq_name;
            
            IF seq_name IS NOT NULL THEN
                -- Get current sequence value
                EXECUTE format('SELECT last_value FROM %I', seq_name) INTO current_val;
                
                -- Get max value in table
                EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I.%I', 
                    column_record.column_name, schema_name, table_record.tablename) INTO max_val;
                
                -- Check if sequence needs fixing
                IF current_val <= max_val THEN
                    -- Fix sequence
                    EXECUTE format('SELECT setval(%L, %s, false)', seq_name, max_val + 1);
                    fixed := true;
                ELSE
                    fixed := false;
                END IF;
                
                RETURN QUERY SELECT 
                    table_record.tablename::text,
                    column_record.column_name::text,
                    seq_name,
                    fixed,
                    current_val,
                    CASE WHEN fixed THEN max_val + 1 ELSE current_val END;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

-- Create a function to analyze duplicate issues
CREATE OR REPLACE FUNCTION analyze_duplicates(
    table_name text,
    column_name text DEFAULT 'id'
)
RETURNS TABLE(
    total_rows bigint,
    unique_values bigint,
    duplicate_count bigint,
    duplicate_percentage numeric,
    min_id bigint,
    max_id bigint,
    sequence_gaps text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    total_count bigint;
    unique_count bigint;
    duplicate_count bigint;
    min_val bigint;
    max_val bigint;
    gap_record record;
    gaps text[];
BEGIN
    -- Get total count
    EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO total_count;
    
    -- Get unique count
    EXECUTE format('SELECT COUNT(DISTINCT %I) FROM %I', column_name, table_name) INTO unique_count;
    
    -- Calculate duplicates
    duplicate_count := total_count - unique_count;
    
    -- Get min and max values
    EXECUTE format('SELECT MIN(%I), MAX(%I) FROM %I', column_name, column_name, table_name) 
    INTO min_val, max_val;
    
    -- Find gaps in sequence
    gaps := ARRAY[]::text[];
    FOR gap_record IN
        EXECUTE format('
            WITH numbered AS (
                SELECT %I, ROW_NUMBER() OVER (ORDER BY %I) as rn
                FROM %I
                WHERE %I IS NOT NULL
            )
            SELECT 
                %I as current_id,
                rn as expected_id,
                (%I - rn) as gap_size
            FROM numbered
            WHERE %I != rn
            ORDER BY %I
        ', column_name, column_name, table_name, column_name, 
           column_name, column_name, column_name, column_name)
    LOOP
        gaps := array_append(gaps, 
            format('Gap at %s: expected %s, found %s (gap size: %s)', 
                gap_record.current_id, gap_record.expected_id, gap_record.current_id, gap_record.gap_size));
    END LOOP;
    
    RETURN QUERY SELECT 
        total_count,
        unique_count,
        duplicate_count,
        CASE WHEN total_count > 0 THEN 
            ROUND((duplicate_count::numeric / total_count::numeric) * 100, 2) 
        ELSE 0 END,
        min_val,
        max_val,
        gaps;
END;
$$;

-- Grant permissions to the functions
GRANT EXECUTE ON FUNCTION reset_sequence(text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION check_sequence_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fix_all_sequences(text) TO authenticated;
GRANT EXECUTE ON FUNCTION analyze_duplicates(text, text) TO authenticated;

-- Example usage:
-- 
-- 1. Check sequence status:
-- SELECT * FROM check_sequence_status('shedsuite_orders', 'id');
--
-- 2. Reset sequence if needed:
-- SELECT reset_sequence('shedsuite_orders', 'id');
--
-- 3. Fix all sequences in public schema:
-- SELECT * FROM fix_all_sequences('public');
--
-- 4. Analyze duplicates:
-- SELECT * FROM analyze_duplicates('shedsuite_orders', 'id'); 