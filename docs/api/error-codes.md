# Error codes

Stable `error.code` values. Add a row when you add a code.

| Code                            | Status | Meaning / what the client should do                                |
| ------------------------------- | ------ | ------------------------------------------------------------------ |
| `VALIDATION_FAILED`             | 400    | Fix the fields listed in `details`                                 |
| `BAD_REQUEST`                   | 400    | Malformed request (e.g. invalid JSON)                              |
| `INVALID_CURSOR`                | 400    | Restart paging without a cursor                                    |
| `OTP_INVALID`                   | 400    | Wrong, expired or exhausted code; ask for a new one                |
| `MFA_CODE_INVALID`              | 400    | Wrong or already used authenticator/recovery code                  |
| `PUSH_TOKEN_INVALID`            | 400    | Not an Expo push token                                             |
| `UNAUTHORIZED`                  | 401    | Sign in                                                            |
| `TOKEN_INVALID`                 | 401    | Access token expired or invalid; refresh                           |
| `SESSION_INVALID`               | 401    | Session ended (sign-out, revocation, refresh reuse); sign in again |
| `FORBIDDEN`                     | 403    | Signed in but not permitted                                        |
| `MFA_REQUIRED`                  | 403    | Complete two-step verification (or enrol) first                    |
| `FEATURE_NOT_ENABLED`           | 403    | The estate does not have this feature                              |
| `ACCOUNT_UNAVAILABLE`           | 403    | Locked or deleted account; contact support                         |
| `ESTATE_SUSPENDED`              | 403    | Estate suspended: only reads and safety actions are allowed        |
| `INVITATION_PHONE_MISMATCH`     | 403    | Sign in with the phone number the invitation was sent to           |
| `NOT_FOUND`                     | 404    | Not found in the caller's scope                                    |
| `ESTATE_NOT_FOUND`              | 404    | Not a member of this estate (other estates are indistinguishable)  |
| `SESSION_NOT_FOUND`             | 404    | The session to revoke does not exist                               |
| `FILE_NOT_FOUND`                | 404    | The file does not exist in the caller's scope                      |
| `MFA_ENROLMENT_NOT_FOUND`       | 404    | Start authenticator enrolment again                                |
| `APPLICATION_NOT_FOUND`         | 404    | No such application for this caller                                |
| `INVITATION_NOT_FOUND`          | 404    | Unknown invitation link                                            |
| `LEAD_NOT_FOUND`                | 404    | Unknown onboarding lead                                            |
| `SPACE_NOT_FOUND`               | 404    | No such space in this estate                                       |
| `CONFLICT`                      | 409    | Duplicate record                                                   |
| `VERSION_MISMATCH`              | 409    | Record changed since it was read; reload                           |
| `MFA_ALREADY_ENABLED`           | 409    | Two-step verification is already on                                |
| `MFA_NOT_ENROLLED`              | 409    | Enrol an authenticator first                                       |
| `FILE_NOT_UPLOADED`             | 409    | PUT the bytes to the upload URL before completing                  |
| `FILE_NOT_READY`                | 409    | File not scanned clean (pending, infected or rejected)             |
| `APPLICATION_INVALID_STATE`     | 409    | The application's status does not allow this action                |
| `APPLICATION_STATE_CHANGED`     | 409    | Another reviewer changed it; reload                                |
| `TOO_MANY_OPEN_APPLICATIONS`    | 409    | Wait for a decision on open applications                           |
| `ESTATE_INVALID_STATE`          | 409    | The estate's status does not allow this action                     |
| `LEAD_ALREADY_CONVERTED`        | 409    | The lead already has an estate                                     |
| `INVITATION_EXPIRED`            | 409    | Ask Techguard for a new invitation                                 |
| `INVITATION_NOT_PENDING`        | 409    | Invitation accepted or revoked                                     |
| `SPACE_CODE_TAKEN`              | 409    | Code in use (units: estate-wide; others: among siblings)           |
| `SPACE_ARCHIVED`                | 409    | The space (or chosen parent) is archived                           |
| `SPACE_HAS_CHILDREN`            | 409    | Archive or move the spaces inside it first                         |
| `SPACE_OCCUPIED`                | 409    | An occupied unit cannot be archived                                |
| `PRECONDITION_FAILED`           | 412    | Malformed `If-Match`                                               |
| `FILE_TYPE_NOT_ALLOWED`         | 422    | Type not allowed for this purpose                                  |
| `FILE_TOO_LARGE`                | 422    | Over the purpose's size limit                                      |
| `FILE_MISMATCH`                 | 422    | Uploaded object differs from what was declared                     |
| `FILE_PURPOSE_SCOPE`            | 422    | Personal purpose on an estate route or the reverse                 |
| `PREFERENCE_MANDATORY`          | 422    | Safety and security notifications cannot be turned off             |
| `PREFERENCE_UNKNOWN`            | 422    | Unknown notification category                                      |
| `APPLICATION_DOCUMENT_INVALID`  | 422    | Re-upload the documents listed in `details`                        |
| `APPLICATION_DOCUMENTS_MISSING` | 422    | Approval needs one scanned, clean proof-of-authority document      |
| `TOO_MANY_DOCUMENTS`            | 422    | At most 10 documents per application                               |
| `ROLE_NOT_ASSIGNABLE`           | 422    | That role cannot be granted at this level                          |
| `SETUP_STEP_INCOMPLETE`         | 422    | The facts for this setup step are not in place yet                 |
| `SETUP_INCOMPLETE`              | 422    | Finish the listed setup steps before activating                    |
| `SPACE_INVALID_PARENT`          | 422    | That type cannot sit under that parent (or inside itself)          |
| `SPACE_TOO_DEEP`                | 422    | The tree is limited to 8 levels                                    |
| `UNIT_FIELDS_ON_NON_UNIT`       | 422    | Unit type, bedrooms and status apply to units only                 |
| `BULK_PLAN_INVALID`             | 422    | Fix the pattern (levels, labels, templates)                        |
| `RATE_LIMITED`                  | 429    | Wait `Retry-After` seconds                                         |
| `INTERNAL_ERROR`                | 500    | Retry later; report the `requestId` if it persists                 |
| `OTP_DELIVERY_FAILED`           | 503    | SMS provider failed; retry shortly                                 |
| `SERVICE_UNAVAILABLE`           | 503    | A dependency is down (readiness probe)                             |
