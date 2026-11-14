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

## Phase 2: money, maintenance and operations

| Code                             | Status    | Meaning                                                             |
| -------------------------------- | --------- | ------------------------------------------------------------------- |
| `PRECONDITION_FAILED`            | 412       | `If-Match` is not a valid version                                   |
| `IDEMPOTENCY_KEY_REQUIRED`       | 400       | Payment intents need an `Idempotency-Key` header                    |
| `STATEMENT_PARTY_REQUIRED`       | 422       | Staff statements need a payer or a unit                             |
| `CHARGE_NOT_FOUND`               | 404       | No such charge in this estate                                       |
| `CHARGE_DATES_INVALID`           | 422       | End date before start date                                          |
| `BILLING_CHARGE_INACTIVE`        | 422       | A charge in the run is archived or outside the period               |
| `BILLING_RUN_NOT_FOUND`          | 404       | No such billing run                                                 |
| `BILLING_RUN_INVALID_TRANSITION` | 409       | The run's status does not allow this step                           |
| `BILLING_RUN_STALE`              | 409       | A charge changed after the preview; prepare a new run               |
| `BILLING_RUN_EMPTY`              | 422       | Nothing to bill                                                     |
| `BILLING_RUN_TOO_LARGE`          | 422       | More than 5,000 units; split the run                                |
| `BILLING_RUN_SELF_APPROVAL`      | 403       | The approver prepared or submitted the run                          |
| `INVOICE_NOT_FOUND`              | 404       | No such invoice visible to the caller                               |
| `INVOICE_NO_PAYER`               | 422       | The unit has no active household to bill                            |
| `INVOICE_DUE_DATE_PAST`          | 422       | Due date before today (WAT)                                         |
| `INVOICE_AMOUNT_EXCEEDS_BALANCE` | 422       | Credit note or waiver larger than what is owed                      |
| `INVOICE_NOT_PAYABLE`            | 422       | A chosen invoice is closed or not the caller's                      |
| `NOTHING_TO_PAY`                 | 422       | The caller has no open invoices                                     |
| `WAIVER_NOT_FOUND`               | 404       | No such waiver                                                      |
| `WAIVER_NOT_PENDING`             | 409       | Already decided                                                     |
| `WAIVER_SELF_APPROVAL`           | 403       | The requester cannot decide it                                      |
| `PAYOUT_ACCOUNT_NOT_FOUND`       | 404       | The estate has not linked a bank account                            |
| `PAYMENTS_NOT_SET_UP`            | 422       | Online payments are not set up for this estate                      |
| `CALLBACK_URL_NOT_ALLOWED`       | 422       | Return link outside the public web origin or app scheme             |
| `PAYMENT_INTENT_NOT_FOUND`       | 404       | No such payment visible to the caller                               |
| `PAYMENT_PROVIDER_UNAVAILABLE`   | 502       | The provider did not respond; retry                                 |
| `PAYMENT_PROVIDER_REJECTED`      | 422       | The provider refused (bad account, unknown bank)                    |
| `PAYMENT_PROVIDER_UNKNOWN`       | 404       | Webhook for a provider that is not configured                       |
| `WEBHOOK_SIGNATURE_INVALID`      | 401       | Missing or wrong webhook signature                                  |
| `WEBHOOK_PAYLOAD_INVALID`        | 400       | Unrecognised webhook body                                           |
| `VIRTUAL_ACCOUNT_NOT_PAYER`      | 403       | Only the unit's household head gets its transfer account            |
| `MANUAL_PAYMENT_NOT_FOUND`       | 404       | No such office payment                                              |
| `MANUAL_PAYMENT_NOT_PENDING`     | 409       | Already decided                                                     |
| `MANUAL_PAYMENT_SELF_APPROVAL`   | 403       | The recorder cannot approve it                                      |
| `TRANSACTION_NOT_FOUND`          | 404       | No such verified transaction                                        |
| `REFUND_EXCEEDS_PAYMENT`         | 422       | More than is left of the payment                                    |
| `REFUND_EXCEEDS_CREDIT`          | 422       | More than the payer's unallocated credit; issue a credit note first |
| `REFUND_NOT_FOUND`               | 404       | No such refund                                                      |
| `REFUND_NOT_PENDING`             | 409       | Already decided                                                     |
| `REFUND_SELF_APPROVAL`           | 403       | The requester cannot decide it                                      |
| `OWNERSHIP_NOT_FOUND`            | 404       | No such ownership                                                   |
| `OWNERSHIP_NOT_ACTIVE`           | 409       | Already ended                                                       |
| `OWNERSHIP_EXISTS`               | 409       | The person already owns part of the unit                            |
| `OWNERSHIP_SHARES_EXCEEDED`      | 422       | Shares would exceed 100%; use a transfer                            |
| `TRANSFER_NOT_FOUND`             | 404       | No such transfer                                                    |
| `TRANSFER_SHARES_INVALID`        | 422       | New owners' shares must total 100%                                  |
| `TRANSFER_ALREADY_OPEN`          | 409       | The unit already has a transfer in progress                         |
| `TRANSFER_INVALID_TRANSITION`    | 409       | The transfer's status does not allow this                           |
| `TRANSFER_NEEDS_SELLER`          | 422       | Seller has not confirmed; override needs documents and a reason     |
| `TRANSFER_STALE`                 | 409       | The unit's owners changed after the transfer was opened             |
| `CATEGORY_NOT_FOUND`             | 404       | No such maintenance category                                        |
| `CATEGORY_EXISTS`                | 409       | Category name already used                                          |
| `ATTACHMENT_INVALID`             | 422       | Attachments must be your uploaded maintenance files                 |
| `MAINTENANCE_REQUEST_NOT_FOUND`  | 404       | No such request visible to the caller                               |
| `MAINTENANCE_INVALID_TRANSITION` | 409       | The request's status does not allow this                            |
| `MAINTENANCE_REOPEN_EXPIRED`     | 409       | Resolved more than 7 days ago                                       |
| `MAINTENANCE_NOT_RESOLVED`       | 409       | Rate once resolved                                                  |
| `WORK_ORDER_NOT_FOUND`           | 404       | No such work order visible to the caller                            |
| `WORK_ORDER_CLOSED`              | 409       | Verified, closed or cancelled                                       |
| `WORK_ORDER_INVALID_TRANSITION`  | 409       | The work order's status does not allow this                         |
| `WORK_ORDER_SCHEDULE_INVALID`    | 422       | Visit must end after it starts                                      |
| `ASSIGNEE_NOT_STAFF`             | 422       | Staff assignees must hold an estate role                            |
| `RECHARGE_NEEDS_UNIT`            | 422       | Recharges need a unit                                               |
| `UTILITY_PROVIDER_NOT_FOUND`     | 404       | Unknown provider code                                               |
| `METER_LOOKUP_NOT_NEEDED`        | 422       | Estate sub-meters are not looked up                                 |
| `METER_NOT_FOUND`                | 422 / 404 | The provider has no such meter / no such meter here                 |
| `BILLS_PROVIDER_UNAVAILABLE`     | 502       | Meter validation is not available                                   |
| `METER_PROVIDER_MISMATCH`        | 422       | Provider does not supply that utility                               |
| `METER_EXISTS`                   | 409       | Meter already registered in the estate                              |
| `OUTAGE_NOT_FOUND`               | 404       | No such outage                                                      |
| `OUTAGE_CLOSED`                  | 409       | Already resolved or cancelled                                       |
| `MOVE_NOT_FOUND`                 | 404       | No such move                                                        |
| `MOVE_DATE_PAST`                 | 422       | Choose today or later                                               |
| `MOVE_ALREADY_SCHEDULED`         | 409       | A move of this type is already scheduled                            |
| `MOVE_NOT_SCHEDULED`             | 409       | Already completed or cancelled                                      |
| `MOVE_OUT_BALANCE_OUTSTANDING`   | 422       | The estate blocks move-out with unpaid invoices                     |
| `OCCUPANCY_DATES_INVALID`        | 422       | New end date not after the start                                    |
| `EXPORT_IN_PROGRESS`             | 409       | An export is already being prepared                                 |
| `EXPORT_NOT_FOUND`               | 404       | No such export                                                      |
| `EXPORT_NOT_READY`               | 409       | Not ready, failed or expired                                        |

## Phase 3: community, facilities and documents

| Code                                                                                                                                                                                            | Status    | Meaning                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------ |
| `GUIDELINES_NOT_ACCEPTED`                                                                                                                                                                       | 422       | Accept the community guidelines first            |
| `COMMUNITY_BANNED`                                                                                                                                                                              | 403       | Banned from the estate community                 |
| `MEMBER_MUTED`                                                                                                                                                                                  | 403       | Muted; can read but not post                     |
| `CHANNEL_NOT_FOUND`                                                                                                                                                                             | 404       | No such channel visible to the caller            |
| `CHANNEL_STAFF_ONLY`                                                                                                                                                                            | 403       | Only management posts here                       |
| `CHANNEL_NOT_ACTIVE`                                                                                                                                                                            | 409       | Channel pending, suspended or archived           |
| `CHANNEL_NOT_JOINABLE`                                                                                                                                                                          | 409       | Not an active resident channel                   |
| `CHANNEL_INVITE_ONLY`                                                                                                                                                                           | 403       | Needs an invitation                              |
| `CHANNEL_INVALID_TRANSITION`                                                                                                                                                                    | 409       | Channel status does not allow this               |
| `CHANNEL_MEMBERSHIP_DERIVED`                                                                                                                                                                    | 409       | Building and estate membership follows residence |
| `FEATURE_NOT_ENABLED`                                                                                                                                                                           | 403       | Private messaging is off in this estate          |
| `USER_BLOCKED`                                                                                                                                                                                  | 403       | One of you blocked the other                     |
| `DIRECT_SELF`                                                                                                                                                                                   | 422       | Cannot message yourself                          |
| `MEMBER_NOT_FOUND`                                                                                                                                                                              | 404       | Not an active member of the estate               |
| `MESSAGE_NOT_FOUND`                                                                                                                                                                             | 404       | No such message visible to the caller            |
| `MESSAGE_GONE`                                                                                                                                                                                  | 409       | Deleted or removed                               |
| `MESSAGE_EDIT_EXPIRED`                                                                                                                                                                          | 409       | Edits are allowed for 15 minutes                 |
| `REPORT_TARGET_NOT_FOUND`                                                                                                                                                                       | 404       | Reported item not found                          |
| `MODERATION_TARGET_INVALID`                                                                                                                                                                     | 422       | Action does not fit the target                   |
| `MODERATION_ACTION_NOT_FOUND`                                                                                                                                                                   | 404       | No such action for the caller                    |
| `APPEAL_EXISTS`                                                                                                                                                                                 | 409       | Already appealed                                 |
| `APPEAL_NOT_PENDING`                                                                                                                                                                            | 409       | No pending appeal                                |
| `APPEAL_SELF_REVIEW`                                                                                                                                                                            | 403       | Another moderator must decide                    |
| `POLL_NOT_FOUND`                                                                                                                                                                                | 404       | No such poll for the caller                      |
| `POLL_CLOSED`                                                                                                                                                                                   | 409       | Voting has ended                                 |
| `POLL_ALREADY_VOTED`                                                                                                                                                                            | 409       | One vote per user or household                   |
| `POLL_CLOSES_IN_PAST`                                                                                                                                                                           | 422       | Closing time must be in the future               |
| `POLL_HOUSEHOLD_REQUIRED`                                                                                                                                                                       | 422       | Household polls need a household                 |
| `POLL_OPTION_NOT_FOUND`                                                                                                                                                                         | 404       | No such option                                   |
| `POLL_ANONYMOUS`                                                                                                                                                                                | 409       | Voters of anonymous polls are not shown          |
| `FACILITY_NOT_FOUND`                                                                                                                                                                            | 404       | No such facility                                 |
| `FACILITY_CLOSED`                                                                                                                                                                               | 409       | Facility is closed                               |
| `FACILITY_UNAVAILABLE`                                                                                                                                                                          | 409       | Maintenance blackout at that time                |
| `BOOKING_CONFLICT`                                                                                                                                                                              | 409       | Someone booked that time first                   |
| `BOOKING_TOO_SHORT` / `BOOKING_TOO_LONG` / `BOOKING_TOO_FAR_AHEAD` / `BOOKING_IN_PAST` / `BOOKING_OUTSIDE_HOURS` / `BOOKING_TOO_MANY_GUESTS` / `BOOKING_WEEKLY_LIMIT` / `BOOKING_MONTHLY_LIMIT` | 422       | Facility rule broken                             |
| `BOOKING_ARREARS`                                                                                                                                                                               | 422       | Outstanding dues above the estate limit          |
| `BOOKING_NEEDS_UNIT`                                                                                                                                                                            | 422       | Paid bookings need a household unit to bill      |
| `BOOKING_NOT_FOUND`                                                                                                                                                                             | 404       | No such booking for the caller                   |
| `BOOKING_INVALID_TRANSITION`                                                                                                                                                                    | 409       | Booking status does not allow this               |
| `BOOKING_NOT_STARTED`                                                                                                                                                                           | 409       | No-show only after the start                     |
| `FOLDER_NOT_FOUND` / `FOLDER_EXISTS`                                                                                                                                                            | 404 / 409 | Folder missing or name taken                     |
| `DOCUMENT_NOT_FOUND` / `DOCUMENT_VERSION_NOT_FOUND`                                                                                                                                             | 404       | Not found or not visible                         |
| `DOCUMENT_FILE_INVALID`                                                                                                                                                                         | 422       | Upload the document file first                   |
| `DOCUMENT_ARCHIVED`                                                                                                                                                                             | 409       | Archived documents take no new versions          |
