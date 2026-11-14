# ADR-0006: API response envelope instead of RFC 9457 problem details

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** `apps/backend-api`, `packages/types`, `packages/api-client`, every client

## Context

`backend-api.md` §6.3 specified RFC 9457 `application/problem+json`. AGENTS.md §5.6, which the user maintains as the binding instruction, requires every response in an envelope: `{ success: true, data, meta? }` or `{ success: false, error: { code, message, statusCode } }`. The code had problem+json; the two had to be reconciled before any client depended on either.

## Decision

Use the AGENTS.md envelope everywhere. Errors carry `code` (stable, catalogued in `docs/api/error-codes.md`), `message` (safe to show), `statusCode`, `requestId`, and `details[]` for field validation errors. One filter (`ApiExceptionFilter`) produces every error; one interceptor (`ResponseEnvelopeInterceptor`) wraps every success and strips it to the route's declared response schema. Lists put items in `data` and `nextCursor` in `meta`.

## Consequences

- `ProblemDetails` is removed from `@safezone/types`; `ApiErrorBody`, `ApiSuccessBody` and `ApiMeta` replace it. `@safezone/api-client` gains `isApiError`, `unwrap` and `ApiClientError`.
- `backend-api.md` §6.3 and `docs/api/*` are updated to the envelope.
- 5xx responses never include internal details; they are logged (masked) and sent to Sentry.
