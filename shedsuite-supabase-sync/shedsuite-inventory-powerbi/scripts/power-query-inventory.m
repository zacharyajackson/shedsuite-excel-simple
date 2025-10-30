// ============================================================================
// Power BI M Query: ShedSuite Inventory from Supabase
// ============================================================================
// Usage: 
//   1. Open Power BI Desktop
//   2. Get Data > Blank Query
//   3. Advanced Editor (Home > Advanced Editor)
//   4. Paste this script
//   5. Update ApiBase and ApiKey below
//   6. Click Done
// ============================================================================
//
// Configuration:
//   - ApiBase: Your Supabase project URL (e.g., "https://your-project.supabase.co")
//   - ApiKey: Your Supabase anon key (from Dashboard > Settings > API)
//   - PageSize: Records per page (default: 1000, increase if needed)
//
// Columns Retrieved:
//   inventory_id, sku, status, location, width_inches, length_inches, 
//   height_inches, color, material, price, cost, created_at, updated_at,
//   is_available, vendor_name, model, synced_at
// ============================================================================

let
    // ==== CONFIGURATION (UPDATE THESE) ====
    ApiBase   = "https://jccocoydanyspnorhvth.supabase.co",  // Replace with your Supabase URL
    ApiKey    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjY29jb3lkYW55c3Bub3JodnRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwODQ5OTAsImV4cCI6MjA3NjY2MDk5MH0.JfCmZH-09gU0akekWR7eC0-xRKxqDo_NnDzalGnJQkA",                 // Replace with your Supabase anon key
    // ==== SOURCE SETTINGS ====
    ResourcePath = "rest/v1/inventory_items",
    PageSize     = 1000,
    
    // Build authentication headers
    AuthHeaders = [
        #"apikey" = ApiKey,
        #"Authorization" = "Bearer " & ApiKey,
        #"Content-Type" = "application/json"
    ],
    
    // Fetch a page of data
    // Uses cursor-based pagination on inventory_id for reliable iteration
    GetPage = (optional lastKey as nullable text) as table =>
        let
            // Build query parameters
            QueryBase = [
                // Select all columns from inventory_items table
                select = "inventory_id,sku,status,location,width_inches,length_inches,height_inches,color,material,price,cost,created_at,updated_at,is_available,vendor_name,model,synced_at",
                // Order by inventory_id ascending for consistent pagination
                order  = "inventory_id.asc",
                // Limit per page
                limit  = Text.From(PageSize)
            ],
            // Add cursor filter if we have a last key (for pagination)
            QueryRec = if lastKey = null or lastKey = "" 
                       then QueryBase 
                       else Record.AddField(QueryBase, "inventory_id", "gt." & lastKey),
            
            // Make HTTP request to Supabase REST API
            Response = Json.Document(
                Web.Contents(
                    ApiBase,
                    [
                        RelativePath = ResourcePath,
                        Query        = QueryRec,
                        Headers      = AuthHeaders,
                        Timeout      = #duration(0, 0, 60, 0)
                    ]
                )
            ),
            
            // Convert JSON array to table
            AsTable = Table.FromList(Response, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
            
            // Expand records into columns
            Expanded = if Table.RowCount(AsTable) = 0 
                       then AsTable 
                       else Table.ExpandRecordColumn(
                           AsTable, 
                           "Column1", 
                           Record.FieldNames(AsTable{0}[Column1]), 
                           Record.FieldNames(AsTable{0}[Column1])
                       )
        in
            Expanded,
    
    // Fetch first page
    FirstPage = GetPage(null),
    
    // Generate subsequent pages using cursor-based pagination
    // Continues until no more records are returned
    Pages =
        if Table.RowCount(FirstPage) = 0 then { FirstPage } else
        List.Generate(
            // Initial state
            () => [ 
                acc = FirstPage,
                last = if Table.RowCount(FirstPage) = 0 
                       then null
                       else Text.From(FirstPage{Table.RowCount(FirstPage)-1}[inventory_id])
            ],
            // Continue while we have records
            each Table.RowCount([acc]) > 0,
            // Get next page using last inventory_id as cursor
            each [
                nextPage = GetPage([last]),
                acc = nextPage,
                last = if Table.RowCount(nextPage) = 0
                       then [last]  // Keep same cursor if no results
                       else Text.From(nextPage{Table.RowCount(nextPage)-1}[inventory_id])
            ],
            // Return accumulated page
            each [acc]
        ),
    
    // Combine all pages into single table
    Combined = Table.Combine(Pages),
    
    // Data type transformations for better Power BI analysis
    // Convert numeric columns to appropriate types
    TypedTable = Table.TransformColumnTypes(
        Combined,
        {
            {"inventory_id", type text},
            {"sku", type text},
            {"status", type text},
            {"location", type text},
            {"width_inches", Int64.Type},
            {"length_inches", Int64.Type},
            {"height_inches", Int64.Type},
            {"color", type text},
            {"material", type text},
            {"price", type number},
            {"cost", type number},
            {"created_at", type datetimezone},
            {"updated_at", type datetimezone},
            {"is_available", type logical},
            {"vendor_name", type text},
            {"model", type text},
            {"synced_at", type datetimezone}
        },
        "en-US"
    ),
    
    // Optional: Remove synced_at column if not needed for analysis
    // Uncomment the line below to exclude it
    // Result = Table.RemoveColumns(TypedTable, {"synced_at"}),
    
    // Safety: De-duplicate by inventory_id in case of any overlaps
    Result = Table.Distinct(TypedTable, {"inventory_id"})
    
in
    Result

