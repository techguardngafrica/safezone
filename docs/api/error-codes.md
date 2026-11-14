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

## Occupancy, visitors, gates, SOS and announcements (Phase 1)

| Code                         | Status | Meaning / what the client should do                             |
| ---------------------------- | ------ | --------------------------------------------------------------- |
| `IDEMPOTENCY_KEY_REQUIRED`   | 400    | Send an `Idempotency-Key` header (a UUID per SOS press)         |
| `NOT_HOUSEHOLD_HEAD`         | 403    | Only the household head (or a manager) can do this              |
| `VISITOR_INVITE_NOT_ALLOWED` | 403    | The household has not given this member visitor invitations     |
| `SOS_NOT_ALLOWED`            | 403    | The household has not given this member SOS                     |
| `DRILL_NOT_ALLOWED`          | 403    | Only supervisors and managers start drills                      |
| `ESTATE_CODE_NOT_FOUND`      | 404    | No estate accepts residents with that join code                 |
| `HOUSEHOLD_NOT_FOUND`        | 404    | No such household for this caller                               |
| `MEMBER_NOT_FOUND`           | 404    | No such active household member                                 |
| `OCCUPANCY_NOT_FOUND`        | 404    | No such occupancy                                               |
| `JOIN_REQUEST_NOT_FOUND`     | 404    | No such request waiting for this caller                         |
| `VEHICLE_NOT_FOUND`          | 404    | No such vehicle                                                 |
| `STAFF_NOT_FOUND`            | 404    | No such domestic staff record                                   |
| `CONTACT_NOT_FOUND`          | 404    | No such emergency contact                                       |
| `GATE_NOT_FOUND`             | 404    | No active gate with that id in this estate                      |
| `PASS_NOT_FOUND`             | 404    | No such pass for this caller                                    |
| `WALKIN_NOT_FOUND`           | 404    | No such walk-in request for this caller                         |
| `RESTRICTED_NOT_FOUND`       | 404    | No such restricted-list entry                                   |
| `SOS_NOT_FOUND`              | 404    | No such alert for this caller                                   |
| `ANNOUNCEMENT_NOT_FOUND`     | 404    | No such announcement for this reader                            |
| `UNIT_OCCUPIED`              | 409    | The unit already has a household; join it as a household member |
| `ALREADY_MEMBER`             | 409    | Already in the household                                        |
| `JOIN_REQUEST_OPEN`          | 409    | A request for this unit is already waiting                      |
| `JOIN_REQUEST_CLOSED`        | 409    | The request was already decided or cancelled                    |
| `JOIN_REQUEST_INVALID_STATE` | 409    | The request is not waiting for this approver                    |
| `JOIN_REQUEST_STATE_CHANGED` | 409    | Someone else decided it; reload                                 |
| `HOUSEHOLD_ENDED`            | 409    | The target household no longer lives there                      |
| `OCCUPANCY_NOT_ACTIVE`       | 409    | The occupancy has already ended                                 |
| `PLATE_REGISTERED`           | 409    | That plate is already active in the estate                      |
| `STAFF_ENDED`                | 409    | The staff pass has ended                                        |
| `GATE_NAME_TAKEN`            | 409    | A live gate already has that name                               |
| `PASS_REVOKED`               | 409    | The pass is already revoked                                     |
| `PASS_NOT_USABLE`            | 409    | Only scheduled or active passes can be shared                   |
| `WALKIN_CLOSED`              | 409    | Already answered or timed out                                   |
| `SOS_INVALID_STATE`          | 409    | The alert's status does not allow this action                   |
| `SOS_STATE_CHANGED`          | 409    | Someone else updated the alert; reload                          |
| `SOS_NOT_ACTIVE`             | 409    | The alert has ended; location is no longer collected            |
| `NO_HOUSEHOLD`               | 422    | Nobody lives in that unit                                       |
| `HEAD_PERMISSIONS_FIXED`     | 422    | The household head always has every permission                  |
| `CANNOT_REMOVE_HEAD`         | 422    | End the occupancy instead                                       |
| `PLATE_INVALID`              | 422    | Enter a valid plate                                             |
| `TOO_MANY_CONTACTS`          | 422    | At most 5 emergency contacts                                    |
| `PASS_TOO_LONG`              | 422    | Longer than `visitor.max_pass_days` (staff passes: 366 days)    |
| `PASS_IN_PAST`               | 422    | The pass would already have ended                               |
| `HOUSEHOLD_REQUIRED`         | 422    | Residents must choose the household the visitor is coming to    |
| `STAFF_NOT_ACTIVE`           | 422    | Staff passes need an approved staff member of that household    |
| `NO_VISITOR_PHONE`           | 422    | Add the visitor phone before sharing                            |
| `GATE_REASON_REQUIRED`       | 422    | Denials and overrides need a reason                             |
| `WALKIN_NOT_APPROVED`        | 422    | The household has not approved this walk-in                     |
| `NOT_A_RESPONDER`            | 422    | Assign SOS alerts to a guard or supervisor of the estate        |
| `LOCATION_REQUIRED`          | 422    | Send a location                                                 |
| `PIN_SPACE_EXHAUSTED`        | 503    | Could not issue a unique PIN; retry                             |
