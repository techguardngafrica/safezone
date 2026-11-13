# API

The API conventions are specified in [architecture/apps/backend-api.md §6](../architecture/apps/backend-api.md#6-api-conventions): base paths, request rules, problem+json errors, cursor pagination, idempotency keys, versioning.

## Contract flow

1. Controllers in `apps/backend-api` use schemas from `@safezone/schemas`.
2. The backend generates the OpenAPI 3.1 document into `packages/contracts/openapi.json` (Phase 0, task 12).
3. `pnpm --filter @safezone/contracts generate` produces `src/generated/openapi.d.ts`.
4. `@safezone/api-client` uses those types, so every app call is checked against the real API.

Never edit `openapi.json` or the generated types by hand. CI will fail if they drift from the backend.

## To document here

- Webhook endpoints and signature verification per provider (Paystack, Flutterwave, SMS, WhatsApp, voice).
- Error code catalogue (`code` values and what clients should do).
- Rate limits per route class.
