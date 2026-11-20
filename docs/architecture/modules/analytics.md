# Module: Analytics and Reporting

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (core reports, product events), grows each phase · Owner: Backend · Apps: management-web, management-mobile, super-admin

## 1. Responsibility

Analytics turns operational data and events into **reports and dashboards**: estate-level operational and financial reports, platform-level business reports, product analytics events, and the success indicators defined in the product brief. It reads from other modules through events and read models; it never writes to their tables.

## 2. Capabilities

1. Estate dashboards (permission-aware widgets).
2. Estate reports: occupancy, resident registration, visitor and gate activity, security incidents, SOS response times, revenue, expenses, outstanding invoices, payment reconciliation, maintenance performance, facility utilisation, vendor performance, staff attendance, procurement expenditure, community engagement.
3. Platform reports: registered and active estates, user registrations, monthly active users, platform transaction volume, platform revenue (ads, marketplace commission), payment failures, vendor activity, active advertisers, advertising enquiries, campaign revenue, impressions, clicks, campaign performance, integration health, system performance.
4. Success indicators (brief §12): estates onboarded, active residents, onboarding completion rate, % visitors processed digitally, verification time, % dues collected digitally, reconciliation success, maintenance resolution time, SOS acknowledgement and response times, MAU, estate retention, marketplace volume, advertisers, ad revenue, impressions and CTR, uptime.
5. Exports (CSV, XLSX, PDF) and scheduled email reports (via Zoho SMTP).
6. Product analytics event pipeline from apps (privacy-safe).

## 3. Architecture

- **Read models**: projection tables updated by event consumers (e.g. `rm_gate_daily`, `rm_sos_metrics`, `rm_collections_monthly`, `rm_maintenance_sla`, `rm_community_daily`), per estate, in a separate `analytics` schema.
- **Today** (Phase 1-3): `GET /v1/estates/:estateId/reports/summary` computes live figures by calling each owning module's service inside one tenant transaction ([ADR-0021](../adr/0021-composition-modules-for-cross-module-reads.md)); projections replace those calls when reports outgrow live queries.
- **Heavy queries** run on the read replica.
- **Platform aggregates** computed nightly into `rm_platform_daily`.
- **Product events** from apps: `POST /v1/analytics/events` (batched, max 50 per call) → queue → stored in partitioned `product_events` (user id, estate id, app, version, event, properties without personal data) → optional export to a product analytics tool.
- Later (if needed): warehouse (e.g. BigQuery/ClickHouse) fed from the outbox.

## 4. Key metric definitions

| Metric                         | Definition                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| % visitors processed digitally | Gate entries with a pass or walk-in record ÷ all recorded entries (incl. manual "paper" entries logged by guards) |
| Verification time              | Scan/PIN submit → decision shown (device-measured)                                                                |
| SOS acknowledgement time       | `acknowledged_at − triggered_at` (real alerts only)                                                               |
| SOS resolution time            | `resolved_at − triggered_at`                                                                                      |
| % dues collected digitally     | Paid amount via online/virtual account ÷ total paid in period                                                     |
| Reconciliation success         | Auto-matched transactions ÷ all transactions                                                                      |
| Maintenance resolution time    | `resolved_at − submitted_at`, excluding paused time                                                               |
| Active resident                | User with an active membership who opened any app in the last 30 days                                             |
| Onboarding completion          | Residents with approved membership ÷ units with occupancy expected (estate estimate)                              |

## 5. Business rules

1. Estate users only see their estate's data; platform reports aggregate across estates with no resident personal data.
2. Small-number suppression on cross-estate and advertiser-facing figures (threshold configurable, default 200 users).
3. Drill SOS alerts are excluded from real SOS metrics.
4. Product events contain no names, phone numbers, message content or locations.

## 6. API

| Method | Path                                                      | Purpose                 |
| ------ | --------------------------------------------------------- | ----------------------- |
| GET    | `/v1/estates/:estateId/dashboard`                         | Widgets for the caller  |
| GET    | `/v1/estates/:estateId/reports/:report?from=&to=&format=` | Estate report           |
| POST   | `/v1/estates/:estateId/report-schedules`                  | Scheduled email reports |
| GET    | `/v1/platform/reports/:report`                            | Platform report         |
| GET    | `/v1/platform/kpis`                                       | Success indicators      |
| POST   | `/v1/analytics/events`                                    | Product events          |

## 7. Jobs

`analytics.projections.*` (event consumers), `analytics.platform.nightly`, `analytics.reports.scheduled`, `analytics.events.purge` (product events kept 13 months).

## 8. Acceptance criteria

- The estate dashboard loads in < 1.5 s for a 2,000-unit estate.
- Report figures match source data in automated reconciliation tests (e.g. collections report total = ledger cash receipts for the period).
- No platform or advertiser report exposes a figure below the suppression threshold.
