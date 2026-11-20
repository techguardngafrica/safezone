# ADR-0020: Import Execution, Support-Session Enforcement and Role-Grant Levels

- **Date**: 2026-11-21
- **Status**: Accepted (imports, support sessions); Proposed (role-grant rule, needs product confirmation)
- **Scope**: `apps/backend-api`, `apps/management-web`, `packages/permissions`, `packages/schemas`
- **Amends**: [ADR-0019](0019-bulk-imports-and-support-sessions.md)

## Context

A review of the Phase 1-3 management-web commit found that:

1. Confirming a bulk import of owners, residents, households, vehicles or opening balances marked the job `completed` and reported every row as created without writing anything. Units were written straight into `tenant.spaces` from the imports module (another module's table), confirm was not race-safe, and opening balances were parsed as floating-point naira.
2. Approved support sessions were recorded but never consulted, and the request endpoint sat under `/v1/platform/estates/:estateId/…`, where the authorization guard turns non-members away, so it could not be used.
3. Anyone with `role.assign` could create a custom role with any estate permission and grant it to anyone, including themselves.

## Decision

### Imports run in the worker through the owning modules

- Dry run validates and normalises rows (`modules/imports/domain/rows.ts`): Nigerian phone format, unit codes, kobo amounts with integer arithmetic, real future due dates, duplicate keys within a file. It also checks the permission the owning module requires for that kind (`units`/`owners`: `space.manage`; `residents`/`households`/`vehicles`: `resident.approve`; `opening_balances`: `billing.run.create`).
- Confirm moves the job from `dry_run` to `queued` with a conditional update (exactly one caller wins) and emits `imports.job.confirmed` in the same transaction. The outbox relay routes it to the `imports` queue.
- `ImportRunner` (worker) re-resolves the confirming user's access, so a revoked permission fails the job, then applies each row through `PropertyService.importUnit`, `OwnershipsService.importOwner`, `OccupancyService.importResident/importHousehold/importVehicle` and `InvoicesService.createOneOffIn`. A domain rejection becomes a row error and the rest of the file continues.
- Re-imports update rather than duplicate: units match by external reference, then unit code; owners by unit and phone; residents by household membership; households by unit and head; vehicles by plate. Opening balances have no natural key, so `tenant.bulk_import_keys` (owned by imports, unique per estate, kind and key) records each `(unit, external_ref)` in the same transaction as its invoice.
- Jobs record `unchanged_count` and `failed_count`. Validated rows (names, phones) are deleted from `payload_json` after the run, and from abandoned dry runs after 24 hours; a dry run older than a day cannot be confirmed.

### Support sessions are enforced in the authorization guard

- Agents request access with `POST /v1/platform/support-sessions` (`estateId` in the body; default 2 hours).
- A non-member holding `platform.support_access` reaches an estate route only while an approved, unexpired session exists. Only `GET`/`HEAD` requests are allowed, within `SUPPORT_SESSION_PERMISSIONS` (`audit.read`, `invoice.read`, `report.read`, `resident.read`, `visitor.log.read`; never `pii.view`). Every request writes an audited `platform.support_session.accessed` event carrying the session id.
- Due sessions are marked `expired` with an audited `platform.support_session.expired` event when sessions are checked or listed. Decisions use conditional updates, and agents cannot decide their own requests.

### Role grants cannot go above the granter's level (proposed)

authz.md §7.2 says a role may never be granted with more permissions than the granter holds. Applied literally it stops estate administrators from assigning built-in security, accountant or facility roles, because separation of duties keeps `gate.verify` and `billing.run.create` out of the administrator role. We therefore apply the rule to:

- custom roles (creating, editing, granting, revoking): every permission must be held by the caller;
- built-in management roles (those containing `role.assign` or `estate.configure`): same check;
- built-in operational roles: any `role.assign` holder may grant them, since their content is curated in `@safezone/permissions`.

In all cases nobody may change their own roles, resident roles are never granted from staff management, and estate roles may only carry permissions that some built-in estate role carries.

## Consequences

- Additive migration `20261121090000_import_execution_and_support_defaults` (new columns, a new RLS-protected insert-only table, a default change).
- Importing opening balances needs both `import.run` and `billing.run.create`. No built-in role has both, so an administrator also needs the accountant role, which preserves separation of duties.
- Each support-session request costs one outbox insert.
- The role-grant rule should be confirmed or changed by the product owner; if the literal §7.2 rule is preferred, administrators would need the operational permissions themselves.
