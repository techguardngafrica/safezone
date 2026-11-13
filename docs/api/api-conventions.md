# API Conventions

- Base prefix: `/api/v1`
- Swagger / OpenAPI UI: `/api/docs`
- Correlation ID header: `x-correlation-id` (generated automatically if omitted)
- All timestamps are UTC ISO-8601 strings (`IsoDateString`)
- Success responses are wrapped by `ResponseEnvelopeInterceptor` into:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "timestamp": "2026-01-15T12:00:00.000Z",
    "correlationId": "..."
  }
}
```
