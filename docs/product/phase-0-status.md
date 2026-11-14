# Phase 0 status

Last updated 2026-11-14. Tracks the Phase 0 task list in [AGENTS.md §11](../../AGENTS.md) and the phase gate in the [implementation plan](implementation-plan.md#phase-0--foundations-dec-2026--jan-2027-about-8-weeks-including-holidays).

## Engineering tasks

| #   | Task                                                       | State | Where                                                                                                                        |
| --- | ---------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | ADR-0001 ORM                                               | Done  | Prisma ([ADR-0001](../architecture/adr/0001-orm-and-data-access.md))                                                         |
| 2   | Database, `withTenant`, migrations, outbox/audit, RLS      | Done  | `src/common/database`, `prisma/migrations`, `test/integration/database`                                                      |
| 3   | Config validation for every env var                        | Done  | `src/config/env.ts`                                                                                                          |
| 4   | Error envelope, request ids, masked logs, OTel, Sentry     | Done  | `src/common/{errors,http,observability}`, `src/instrument.ts`, [ADR-0006](../architecture/adr/0006-api-response-envelope.md) |
| 5   | Identity: OTP, sessions, refresh rotation, TOTP, `/me`     | Done  | `src/modules/identity`, [ADR-0007](../architecture/adr/0007-sessions-and-refresh-families.md)                                |
| 6   | Authz: role tables, `@Can`, `/v1/me/permissions`           | Done  | `src/modules/authz`                                                                                                          |
| 7   | Tenancy core: estates, memberships, settings, entitlements | Done  | `src/modules/tenancy`                                                                                                        |
| 8   | Outbox relay, BullMQ queues, audit consumer                | Done  | `src/common/outbox`, `src/common/queues`, `src/modules/audit`                                                                |
| 9   | Notifications core: Expo push, Zoho SMTP, SMS, in-app      | Done  | `src/modules/notifications`, `src/integrations`                                                                              |
| 10  | File service: signed URLs, scan stub, EXIF strip           | Done  | `src/modules/files`                                                                                                          |
| 11  | Feature flags, `GET /v1/public/app-config`                 | Done  | `src/modules/platform`                                                                                                       |
| 12  | OpenAPI → contracts → api-client, CI drift check           | Done  | `pnpm --filter @safezone/backend-api openapi`                                                                                |
| 13  | App shells: phone/OTP sign-in and authenticated home       | Done  | `SessionController` (`packages/auth`), `SignInFlow` (`web-ui`, `mobile-ui`), all six apps                                    |
| 14  | Isolation suite in CI                                      | Done  | `apps/backend-api/test/isolation`                                                                                            |

## Known gaps carried into Phase 1

- Malware scanning is a stub (EICAR only); pick a real engine (ADR) before resident uploads go live.
- Security App signs in supervisors with phone + OTP + MFA; gate-device registration and guard PINs come with the security module.
- Monthly partitioning (audit, gate events, notifications) needs its own ADR before gate events ship.
- No Redis cache for role assignments yet (evaluated per request).
- Local `minio/minio` image is no longer published; replace the storage service in `infrastructure/docker/docker-compose.yml`.
- Playwright and Maestro flows for the sign-in shells are not written yet (AGENTS.md §8).
- ADR-0002 (hosting region), ADR-0003 (SMS provider) and ADR-0004 (package build strategy) are still to write.

## Phase gate (not engineering work)

The plan's gate also needs: an architecture review, prototypes of the gate, SOS and visitor flows validated with at least 5 guards and 10 residents, PRD v0.3, pilot letters of intent, and the legal items (DPIA started, DPO appointed, DPA template, terms and privacy drafts, payment-flow sign-off). These are owned by the product, design and legal leads.
