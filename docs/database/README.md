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

## Roles

| Role                                         | Used by                  | Can                                             |
| -------------------------------------------- | ------------------------ | ----------------------------------------------- |
| Owner (`safezone` locally, `safezone_owner`) | Migration job only       | Owns schemas and tables                         |
| `safezone_app`                               | API, worker, realtime    | DML granted per table; `NOBYPASSRLS`            |
| Platform role                                | `/v1/platform/*` (later) | Cross-tenant access with audit (Phase 0 task 7) |

## How to

- ORM decision: [ADR-0001](../architecture/adr/0001-orm-and-data-access.md) (Prisma). Conventions and writing a migration: [prisma-conventions.md](prisma-conventions.md).
- RLS details: [tenant-isolation.md](tenant-isolation.md).
- RLS test harness: `apps/backend-api/test/integration/support/database.ts` starts Postgres 17 (Testcontainers), applies the migrations as the owner and returns an `app` client connected as `safezone_app`. Run with `pnpm --filter @safezone/backend-api test:integration` (needs Docker).

## Still to document

- Retention schedule per table (agreed with the DPO).
