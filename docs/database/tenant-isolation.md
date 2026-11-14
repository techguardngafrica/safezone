# Tenant isolation and row-level security (RLS)

Safezone enforces multi-tenancy in two layers ([ADR-0001](../architecture/adr/0001-orm-and-data-access.md)).

1. **Application layer.** Every authenticated request resolves a tenant context (`userId`, `estateId`, roles) from verified database memberships. A client-supplied `x-estate-id` header is only a selector hint and is always checked against the user's memberships.
2. **Database layer.**
   - Estate-owned tables have `estate_id uuid not null`, an index on it, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and policies for `safezone_app` using
     `estate_id = nullif(current_setting('app.estate_id', true), '')::uuid`.
     With no estate set the expression is `NULL`, so queries see no rows (fail closed).
   - All tenant access goes through `DatabaseService.withTenant({ estateId, userId }, fn)`. It opens one transaction and runs
     `select set_config('app.estate_id', $1, true), set_config('app.user_id', $2, true)` first. The settings end with the transaction, so a pooled connection never carries them to the next request.
   - The runtime role `safezone_app` is `NOSUPERUSER NOBYPASSRLS`. Platform (cross-tenant) access gets its own role and code path with Phase 0 task 7.
   - The outbox relay uses `withOutboxRelay(fn)`, which sets `app.context = 'outbox_relay'`; only that context can read or update `platform.outbox_events`.

The integration suite (`pnpm --filter @safezone/backend-api test:integration`) fails if any table in `platform`, `tenant` or `audit` lacks enabled and forced RLS.
