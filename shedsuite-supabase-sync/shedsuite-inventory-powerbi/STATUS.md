### ShedSuite Inventory Export – Status Report

#### Overview
We stood up a segregated service under `services/shedsuite-inventory-powerbi` to extract Inventory from ShedSuite’s new public API, validate the response/shape against the attached Postman collections, and produce a CSV suitable for downstream ingestion. We also scaffolded a Supabase-backed sync path (upsert into a Postgres table) and are preparing to turn the one-off export into a scheduled sync service.

#### Non‑technical summary (for business stakeholders)
- What we did
  - Built a small, dedicated tool that pulls your ShedSuite Inventory and saves it to a spreadsheet (CSV). We successfully exported the full inventory (~10k rows) from production.
  - Set up the database in Supabase and drafted a sync process that will load this same inventory into the database on a schedule (so it stays up to date automatically).
- Why it matters
  - You now have a reliable way to get a clean, complete inventory data export for analysis and reporting.
  - The upcoming sync will remove manual steps by refreshing the data on a schedule.
- What’s next
  - Connect the tool to the Supabase database and run the first end‑to‑end sync.
  - Turn on a scheduled job (hourly/daily) so data keeps current.
- What we need from you
  - Confirm desired refresh schedule (hourly vs daily).
  - Provide/confirm the Supabase connection string (if not already shared) and any field preferences (extra columns you want in the report).
- Timing (estimate)
  - Finish Supabase sync and validation: 0.5–1 day
  - Turn on scheduler and monitor first 24h: 0.5 day

#### Work completed
- Inventory API verification
  - Confirmed working endpoint via curl: `https://app.shedsuite.com/api/public/inventory/v1` with `limit`, `offset`, `sortBy=dateBuilt`, `sortOrder=desc`, `hideDeleted=false`.
  - Auth confirmed: `Authorization: Bearer <Public API Token>` (x-api-key optional but not required for this tenant).

- Service foundation
  - Express service scaffold with `/health` and `/sync/inventory` routes (currently focused on extraction; sync path updated for Supabase).
  - Config loader supports environment variables and Postman collection fallback for `baseURL`, `publicApiUrlPath`, and token (`src/config/index.js`, `src/config/postman.js`).
  - Structured logging (pino) to stderr for pipeline visibility.

- Inventory client and mapping
  - ShedSuite client aligned to Postman: `limit`/`offset` pagination; optional `updated_since` when applicable.
  - Robust array extraction for payload key `inventory` (with fallbacks to `data/items/records/results/rows`).
  - Mapping tailored to Inventory fields (examples):
    - id → `inventoryId`
    - serialNumber → `sku`
    - orderStatusDetailed → `status`
    - locatedAtDealerName / locatedAtShopName → `location`
    - buildingWidth/buildingLength (feet) → inches (`widthInches`/`lengthInches`)
    - sidingColor/roofColor → `color`; sidingCategory/roofCategory → `material`
    - dateBuilt → `createdAt`

- CSV export (Step 1 goal)
  - Streaming CSV export implemented; defaults to stdout (no file flags required).
  - Successfully exported full inventory to CSV.
    - Example output location during testing: `services/shedsuite-inventory-powerbi/exports/inventory_full.csv`.
    - Observed size during test: 10,007 lines (≈ 10,006 data rows plus header).

- Supabase sync foundation (Step 2, drafted)
  - Created Postgres client for Supabase (`src/db/postgres.js`).
  - Table ensure/DDL: `inventory_items` with `inventory_id` primary key and typed columns (sku, status, location, width_inches, length_inches, price, cost, created_at, updated_at, etc.).
  - Upsert path implemented (batching, conflict on `inventory_id`).
  - Sync orchestrator (`src/jobs/syncInventory.js`) fetches paginated records, maps to rows, and upserts; maintains watermark state to support future incremental runs.

#### Current state
- CSV extraction: complete and validated against production Inventory endpoint.
- Supabase database: created (per client confirmation). Initial sync code is implemented and pending final credentials/connection test.
- Power BI: explicitly out of scope for this phase; to be handled as a separate script later.

#### How to reproduce the CSV export (no .env required)
Run from the service directory;

```bash
cd services/shedsuite-inventory-powerbi
STATE_STORE=memory \
SHEDSUITE_API_KEY="<Public API Token>" \
SHEDSUITE_USE_X_API_KEY=false \
SHEDSUITE_BASE_URL=https://app.shedsuite.com \
SHEDSUITE_PUBLIC_API_PATH=api/public \
INVENTORY_LIST_PATH=/api/public/inventory/v1 \
npm run --silent sync:csv > exports/inventory_full.csv
```

Optional: `LIMIT_PAGES=1` for a quick page-only run during validation.

#### Next steps
1) Supabase sync bring-up
   - Provide `DATABASE_URL` (Supabase Postgres URI) and run the sync CLI:
     ```bash
     cd services/shedsuite-inventory-powerbi
     STATE_STORE=supabase DATABASE_URL="postgresql://...supabase.co:5432/postgres?sslmode=require" \
     SHEDSUITE_API_KEY="<Public API Token>" \
     npm run sync
     ```
   - Verify: upsert into `inventory_items` completes; counts roughly match CSV row count; `created_at/updated_at` and key fields populated.

2) Incremental sync
   - Enable watermark-based runs by persisting `inventory_watermark` in the state store (already implemented). Confirm that subsequent runs process only new/changed items.

3) Scheduling and deployment
   - Railway service is scaffolded with a cron runner; configure hourly job to call the CLI sync.
   - Set Railway environment variables: `DATABASE_URL`, `SHEDSUITE_API_KEY`, `STATE_STORE=supabase`.

4) Observability & resilience
   - Add basic metrics (row counts, durations, pages fetched) to logs.
   - Ensure retry/backoff for 429/5xx (already in client), and alerting hooks (optional) for failed cron runs.

5) Documentation and handoff
   - Finalize `.env.sample` notes for Supabase connection.
   - Add runbook steps for rotating tokens and adjusting pagination limits if needed.

#### Risks & assumptions
- API token scope/expiration: requires rotation if revoked or expired.
- Schema drift: Inventory fields may evolve; mapping may require periodic updates.
- Rate limits: client implements retry/backoff; hourly cadence expected to be safe.

#### Acceptance criteria snapshot
- CSV export of current Inventory: done and reviewed.
- Initial DB sync: code in place; verify in staging Supabase with upsert counts ≈ CSV row counts.
- Scheduled job: configured in Railway and running hourly, with logs showing success metrics.


