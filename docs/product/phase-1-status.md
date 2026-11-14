# Phase 1 status: Secure Estate MVP

> Started 14 Nov 2026. Scope: [implementation plan, Phase 1](implementation-plan.md). Goal: an estate can run its gate and SOS on Safezone with no paper visitor book.

## Progress

| Area                                                        | Backend | Apps | Notes                                                                                                                    |
| ----------------------------------------------------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| Self-service onboarding (apply, review, approve, reject)    | Done    | —    | [tenancy.md §15](../architecture/modules/tenancy.md), [ADR-0008](../architecture/adr/0008-estate-onboarding.md)          |
| Techguard-assisted onboarding (lead, create, invite)        | Done    | —    | Invitation links derived in the worker, never stored                                                                     |
| Estate lifecycle (suspend, reactivate, deactivate)          | Done    | —    | Suspension enforced in the authorization guard; safety actions keep working                                              |
| Setup wizard progress and activation                        | Done    | —    | `spaces` and `security_supervisor` verified; `gates` confirmed manually until the security module                        |
| Spaces tree (create, bulk pattern, re-parent, archive)      | Done    | —    | [property.md §10](../architecture/modules/property.md), [ADR-0009](../architecture/adr/0009-spaces-materialised-path.md) |
| Occupancy: residents, households, join requests             | —       | —    | Next                                                                                                                     |
| Visitor passes (one-time, recurring, multi, offline QR/PIN) | —       | —    |                                                                                                                          |
| Security: gates, guards, shifts, gate events, incidents     | —       | —    | Needs the partitioning ADR before gate events ship                                                                       |
| Emergency / SOS with escalation                             | —       | —    | Own `sos` worker pool; voice adapter                                                                                     |
| Announcements                                               | —       | —    |                                                                                                                          |
| Bulk imports (units, residents, vehicles)                   | —       | —    | Tenancy import framework                                                                                                 |
| Support access with audit trail                             | —       | —    |                                                                                                                          |
| Public visitor pass page, marketing and legal pages         | —       | —    |                                                                                                                          |
| WhatsApp and voice adapters                                 | —       | —    | SMS, push and email exist from Phase 0                                                                                   |

"Apps" covers super-admin review screens, the public-web `/register` and `/invite/:token` pages and the management-web setup wizard; none are built yet.

## Verification (14 Nov 2026)

- `pnpm build`, `typecheck`, `lint`, `test` and `format:check` pass across the repo.
- Backend: unit tests for every application and estate status transition, suspension rules, the duplicate check, join codes, placement rules and bulk planning; integration tests on real PostgreSQL 17 and Redis for both onboarding workflows, setup and activation, suspension, and the spaces tree. The isolation suite covers every new route.
- OpenAPI regenerated (76 operations) and stable.

## Open items

- Applicant email notices and "stale application" alerts to Techguard operations are not built (applicants are notified by push or SMS).
- `space_history` projection, imports and the estate join search are not built.
- The `< 100 ms` "all units in Block C" target is designed for (prefix index) but not load-tested.
- Carried from Phase 0: real malware scanner, partitioning ADR, ADRs 0002–0004, Playwright and Maestro flows, local storage image replacement.
