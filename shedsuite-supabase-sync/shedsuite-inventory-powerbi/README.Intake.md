# Intake Form

- **Client Name**: Bailey Graham

## Project Overview
This project delivers a dedicated backend service that retrieves and consolidates inventory data from Shed Suite’s Inventory API and pushes it into a Power BI push dataset on a scheduled cadence. It runs as an Express.js service on Railway with hourly cron, handling large datasets, pagination, retries, and incremental updates via watermarks. It also exposes an HTTP endpoint for on-demand runs.

Reference: ShedSuite Inventory API docs: https://app.shedsuite.com/api/docs/index.html#/Inventory/get_inventory_v1__id_

## Access to the Inventory API
- **API Key / Token** (store as environment variable; do not commit secrets)
  - Name: SM Dealer Support Token
  - Token ID: 3a802369-9ac2-4bf3-a5e5-5c31d11877b8
  - UserID: 14660
  - Token (must be saved by us): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjNhODAyMzY5LTlhYzItNGJmMy1hNWU1LTVjMzFkMTE4NzdiOCIsImNvbXBhbnlfaWQiOjIzLCJ1c2VyX2lkIjoxNDY2MCwic2NvcGVzIjpbImFwaTp3cml0ZSIsImFwaTpyZWFkIl0sInJvbGUiOiJzaGVkc3VpdGVfb2ZmaWNlX2FkbWluIiwiaWF0IjoxNzM2MjYwOTYzfQ.WB1SMX79viT7d_kfUDwos3fYRFpLqqzVldGGSKFrx9o
- **Base URL / Paths**
  - baseURL: https://app.shedsuite.com/
  - publicApiUrlPath: api/public

## Power BI Access
- Tenant ID, Client ID, Client Secret (service principal)
- Workspace (Group) ID
- Dataset: create or reuse; recommended name: `ShedSuite_Inventory`; table: `InventoryItems`

## Additional Accounts
- Railway.app (deployment)

## Project Setup
- Build on Railway under our account; transfer to StorMor after acceptance.

## Scope: Inventory → Power BI Integration
1) **Data Extraction & Consolidation**
- Implement an Express service to retrieve Inventory data, paginate, watermark, transform, and push rows to Power BI.
- Acceptance: consolidated dataset, no duplicates, incremental updates, successful row pushes.
- Requirements: Shed Suite token; Power BI workspace/service principal; environment variables in Railway.
- Estimated Hours: 12–18 hours

2) **Automated Scheduling & Updates**
- Hourly Railway Cron triggers; manual `/sync/inventory` endpoint.
- Acceptance: cron runs succeed; retries/backoff; clear logs/metrics.
- Requirements: Railway cron; documented schedule and batch adjustments.
- Estimated Hours: 4–6 hours

## Nonfunctional
- Communication: weekly update; optional technical meetings.
- Security: secrets in Railway variables; avoid PII in logs.
- Reliability: retry/backoff; efficient batching.
- Maintainability: runbook, env sample, clear mappings.
- Availability: subject to Railway and Shed Suite SLA.

## Estimates
- Functional: 16–24 hours
- Nonfunctional: 3–6 hours
- Rate: $75/hour
- Total: ~$1,425 – $2,250

## Next Steps
- Provide Power BI IDs/credentials; confirm schedule; share Railway transfer email.
