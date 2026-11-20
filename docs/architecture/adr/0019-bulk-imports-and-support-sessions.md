# ADR-0019: Bulk Import Jobs and Support-Access Consent Tables

- **Date**: 2026-11-20
- **Status**: Accepted
- **Scope**: `apps/backend-api`, `apps/management-web`

## Context

Phase 1 of `apps/management-web` (`docs/architecture/apps/management-web.md` §6.4 and §6.13) requires:

1. **Bulk CSV import** with a two-step dry-run validation → confirm workflow and persistent error/result reports.
2. **Support-access consent** where estate administrators review, approve (time-bounded), deny, or revoke Techguard support "view as" requests.

Neither `bulk_import_jobs` nor `support_sessions` existed in the Prisma schema.

## Decision

Add two tenant-scoped tables under the `tenant` schema, both protected by PostgreSQL Row-Level Security (`estate_id = current_setting('app.estate_id')`):

- `tenant.bulk_import_jobs`: stores uploaded CSV dry-run validation results (`total_rows`, `valid_rows`, `error_rows`, `errors_json`, validated `payload_json`) and tracks execution counts (`created_count`, `updated_count`) when confirmed. Imports are idempotent by unit code / plate / phone.
- `tenant.support_sessions`: tracks Techguard support access requests (`pending | approved | denied | revoked | expired`), estate admin decisions, and explicit expiry timestamps. Every decision emits an `audit_events` record via the transactional outbox.

## Consequences

- Zero breaking changes (purely additive migration).
- Both tables enforce RLS with `FORCE ROW LEVEL SECURITY` for `safezone_app` and forbid `DELETE` (append-only history).
