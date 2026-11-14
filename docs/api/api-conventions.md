# API conventions

Source of truth: [backend-api.md §6](../architecture/apps/backend-api.md#6-api-conventions) and [ADR-0006](../architecture/adr/0006-api-response-envelope.md).

- Base path `/v1/...` (no `/api` prefix). Health probes: `/health/live`, `/health/ready`.
- JSON only. IDs are UUIDv7. Money is integer kobo plus `currency`. Times are ISO 8601 UTC.
- Every route declares its access (`@Public`, `@SignedIn`, `@Member`, `@Can('<permission>')`) and a `@Contract` with Zod schemas from `@safezone/schemas`. The contract validates input, strips the response to the declared shape and generates OpenAPI.
- Request ids: send `X-Request-Id` (8 to 128 of `A-Z a-z 0-9 _ -`) or the API assigns a UUIDv7. It is echoed in the response header and in error bodies.
- Clients send `X-Safezone-App` (app key) and `X-Safezone-App-Version`. Web cookie refreshes require `X-Safezone-App`.
- Optimistic concurrency: `If-Match: <version>` on editable records; a stale version returns 409 `VERSION_MISMATCH`.

## Success

```json
{ "success": true, "data": { "id": "0193…" } }
```

Lists are cursor-paginated (`?limit=50&cursor=…`):

```json
{ "success": true, "data": [ … ], "meta": { "nextCursor": "eyJzZXEiOiI0MiJ9" } }
```

`204 No Content` responses have no body.

## Contract and client

`pnpm --filter @safezone/backend-api openapi` writes `packages/contracts/openapi.json` and regenerates its types. CI fails if the committed contract differs from the code. Apps call the API through `@safezone/api-client`:

```ts
const memberships = await unwrap(api.GET('/v1/me/memberships'));
```
