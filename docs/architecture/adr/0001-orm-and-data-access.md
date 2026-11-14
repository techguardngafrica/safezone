# ADR-0001: ORM and data access (Prisma)

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni (product/engineering owner)
- **Affects:** `apps/backend-api` (every module), `docs/database/`, CI (integration and isolation suites)

## Context

Every tenant table is protected by PostgreSQL row-level security (AGENTS.md §5.2, [database README](../../database/README.md)). That puts four hard requirements on the data-access layer:

1. **Per-transaction tenant context.** Each tenant request or job runs in one transaction that first sets `app.estate_id` and `app.user_id` with transaction scope (`SET LOCAL` semantics), so the setting can never leak to the next borrower of a pooled connection.
2. **Raw SQL as a first-class citizen.** RLS policies, `FORCE ROW LEVEL SECURITY`, role grants (append-only tables get `INSERT`/`SELECT` only), partial indexes, the `spaces` path tree and, later, PostGIS columns all live in SQL.
3. **Reviewable migrations** that we can write as expand → migrate → contract and run as a pre-deploy job with a privileged owner role, while the application connects with a role that cannot bypass RLS.
4. **Testability on real Postgres** (Testcontainers) with RLS on, in Vitest, inside the pnpm/Turborepo monorepo.

## Options considered

| Option               | Pros                                                                                                                                                          | Cons                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Prisma**        | Mature tooling and docs, familiar to most hires. Declarative schema, `prisma migrate` writes reviewable SQL, typed client, Prisma Studio for local debugging. | Policies, grants and `FORCE RLS` cannot be expressed in `schema.prisma`; they live in hand-edited migration SQL. Tenant context needs an interactive transaction per request. Generated client needs a build step. |
| B. Drizzle ORM       | SQL-first, schema in TypeScript, no codegen step, thin runtime.                                                                                               | Pre-1.0 with breaking minor releases; fewer guard rails; less familiar to the team.                                                                                                                                |
| C. Kysely / raw `pg` | Full control, very thin.                                                                                                                                      | No schema-as-code or migration generation. Not in the AGENTS.md stack.                                                                                                                                             |

## Decision

Use **Prisma** (Prisma ORM 7, `prisma-client` generator) over the **`@prisma/adapter-pg` driver adapter** (node-postgres), with `prisma migrate` for migrations. All tenant data access goes through one helper, `withTenant(estateId, userId, fn)`, which opens an interactive transaction and sets the context with `set_config(..., true)` (transaction-scoped, the parameterisable form of `SET LOCAL`) before running `fn`. Repositories receive the transaction client; nothing tenant-scoped uses the base client.

## Details

- **Roles:**
  - The **owner** (local: `safezone`; production: `safezone_owner`) owns schemas and tables and is used only by the migration job (`DATABASE_MIGRATION_URL`).
  - **`safezone_app`** is created by the first migration as `NOLOGIN NOSUPERUSER NOBYPASSRLS`. Each environment enables login and sets its password out of band (vault/Terraform; locally `pnpm --filter @safezone/backend-api db:app-role`), so no password ever sits in a migration. API, worker and realtime connect as this role (`DATABASE_URL`).
  - Every migration grants `safezone_app` exactly what it needs, table by table. Append-only tables get `INSERT, SELECT` only.
  - A platform role for `/v1/platform/*` is added with the platform work (Phase 0 task 7).
- **Policies** use `estate_id = nullif(current_setting('app.estate_id', true), '')::uuid`. With no tenant set the expression is `NULL` and the query sees no rows (fail closed). Every tenant table also gets `FORCE ROW LEVEL SECURITY`.
- **Setting names:** `app.estate_id` and `app.user_id`, as in AGENTS.md (replaces `app.current_estate_id` in older docs).
- **Postgres schemas:** `platform`, `tenant`, `audit` (Prisma `schemas` in the datasource). Tables map to `snake_case` with `@@map`/`@map`.
- **IDs:** UUIDv7 generated by the client (`@default(uuid(7))`); Postgres 17 has no native `uuidv7()`.
- **Migrations:** `prisma migrate dev --create-only` generates the SQL, then we append policies and grants to the same file before applying. `prisma migrate deploy` runs as the pre-deploy job. Never edit a migration after it reaches a shared environment.
- **Tests:** an RLS harness starts Postgres 17 with Testcontainers, applies the real migrations as the owner and connects as `safezone_app`, so tests exercise the production policies.

## Consequences

- Runtime dependencies in `backend-api`: `@prisma/client`, `@prisma/adapter-pg`, `pg`. Dev: `prisma`, `@testcontainers/postgresql`. Versions pinned exactly.
- `prisma generate` runs before `build`, `typecheck`, `lint` and `test` in `backend-api`; the generated client lives in `src/generated/prisma` and is gitignored.
- Integration tests need a Docker daemon locally and in CI; they run as `pnpm test:integration`.
- **Monthly partitioning** (audit, gate events, messages, notifications, ad events): Prisma's drift detection treats partition child tables as unknown tables. Partitioning is therefore deferred to a follow-up ADR before the first high-volume table ships (Phase 1 gate events at the latest). Tables are designed so the switch is a copy migration while volumes are small.
- If Prisma becomes a blocker, migrations are plain SQL and data access sits behind module repositories, so a move is contained.
