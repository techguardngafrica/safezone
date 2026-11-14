# API

The API conventions are specified in [architecture/apps/backend-api.md §6](../architecture/apps/backend-api.md#6-api-conventions): base paths, request rules, the response envelope ([ADR-0006](../architecture/adr/0006-api-response-envelope.md)), cursor pagination, idempotency keys, versioning. Details: [api-conventions.md](api-conventions.md), [error-handling.md](error-handling.md), [error-codes.md](error-codes.md), [versioning.md](versioning.md).

## Contract flow

1. Controllers in `apps/backend-api` use schemas from `@safezone/schemas`.
2. `pnpm --filter @safezone/backend-api openapi` generates the OpenAPI 3.1 document from route `@Contract`s into `packages/contracts/openapi.json` and regenerates `src/generated/openapi.d.ts`.
3. `@safezone/api-client` uses those types, so every app call is checked against the real API.

Never edit `openapi.json` or the generated types by hand. CI will fail if they drift from the backend.

## To document here

- Webhook endpoints and signature verification per provider (Paystack, Flutterwave, SMS, WhatsApp, voice).
- Rate limits per route class.
