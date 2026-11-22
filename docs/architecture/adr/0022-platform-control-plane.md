# ADR-0022: Platform control plane tables and cross-tenant reads

- **Status:** Accepted
- **Date:** 2026-11-21
- **Context:** Building the Super Admin Portal (`apps/super-admin`) per `docs/architecture/apps/super-admin.md` and `docs/architecture/modules/platform.md`.

## Context

Most Super Admin workflows (estate onboarding, applications, leads, invitations, estate lifecycle, feature flags, app versions, support sessions, user accounts, platform staff, payments, audit log) already have underlying tables in PostgreSQL. Two control-plane areas specified in `platform.md` do not have tables yet:

1. **Support tickets** (`support_tickets`, `support_ticket_messages`) for tracking customer/estate issues with SLA due dates.
2. **Compliance records** (`data_subject_requests`, `breach_log`, `retention_rules`) for NDPA 2023 / GAID 2025 operational tracking (30-day DSR clock, 72-hour NDPC breach notification window, retention schedule).

In addition, `tenant.support_sessions` currently has only a tenant RLS policy (`app.estate_id`), which prevents platform support agents from listing their own and other estates' support sessions across the platform.

## Decision

1. Add `support_tickets`, `support_ticket_messages`, `data_subject_requests`, `breach_log`, and `retention_rules` in the `platform` schema, protected by forced RLS admitting `current_setting('app.context', true) = 'platform_config'`.
2. Add a read-only RLS policy on `tenant.support_sessions` (`FOR SELECT`) admitting `current_setting('app.context', true) = 'platform_config'` so `GET /v1/platform/support-sessions` can list sessions across estates without widening write access.
3. Keep strict module ownership (`AGENTS.md §5.1`):
   - Platform user lookup and account recovery actions live in `identity` (`withContext('identity', ...)`), returning estate membership names only (never tenant data).
   - Platform staff role grants live in `authz` (`withContext('authz', ...)`), restricted to `level === 'platform'` roles and guarding against removing the last `super_admin`. Only currently valid assignments count, and Super Admin revocations are serialized with a transaction-scoped advisory lock so two concurrent revokes cannot remove the last one.
   - Accounts that hold any platform role can be locked, signed out or have MFA reset only by a holder of `platform.staff.manage`; `platform.user.manage` alone covers non-staff users. Lock moves `active` to `locked` and unlock moves `locked` to `active` only, so a `deactivated` account is never reactivated.
   - Cross-estate transaction monitoring lives in `payments` under a dedicated read-only `platform_finance` DB context (`withContext('platform_finance', ...)`), admitted by a `FOR SELECT` policy on `tenant.payment_transactions` (migration `20261122090000_platform_finance_read`). It returns payment metadata without resident PII, and the derived status filter runs in SQL before paging.
   - Platform-wide audit reads live in `audit` (`withContext('audit', ...)`).
   - Plans and per-estate entitlement overrides live in `tenancy` (`withContext('tenancy', ...)`).
   - Overview KPIs compose exported read methods from `tenancy`, `identity`, and `platform`.
4. Provider configuration remains read-only in the UI (derived from runtime environment/adapters) so secrets never enter PostgreSQL.

## Consequences

- Every `/v1/platform/*` route requires an explicit `@Can('platform.*')` permission and TOTP MFA (enforced by `requiresMfa()` for all platform roles).
- No platform user can read estate personal data outside an approved support session or compliance task.
- All mutations (ticket updates and messages, DSR/breach changes, user locks, MFA resets, platform role grants, entitlement updates) emit append-only audit events via the transactional outbox.
