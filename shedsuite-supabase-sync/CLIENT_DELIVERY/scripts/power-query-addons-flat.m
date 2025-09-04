// Usage: Paste into Power BI Desktop Advanced Editor and set ApiBase and ApiKey
let
    // ==== CONFIG (edit these two) ====
    ApiBase   = "https://iinonvpsbylwhxnlcbmc.supabase.co",
    ApiKey    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpbm9udnBzYnlsd2h4bmxjYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMTgxNTYsImV4cCI6MjA2ODg5NDE1Nn0.eGUuyDtCMqrD06uOkFwvE5pmtPgZlov-quseuIFlWfU",
    // ==== SOURCE SETTINGS ====
    ResourcePath = "rest/v1/shedsuite_order_addons_flat",
    PageSize     = 1000,
    // Build headers once
    AuthHeaders = [
        #"apikey" = ApiKey,
        #"Authorization" = "Bearer " & ApiKey
    ],
    // Fetch a page; when lastKey is null, fetch first page
    GetPage = (optional lastKey as nullable text) as table =>
        let
            QueryBase = [
                select = "order_id,order_number,customer_name,status,date_ordered,total_amount_dollar_amount,addon_type,addon_name,addon_price,addon_quantity,addon_price_included",
                order  = "order_id.asc",
                limit  = Text.From(PageSize)
            ],
            QueryRec = if lastKey = null or lastKey = "" then QueryBase else Record.AddField(QueryBase, "order_id", "gt." & lastKey),
            Response = Json.Document(
                Web.Contents(
                    ApiBase,
                    [
                        RelativePath = ResourcePath,
                        Query        = QueryRec,
                        Headers      = AuthHeaders,
                        Timeout      = #duration(0,0,60,0)
                    ]
                )
            ),
            AsTable = Table.FromList(Response, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
            Expanded = if Table.RowCount(AsTable) = 0 then AsTable else
                Table.ExpandRecordColumn(AsTable, "Column1", Record.FieldNames(AsTable{0}[Column1]), Record.FieldNames(AsTable{0}[Column1]))
        in
            Expanded,
    // First page
    FirstPage = GetPage(null),
    // Generate subsequent pages using cursor on order_id
    Pages =
        if Table.RowCount(FirstPage) = 0 then { FirstPage } else
        List.Generate(
            () => [ acc = FirstPage,
                    last = Text.From(FirstPage{Table.RowCount(FirstPage)-1}[order_id]) ],
            each Table.RowCount([acc]) > 0,
            each [
                acc = GetPage([last]),
                last = if Table.RowCount([acc]) = 0
                       then [last]
                       else Text.From([acc]{Table.RowCount([acc])-1}[order_id])
            ],
            each [acc]
        ),
    Combined = Table.Combine(Pages),
    // Safety: de-duplicate by (order_id, addon_name, addon_type) in case of overlaps
    Result = if Table.HasColumns(Combined, {"order_id","addon_name","addon_type"})
             then Table.Distinct(Combined, {"order_id","addon_name","addon_type"})
             else Combined
in
    Result






