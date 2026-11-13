# Backend API (`apps/backend-api`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for engineering review · Owner: Tech lead

## 1. Purpose

`apps/backend-api` is the single backend for every Safezone surface: Resident App, Estate Management App (web and mobile), Security App, Super Admin Portal and Public Web. It owns all business rules, authorisation, tenant isolation, data storage, integrations and audit. No client app holds business logic that the API does not also enforce.

It is a **NestJS modular monolith** built from one codebase into **three processes**:

| Process  | Entry point       | Role                                                                                                                    | Scales on          |
| -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------ |
| API      | `src/main.ts`     | REST API (OpenAPI 3.1), auth, all synchronous requests                                                                  | CPU / request rate |
| Worker   | `src/worker.ts`   | BullMQ processors: notifications, SOS fan-out, billing runs, reconciliation, imports, exports, ad rollups, outbox relay | Queue depth        |
| Realtime | `src/realtime.ts` | Socket.IO gateway (Redis adapter) for SOS, gate events, chat, live dashboards                                           | Open connections   |

All three share the same modules, database and configuration; they are deployed and scaled separately.

## 2. Responsibilities

- Expose versioned REST APIs for all client apps.
- Authenticate users (phone + OTP, optional password, MFA) and devices.
- Authorise every request against scoped role assignments.
- Enforce tenant (estate) isolation at application and database level.
- Run domain workflows (visitors, SOS, billing, maintenance, community, marketplace, ads, etc.).
- Integrate with external providers through adapters.
- Emit domain events through a transactional outbox.
- Record an append-only audit trail of important actions.
- Push realtime updates to connected clients.

## 3. Tech stack

| Concern                             | Choice                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Runtime                             | Node.js LTS, TypeScript (strict)                                                                                 |
| Framework                           | NestJS                                                                                                           |
| Database                            | PostgreSQL (managed, with read replica), row-level security                                                      |
| ORM / query                         | Prisma or Drizzle (decide in Phase 0 ADR; must support `SET LOCAL` per transaction and raw SQL for RLS policies) |
| Cache, rate limits, queues, pub/sub | Redis                                                                                                            |
| Jobs                                | BullMQ                                                                                                           |
| Realtime                            | Socket.IO with `@socket.io/redis-adapter`                                                                        |
| Validation                          | Zod schemas shared from `packages/schemas` (via `nestjs-zod`)                                                    |
| API spec                            | OpenAPI 3.1 generated from code, published to `packages/contracts`                                               |
| Object storage                      | S3-compatible bucket, signed URLs                                                                                |
| Email                               | Zoho SMTP                                                                                                        |
| Push                                | Expo Notifications (Expo push service delivers to FCM and APNs)                                                  |
| Observability                       | OpenTelemetry, Sentry, Grafana stack                                                                             |
| Tests                               | Jest/Vitest, Testcontainers (real PostgreSQL and Redis), Supertest                                               |

## 4. Module map

Each module owns its tables and exposes services only through its public interface (`<module>.service.ts` exports). A module never queries another module's tables directly.

| Module                            | Doc                                             | Phase               |
| --------------------------------- | ----------------------------------------------- | ------------------- |
| identity                          | [identity.md](../modules/identity.md)           | 0                   |
| authz                             | [authz.md](../modules/authz.md)                 | 0                   |
| tenancy (incl. estate onboarding) | [tenancy.md](../modules/tenancy.md)             | 0–1                 |
| property                          | [property.md](../modules/property.md)           | 1                   |
| occupancy                         | [occupancy.md](../modules/occupancy.md)         | 1                   |
| visitor                           | [visitor.md](../modules/visitor.md)             | 1                   |
| security                          | [security.md](../modules/security.md)           | 1                   |
| emergency                         | [emergency.md](../modules/emergency.md)         | 1                   |
| notifications                     | [notifications.md](../modules/notifications.md) | 0–1                 |
| audit                             | [audit.md](../modules/audit.md)                 | 0                   |
| platform                          | [platform.md](../modules/platform.md)           | 0–1                 |
| billing                           | [billing.md](../modules/billing.md)             | 2                   |
| payments                          | [payments.md](../modules/payments.md)           | 2                   |
| utilities                         | [utilities.md](../modules/utilities.md)         | 2                   |
| maintenance                       | [maintenance.md](../modules/maintenance.md)     | 2                   |
| community                         | [community.md](../modules/community.md)         | 3                   |
| facilities                        | [facilities.md](../modules/facilities.md)       | 3                   |
| documents                         | [documents.md](../modules/documents.md)         | 3                   |
| governance                        | [governance.md](../modules/governance.md)       | 3 (polls), 5 (full) |
| marketplace                       | [marketplace.md](../modules/marketplace.md)     | 4                   |
| advertising                       | [advertising.md](../modules/advertising.md)     | 4                   |
| procurement                       | [procurement.md](../modules/procurement.md)     | 5                   |
| workforce                         | [workforce.md](../modules/workforce.md)         | 1 (shifts), 5 (HR)  |
| devices                           | [devices.md](../modules/devices.md)             | 6                   |
| analytics                         | [analytics.md](../modules/analytics.md)         | 1–5                 |

## 5. Source layout

```text
apps/backend-api/
├── src/
│   ├── main.ts                 # HTTP API bootstrap
│   ├── worker.ts               # BullMQ worker bootstrap
│   ├── realtime.ts             # Socket.IO gateway bootstrap
│   ├── app.module.ts
│   ├── common/
│   │   ├── auth/               # guards, current-user decorator, session strategy
│   │   ├── tenancy/            # TenantContext, RLS interceptor, estate resolver
│   │   ├── authz/              # @Can() decorator, policy guard
│   │   ├── errors/             # problem+json error mapping
│   │   ├── pagination/         # cursor pagination helpers
│   │   ├── idempotency/        # Idempotency-Key interceptor
│   │   ├── outbox/             # outbox writer + relay
│   │   ├── storage/            # signed upload/download URLs
│   │   └── observability/      # OTel, logging, request ids
│   ├── integrations/           # provider adapters (payments, sms, whatsapp, voice, push, email, kyc, bills, maps)
│   └── modules/
│       ├── identity/
│       ├── authz/
│       ├── tenancy/
│       ├── ... (one folder per module)
│       └── analytics/
├── prisma/ or drizzle/         # schema, migrations, RLS policies (SQL)
├── test/
│   ├── e2e/
│   ├── isolation/              # cross-tenant test suite
│   └── fixtures/
└── package.json
```

Each module folder follows the same shape:

```text
modules/visitor/
├── visitor.module.ts
├── visitor.controller.ts       # REST endpoints
├── visitor.service.ts          # public interface used by other modules
├── domain/                     # entities, value objects, state machines, rules
├── repositories/               # data access (this module's tables only)
├── jobs/                       # BullMQ processors
├── events/                     # event types emitted and handlers consumed
├── dto/                        # request/response schemas (from packages/schemas)
└── visitor.spec.ts
```

## 6. API conventions

### 6.1 Base paths

| Path prefix                       | Who calls it                    | Notes                                                               |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `/v1/auth/*`                      | Everyone                        | OTP, sessions, MFA, refresh                                         |
| `/v1/me/*`                        | Any signed-in user              | Profile, memberships, devices, notification settings                |
| `/v1/estates/:estateId/*`         | Estate members and staff        | All tenant-scoped resources                                         |
| `/v1/platform/*`                  | Techguard staff (Super Admin)   | Cross-tenant operations; every call audited                         |
| `/v1/vendors/:vendorId/*`         | Vendor accounts                 | Marketplace vendor operations                                       |
| `/v1/advertisers/:advertiserId/*` | Advertiser accounts             | Campaigns, reports                                                  |
| `/v1/public/*`                    | Unauthenticated                 | Visitor pass page, estate sign-up start, ad enquiries; rate-limited |
| `/v1/devices/*`                   | Registered gate devices / IoT   | Device-authenticated                                                |
| `/v1/webhooks/:provider`          | Payment and messaging providers | Signature-verified                                                  |

### 6.2 Request rules

- JSON only; `Content-Type: application/json`.
- IDs are UUIDv7 strings.
- Money is integer **kobo** with an explicit `currency` (`NGN`).
- Times are ISO 8601 UTC (`2026-11-13T10:00:00Z`); clients display WAT.
- Mutating requests that can be retried (payments, SOS trigger, pass creation, gate entry) accept an `Idempotency-Key` header; the API stores the response for 24 hours.
- Lists use cursor pagination: `?limit=50&cursor=<opaque>`; responses return `nextCursor`.
- Filtering by query params; sorting by `?sort=-createdAt`.
- Optimistic concurrency on editable records via `If-Match: <version>`; mismatch returns `412`.

### 6.3 Errors

RFC 9457 `application/problem+json`:

```json
{
  "type": "https://docs.safezone.ng/errors/pass-expired",
  "title": "Visitor pass has expired",
  "status": 422,
  "code": "VISITOR_PASS_EXPIRED",
  "detail": "Pass ended at 2026-11-13T18:00:00Z",
  "requestId": "01J..."
}
```

| Status | Use                                                                                      |
| ------ | ---------------------------------------------------------------------------------------- |
| 400    | Malformed request / validation failure (with `errors[]` per field)                       |
| 401    | Not signed in / token expired                                                            |
| 403    | Signed in but not permitted (never reveal whether the resource exists in another estate) |
| 404    | Not found in the caller's scope                                                          |
| 409    | State conflict (e.g. invoice already paid)                                               |
| 412    | Version mismatch                                                                         |
| 422    | Business rule violation                                                                  |
| 429    | Rate limited (with `Retry-After`)                                                        |

### 6.4 Versioning

- URL major version (`/v1`). Additive changes do not bump the version.
- Breaking changes ship as `/v2` endpoints alongside `/v1` for at least 6 months.
- `GET /v1/public/app-config?app=resident-mobile&platform=android&version=1.4.0` returns minimum and recommended versions for soft and hard update prompts.

## 7. Request lifecycle

1. **Request id** assigned (or taken from `X-Request-Id`); OTel span opened.
2. **Rate limit** checked in Redis (per IP, per user, per route class).
3. **Authentication**: access token (JWT, 15 min) verified; session looked up in Redis for revocation.
4. **Tenant resolution**: `:estateId` from path checked against the user's memberships.
5. **Authorisation**: `@Can(action, subject)` guard evaluates the user's role assignments in that estate and scope.
6. **Transaction opened** with `SET LOCAL app.estate_id = '<id>'` and `SET LOCAL app.user_id = '<id>'`; RLS policies use these.
7. **Validation** of body/query with Zod.
8. **Handler** runs domain logic; writes data and outbox rows in the same transaction.
9. **Commit**; response serialised; audit and events flow from the outbox asynchronously.

## 8. Tenant isolation

- Every tenant table has `estate_id uuid not null` and an RLS policy:
  `USING (estate_id = current_setting('app.estate_id')::uuid)`.
- The application database role does **not** bypass RLS. Platform operations use a separate role and service path, only reachable from `/v1/platform/*`, and every such call writes an audit event with a reason.
- Background jobs set the tenant context from the job payload before touching tenant data.
- The `test/isolation` suite runs every endpoint as a user from Estate B against Estate A resources and expects `403/404`. It must pass in CI on every merge.

## 9. Authentication summary

Detail in [identity.md](../modules/identity.md).

- Phone number (E.164, Nigeria first) + OTP via SMS (WhatsApp as alternative channel).
- Optional password for web.
- Access token 15 minutes; refresh token 30 days, rotated on use, bound to a device session.
- TOTP MFA required for estate staff roles and all platform roles.
- Security App uses **device registration + guard PIN** (see [security-mobile.md](security-mobile.md)).

## 10. Events and the outbox

- Domain services write an `outbox_events` row in the same transaction as the state change: `{id, type, version, estate_id, aggregate_type, aggregate_id, payload, occurred_at}`.
- The worker's **outbox relay** polls (or uses `LISTEN/NOTIFY`) and publishes to BullMQ queues by event type, marking rows dispatched.
- Consumers: notifications, audit, analytics, realtime broadcast, webhooks (Phase 6).
- Consumers must be idempotent (dedupe on event id).

Event naming: `<module>.<entity>.<past-tense-verb>`, e.g. `visitor.pass.created`, `emergency.alert.acknowledged`, `billing.invoice.issued`.

## 11. Queues

| Queue              | Priority                 | Examples                                                | Concurrency      |
| ------------------ | ------------------------ | ------------------------------------------------------- | ---------------- |
| `sos`              | Highest, own worker pool | SOS fan-out, escalation timers                          | High, isolated   |
| `notifications`    | High                     | Push, SMS, WhatsApp, email sends                        | High             |
| `outbox`           | High                     | Event relay                                             | 1–2 per instance |
| `gate`             | High                     | Offline sync ingestion, revocation list builds          | Medium           |
| `billing`          | Normal                   | Bulk invoice runs, penalties, reminders                 | Low              |
| `payments`         | Normal                   | Reconciliation, webhook processing, settlement checks   | Medium           |
| `imports`          | Low                      | Excel/CSV imports                                       | Low              |
| `exports`          | Low                      | Estate data exports, reports                            | Low              |
| `ads`              | Low                      | Impression/click rollups, campaign schedule transitions | Medium           |
| `maintenance-jobs` | Low                      | Retention purges, partition creation                    | 1                |

All jobs: retries with exponential backoff, dead-letter queue, alert when DLQ is non-empty.

## 12. Realtime gateway

- Clients connect with the access token; the gateway verifies and joins rooms.
- Rooms: `user:<id>`, `estate:<id>:security`, `estate:<id>:sos`, `estate:<id>:gate:<gateId>`, `channel:<id>` (community), `estate:<id>:dashboard`.
- Room joins are authorised with the same policy engine as REST.
- Messages are notifications of change (`{type, id, version}`); clients refetch over REST when needed, except SOS and chat which carry the payload.
- Fallback: if a socket is down, push notifications still deliver; clients resync on reconnect.

## 13. Integrations

All through adapters in `src/integrations/<category>/` with a common interface and a provider implementation, selected by configuration. Detail in each module doc.

| Category            | Interface          | Initial provider(s)              |
| ------------------- | ------------------ | -------------------------------- |
| Payments            | `PaymentGateway`   | Paystack, Flutterwave            |
| SMS                 | `SmsSender`        | Termii or Africa's Talking       |
| WhatsApp            | `WhatsAppSender`   | Meta WhatsApp Cloud API          |
| Voice               | `VoiceCaller`      | Africa's Talking Voice or Twilio |
| Push                | `PushSender`       | Expo Notifications               |
| Email               | `EmailSender`      | Zoho SMTP                        |
| Identity (NIN)      | `IdentityVerifier` | Dojah, Prembly or Smile ID       |
| Bills / electricity | `BillsProvider`    | VTpass, Baxi or BuyPower         |
| Maps                | `Geocoder`         | Google Maps Platform             |

## 14. Configuration

Environment variables (12-factor), validated at boot with Zod. Secrets from the managed vault.

```text
NODE_ENV, APP_PROCESS=api|worker|realtime
DATABASE_URL, DATABASE_REPLICA_URL
REDIS_URL
JWT_ACCESS_SECRET / JWT_KEYS (rotation), REFRESH_TOKEN_TTL_DAYS
STORAGE_BUCKET, STORAGE_REGION, STORAGE_ENDPOINT
PAYSTACK_SECRET_KEY, FLUTTERWAVE_SECRET_KEY
SMS_PROVIDER, SMS_API_KEY, SMS_SENDER_ID
WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
VOICE_PROVIDER, VOICE_API_KEY
EXPO_ACCESS_TOKEN
SMTP_HOST=smtp.zoho.com, SMTP_PORT, SMTP_USER, SMTP_PASS
KYC_PROVIDER, KYC_API_KEY
BILLS_PROVIDER, BILLS_API_KEY
GOOGLE_MAPS_KEY
SENTRY_DSN, OTEL_EXPORTER_OTLP_ENDPOINT
FEATURE_FLAGS_SOURCE
```

## 15. Non-functional requirements

| Area            | Target                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Latency         | p95 < 500 ms for ordinary operations (excluding provider latency)                                            |
| SOS             | Trigger → first guard notified < 5 s; synthetic SOS every 15 min on a canary estate                          |
| Availability    | 99.9% monthly                                                                                                |
| Backups         | Point-in-time recovery; RPO < 15 min; RTO < 4 h; monthly restore test                                        |
| Security        | OWASP ASVS L2; pen test before pilot and before money/commerce phases                                        |
| Data protection | NDPA 2023 / GAID 2025 aligned; see [platform.md](../modules/platform.md) and [audit.md](../modules/audit.md) |

## 16. Testing

- **Unit**: domain rules and state machines per module.
- **Integration**: repositories and services against real PostgreSQL (Testcontainers) with RLS on.
- **Contract**: OpenAPI schema snapshot; breaking-change check in CI.
- **Isolation**: cross-tenant suite (section 8).
- **E2E**: Supertest flows for onboarding, visitor pass, gate entry, SOS, billing and payment.
- **Load**: k6 scenarios for morning gate peak, SOS fan-out for a 2,000-unit estate, bulk invoice run, ad delivery.

## 17. Build, deploy, operate

- CI (GitHub Actions): lint → typecheck → unit → integration → isolation → build image → scan → push.
- Migrations: backward compatible (expand, migrate, contract); run as a pre-deploy job.
- Deploy: API, worker and realtime as separate services from the same image (`APP_PROCESS` selects the entry point).
- Environments: dev, staging, production (separate cloud accounts).
- Health: `/health/live`, `/health/ready` (DB, Redis), `/metrics`.
- Runbooks in `docs/operations/` for SOS-path alerts, provider outages, queue backlogs, database failover.

## 18. Open questions

1. Prisma vs Drizzle (RLS and `SET LOCAL` ergonomics decide it).
2. Hosting region (latency from Lagos vs NDPA transfer rules).
3. SMS provider choice after sender-ID and DND-route testing.
