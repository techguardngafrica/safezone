# Error Handling

All unhandled and HTTP exceptions pass through `AllExceptionsFilter` in `apps/backend-api/src/common/filters/all-exceptions.filter.ts` and return a standardized `ApiErrorResponse`:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed"
  },
  "meta": {
    "timestamp": "2026-01-15T12:00:00.000Z",
    "path": "/api/v1/health",
    "correlationId": "..."
  }
}
```

`@safezone/api-client` normalizes these responses into `SafezoneApiError`.

