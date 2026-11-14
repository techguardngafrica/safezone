# Error handling

Every error, from any route, has the same body (AGENTS.md §5.6, ADR-0006):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields are invalid",
    "statusCode": 400,
    "requestId": "0193b2…",
    "details": [
      { "path": "body.phone", "message": "Enter a valid Nigerian phone number in +234 format" }
    ]
  }
}
```

- `code` is stable; clients branch on it, never on `message`. Catalogue: [error-codes.md](error-codes.md).
- `message` is safe to show and never contains personal data or internals.
- `details` appears only for validation errors.
- 429 responses include `Retry-After`.
- 5xx responses are always `INTERNAL_ERROR` (or `SERVICE_UNAVAILABLE` for readiness). The cause is logged with PII masked and reported to Sentry; nothing internal reaches the client.

Server side: services throw `DomainError` subclasses (`src/common/errors/domain-error.ts`); `ApiExceptionFilter` is the only place errors become responses. Prisma unique violations map to 409 `CONFLICT`, missing records to 404.

In apps: `unwrap()` from `@safezone/api-client` throws `ApiClientError` with `code`, `statusCode` and `details`; network failures become `NETWORK_ERROR`.
