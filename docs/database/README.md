# Database

PostgreSQL 17, one database, schemas per concern. Data model per module lives in each [module doc](../architecture/modules/).

## Conventions

- Primary keys: UUIDv7. Tables and columns: `snake_case`.
- Every tenant table: `estate_id uuid not null`, an index on it, and a row-level security policy:
  `USING (estate_id = current_setting('app.estate_id')::uuid)`.
- Each tenant request/job runs in a transaction that starts with `SET LOCAL app.estate_id` and `SET LOCAL app.user_id`.
- The application role cannot bypass RLS. Platform (cross-tenant) access uses a separate role and code path.
- Money: `bigint` kobo + `currency`. Times: `timestamptz` (UTC).
- Append-only tables (no UPDATE/DELETE grants): `audit_events`, `ledger_entries`, `gate_events`, `sos_events`.
- High-volume tables partitioned by month: gate events, messages, notifications, ad events, device events, product events.
- Migrations: expand → migrate → contract; always backward compatible with the running version.

## Schemas (proposed)

| Schema      | Holds                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| `platform`  | users, sessions, roles, plans, vendors, advertisers, campaigns, feature flags |
| `tenant`    | everything with `estate_id`                                                   |
| `analytics` | read models                                                                   |
| `audit`     | audit events                                                                  |

## To document here

- ADR-0001 outcome and how to write a migration.
- RLS test harness usage.
- Retention schedule per table (agreed with the DPO).
