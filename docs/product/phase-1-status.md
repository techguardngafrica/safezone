# Phase 1 status: Secure Estate MVP

> Started 14 Nov 2026. Scope: [implementation plan, Phase 1](implementation-plan.md). Goal: an estate can run its gate and SOS on Safezone with no paper visitor book.

## Progress

Phase 1 is **not complete**. Backend status by area (no Phase 1 screens are built yet):

| Area                                                                                                                                                | Backend     | Notes                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Self-service and assisted onboarding, lifecycle, setup                                                                                              | Done        | [ADR-0008](../architecture/adr/0008-estate-onboarding.md); all four setup checks are now verified                     |
| Spaces tree                                                                                                                                         | Done        | [ADR-0009](../architecture/adr/0009-spaces-materialised-path.md)                                                      |
| Occupancy: join requests, households, vehicles, staff, contacts                                                                                     | Done        | [ADR-0011](../architecture/adr/0011-occupancy-and-sos-implementation.md); owner approval waits for Phase 2 ownerships |
| Visitor passes, gate verify/events, offline sync, walk-ins                                                                                          | Done        | [ADR-0010](../architecture/adr/0010-visitor-pass-credentials.md)                                                      |
| Gates                                                                                                                                               | Done        | Part of security                                                                                                      |
| SOS with escalation, drills, broadcasts                                                                                                             | Done (core) | Voice calls, realtime emits and SMS-triggered SOS not built                                                           |
| Official announcements                                                                                                                              | Done (core) | No scheduling or attachments                                                                                          |
| Security personnel, shifts, kiosk PIN sign-in, incidents                                                                                            | Not started | Needed for on-shift SOS targeting and the Security App                                                                |
| Bulk imports (units, residents, vehicles)                                                                                                           | Not started |                                                                                                                       |
| Support access with audit trail                                                                                                                     | Not started |                                                                                                                       |
| WhatsApp and voice adapters, realtime gateway emits                                                                                                 | Not started |                                                                                                                       |
| Apps: super-admin review, public-web register/invite/pass pages and legal pages, management-web setup and consoles, resident and security app flows | Not started | Only the Phase 0 sign-in shells exist                                                                                 |
| Playwright and Maestro flows                                                                                                                        | Not started |                                                                                                                       |

## Verification (14 Nov 2026)

- `pnpm build`, `typecheck`, `lint` (zero warnings), `test` and `format:check` pass across the repo.
- Backend: 147 unit tests (every status machine transition and rejection, join routing, pass token signing and tampering, validity windows in WAT, SOS escalation rules) and 76 integration tests on real PostgreSQL 17 and Redis across 14 files, including the isolation suite for every route and the migration drift check.
- OpenAPI regenerated: 141 operations, stable.
- Not verified: performance targets (verify p95 < 300 ms, SOS trigger to first guard < 5 s at p95 on 4G, 10 verifications per second per gate), real SMS/push providers, and any device or browser flow.

## Open items

- Applicant email notices and "stale application" alerts to Techguard operations are not built (applicants are notified by push or SMS).
- `space_history` projection, imports and the estate join search are not built.
- The `< 100 ms` "all units in Block C" target is designed for (prefix index) but not load-tested.
- Carried from Phase 0: real malware scanner, partitioning ADR, ADRs 0002–0004, Playwright and Maestro flows, local storage image replacement.
