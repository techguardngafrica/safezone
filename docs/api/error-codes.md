# Error codes

Stable `error.code` values. Add a row when you add a code.

| Code                      | Status | Meaning / what the client should do                                |
| ------------------------- | ------ | ------------------------------------------------------------------ |
| `VALIDATION_FAILED`       | 400    | Fix the fields listed in `details`                                 |
| `BAD_REQUEST`             | 400    | Malformed request (e.g. invalid JSON)                              |
| `INVALID_CURSOR`          | 400    | Restart paging without a cursor                                    |
| `OTP_INVALID`             | 400    | Wrong, expired or exhausted code; ask for a new one                |
| `MFA_CODE_INVALID`        | 400    | Wrong or already used authenticator/recovery code                  |
| `PUSH_TOKEN_INVALID`      | 400    | Not an Expo push token                                             |
| `UNAUTHORIZED`            | 401    | Sign in                                                            |
| `TOKEN_INVALID`           | 401    | Access token expired or invalid; refresh                           |
| `SESSION_INVALID`         | 401    | Session ended (sign-out, revocation, refresh reuse); sign in again |
| `FORBIDDEN`               | 403    | Signed in but not permitted                                        |
| `MFA_REQUIRED`            | 403    | Complete two-step verification (or enrol) first                    |
| `FEATURE_NOT_ENABLED`     | 403    | The estate does not have this feature                              |
| `ACCOUNT_UNAVAILABLE`     | 403    | Locked or deleted account; contact support                         |
| `NOT_FOUND`               | 404    | Not found in the caller's scope                                    |
| `ESTATE_NOT_FOUND`        | 404    | Not a member of this estate (other estates are indistinguishable)  |
| `SESSION_NOT_FOUND`       | 404    | The session to revoke does not exist                               |
| `FILE_NOT_FOUND`          | 404    | The file does not exist in the caller's scope                      |
| `MFA_ENROLMENT_NOT_FOUND` | 404    | Start authenticator enrolment again                                |
| `CONFLICT`                | 409    | Duplicate record                                                   |
| `VERSION_MISMATCH`        | 409    | Record changed since it was read; reload                           |
| `MFA_ALREADY_ENABLED`     | 409    | Two-step verification is already on                                |
| `MFA_NOT_ENROLLED`        | 409    | Enrol an authenticator first                                       |
| `FILE_NOT_UPLOADED`       | 409    | PUT the bytes to the upload URL before completing                  |
| `FILE_NOT_READY`          | 409    | File not scanned clean (pending, infected or rejected)             |
| `PRECONDITION_FAILED`     | 412    | Malformed `If-Match`                                               |
| `FILE_TYPE_NOT_ALLOWED`   | 422    | Type not allowed for this purpose                                  |
| `FILE_TOO_LARGE`          | 422    | Over the purpose's size limit                                      |
| `FILE_MISMATCH`           | 422    | Uploaded object differs from what was declared                     |
| `FILE_PURPOSE_SCOPE`      | 422    | Personal purpose on an estate route or the reverse                 |
| `PREFERENCE_MANDATORY`    | 422    | Safety and security notifications cannot be turned off             |
| `PREFERENCE_UNKNOWN`      | 422    | Unknown notification category                                      |
| `RATE_LIMITED`            | 429    | Wait `Retry-After` seconds                                         |
| `INTERNAL_ERROR`          | 500    | Retry later; report the `requestId` if it persists                 |
| `OTP_DELIVERY_FAILED`     | 503    | SMS provider failed; retry shortly                                 |
| `SERVICE_UNAVAILABLE`     | 503    | A dependency is down (readiness probe)                             |
