# Module: Tenancy and Estate Onboarding

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 (tenancy core), 1 (onboarding workflows) · Owner: Backend · Apps: public-web, super-admin, management-web, management-mobile, resident-mobile

## 1. Responsibility

Tenancy owns **estates as tenants** of the platform: their records, lifecycle, configuration, memberships (who belongs to which estate), entitlements, and the two onboarding workflows that bring estates onto Safezone. It also provides the tenant context that row-level security relies on.

> "Tenancy" here means the SaaS tenant (the estate). Residential tenancy (a tenant renting a unit) is in [occupancy](occupancy.md).

## 2. Confirmed business decisions

- **Free onboarding**: estates join without a subscription; every estate gets all core features free at launch. Premium features or paid plans may come later through entitlements.
- **Two onboarding workflows** are both supported: self-service and Techguard-assisted.

## 3. Capabilities

1. Estate records: profile, address, location, logo, contacts, type, size.
2. Estate lifecycle: applied → under review → approved → active → suspended → deactivated (or rejected).
3. **Self-service onboarding**: representative signs up, submits details and documents, Techguard reviews, approves or rejects, approved estate gets a management workspace.
4. **Techguard-assisted onboarding**: Techguard creates the estate record and initial information, invites a representative as administrator, who verifies access and completes setup.
5. Setup wizard progress tracking.
6. Estate configuration and policies (visitor, SOS, tenant approval, community, ads opt-outs).
7. Estate memberships: link users to estates with a status.
8. Join requests (residents requesting access) — handed to [occupancy](occupancy.md) for unit association.
9. Entitlements: which modules/features an estate has (free core plan at launch).
10. Bulk import framework (units, residents, vehicles, balances) used by property, occupancy and billing.
11. Tenant context for RLS (`app.estate_id`).
12. Estate suspension (safety features keep working) and deactivation/offboarding with data export.

## 4. Onboarding workflows

### 4.1 Self-service

| Step                                   | Actor                                   | System                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create account                      | Estate representative                   | Identity: phone + OTP                                                                                                                                                                    |
| 2. Submit estate details and documents | Representative (public-web `/register`) | `estate_applications` row, documents to storage, status `submitted`                                                                                                                      |
| 3. Review                              | Platform Administrator (super-admin)    | Duplicate check (name, address, geo radius); status `under_review`; may set `info_requested`                                                                                             |
| 4. Approve or reject                   | Platform Administrator                  | Approve: create `estates` row (status `approved`), membership + Estate Administrator role for representative, entitlements = core plan. Reject: reason recorded, representative notified |
| 5. Workspace                           | System                                  | Notification with link to management app setup wizard                                                                                                                                    |
| 6. Configure                           | Estate Administrator                    | Setup wizard: spaces, gates, staff, guards, policies, residents; on completion status → `active`                                                                                         |

### 4.2 Techguard-assisted

| Step                                | Actor                                        | System                                                                                            |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Estate contacts Techguard        | Estate (public-web `/contact`, phone, email) | Lead created in onboarding pipeline                                                               |
| 2. Create estate record             | Platform Operations/Administrator            | `estates` row with `onboarding_mode = assisted`, status `approved`                                |
| 3. Enter initial information        | Techguard                                    | Profile, gates, optionally spaces and residents via import                                        |
| 4. Invite representative            | Techguard                                    | Invitation by SMS + email (Zoho SMTP) with expiring link (7 days)                                 |
| 5. Verify access and complete setup | Representative                               | Accepts invite (phone + OTP; MFA enrol), becomes Estate Administrator, finishes wizard → `active` |

## 5. Data model

| Table                          | Key columns                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estates`                      | `id`, `name`, `slug`, `code` (short join code), `type`, `address`, `state`, `lga`, `geo_point`, `logo_file_id`, `timezone` (Africa/Lagos), `currency` (NGN), `status`, `onboarding_mode` (self_service, assisted), `approved_by`, `approved_at`, `activated_at`, `suspended_at`, `suspension_reason`, `created_at` |
| `estate_applications`          | `id`, `applicant_user_id`, `representative_role`, `estate_name`, `address`, `geo_point`, `units_estimate`, `gates_estimate`, `status` (submitted, under_review, info_requested, approved, rejected, withdrawn), `reviewer_id`, `decision_reason`, `estate_id` (on approval), timestamps                            |
| `estate_application_documents` | `application_id`, `file_id`, `doc_type`                                                                                                                                                                                                                                                                            |
| `onboarding_leads`             | `id`, contact fields, `estate_name`, `location`, `size`, `status`, `owner_user_id` (Techguard), `estate_id`                                                                                                                                                                                                        |
| `estate_invitations`           | `id`, `estate_id`, `phone`, `email`, `role_key`, `token_hash`, `expires_at`, `accepted_at`, `invited_by`                                                                                                                                                                                                           |
| `estate_settings`              | `estate_id`, `key`, `value` (jsonb), `updated_by` — typed by a settings schema                                                                                                                                                                                                                                     |
| `estate_setup_progress`        | `estate_id`, `step`, `completed_at`                                                                                                                                                                                                                                                                                |
| `estate_memberships`           | `id`, `estate_id`, `user_id`, `status` (pending, active, suspended, left), `joined_at`, `left_at`                                                                                                                                                                                                                  |
| `entitlements`                 | `estate_id`, `feature_key`, `enabled`, `source` (core_plan, premium, override), `valid_to`                                                                                                                                                                                                                         |
| `plans`                        | `id`, `key` (`core`), `features` — framework only; all estates on `core`                                                                                                                                                                                                                                           |
| `import_jobs`                  | `id`, `estate_id`, `type`, `file_id`, `status` (uploaded, validating, validated, importing, done, failed), `dry_run_report_file_id`, `result_report_file_id`, `rows_total`, `rows_ok`, `rows_failed`, `created_by`                                                                                                 |

## 6. Estate settings (examples)

| Key                                    | Default                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `tenant_approval`                      | `owner_then_manager_override`                                               |
| `visitor.max_pass_days`                | 30                                                                          |
| `visitor.walkin_timeout_seconds`       | 180                                                                         |
| `visitor.require_photo`                | false                                                                       |
| `staff_pass.requires_manager_approval` | true                                                                        |
| `sos.cancel_countdown_seconds`         | 5                                                                           |
| `sos.escalation`                       | `[60: next_guard, 120: supervisor+managers, 180: emergency_contacts_voice]` |
| `community.private_messaging`          | false                                                                       |
| `community.channel_approval`           | true                                                                        |
| `ads.blocked_categories`               | `[]`                                                                        |
| `guards.can_see_resident_phone`        | false                                                                       |

## 7. Business rules

1. Estate names need not be unique, but the duplicate check flags matches within 500 m with similar names for review.
2. An application cannot be approved without at least one proof-of-authority document.
3. Approval creates exactly one Estate Administrator assignment for the representative (or the invited person).
4. Status `active` requires setup steps: spaces (≥ 1 unit), gates (≥ 1), security supervisor (≥ 1), SOS policy set.
5. **Suspension** blocks management changes and new billing, but visitor verification, SOS and access to safety records continue.
6. Deactivation starts offboarding: read-only 90 days, export offered, then deletion per retention schedule (safety records kept for their retention period).
7. Entitlement checks are done in the API (`@RequiresFeature('community')`); disabled features return 403 with `FEATURE_NOT_ENABLED`.
8. Imports are idempotent by `external_ref` per row; re-import updates.

## 8. Tenant context

- Request interceptor resolves `:estateId`, checks active membership or platform support session, then `SET LOCAL app.estate_id`.
- Jobs carry `estateId` in payload and set the same context.
- Helper `withEstate(estateId, fn)` for services.

## 9. API

| Method    | Path                                                                         | Purpose                                                   |
| --------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| POST      | `/v1/public/estate-applications`                                             | Submit self-service application                           |
| GET       | `/v1/me/estate-applications`                                                 | Applicant tracks status                                   |
| POST      | `/v1/public/onboarding-leads`                                                | Assisted onboarding request                               |
| GET       | `/v1/platform/estate-applications`                                           | Review queue                                              |
| POST      | `/v1/platform/estate-applications/:id/approve` · `/reject` · `/request-info` | Decisions                                                 |
| POST      | `/v1/platform/estates`                                                       | Techguard creates estate (assisted)                       |
| POST      | `/v1/platform/estates/:id/invitations`                                       | Invite representative                                     |
| POST      | `/v1/public/invitations/:token/accept`                                       | Accept invitation                                         |
| POST      | `/v1/platform/estates/:id/suspend` · `/reactivate` · `/deactivate`           | Lifecycle                                                 |
| GET/PATCH | `/v1/estates/:estateId`                                                      | Estate profile                                            |
| GET/PATCH | `/v1/estates/:estateId/settings`                                             | Settings                                                  |
| GET/POST  | `/v1/estates/:estateId/setup-progress`                                       | Wizard progress                                           |
| GET       | `/v1/me/memberships`                                                         | User's estates + roles                                    |
| GET       | `/v1/estates/search?q=`                                                      | Estate search for join (name, city; returns limited info) |
| POST      | `/v1/estates/:estateId/imports`                                              | Upload import (type, file)                                |
| POST      | `/v1/estates/:estateId/imports/:id/confirm`                                  | Run after dry run                                         |

## 10. Events

`tenancy.application.submitted`, `tenancy.application.approved`, `tenancy.application.rejected`, `tenancy.application.info_requested`, `tenancy.estate.created`, `tenancy.estate.activated`, `tenancy.estate.suspended`, `tenancy.estate.reactivated`, `tenancy.estate.deactivated`, `tenancy.invitation.sent`, `tenancy.invitation.accepted`, `tenancy.settings.updated`, `tenancy.import.completed`.

## 11. Jobs

- `imports.validate`, `imports.run` (chunked, 500 rows per batch).
- `invitations.expire` (daily).
- `offboarding.purge` (after read-only period).

## 12. Notifications

Applicant: submitted, info requested, approved (with setup link), rejected. Invitee: invitation. Techguard ops: new application, application stale > 2 working days.

## 13. Acceptance criteria

- A complete self-service application can be approved and the representative lands in the setup wizard with Estate Administrator rights.
- A Techguard-assisted estate can be created, pre-filled and handed over by invitation without the representative re-entering data.
- A suspended estate still verifies visitor passes and delivers SOS.
- An estate with no entitlement for a module gets `FEATURE_NOT_ENABLED` from that module's endpoints.

## 14. Phase 0 implementation notes

Built (`src/modules/tenancy`): `estates` (platform schema), `estate_memberships`, `estate_settings`, `entitlements` (tenant schema, RLS), `plans` with the free `core` plan; `GET/PATCH /v1/estates/:estateId` (If-Match on `version`), `GET/PATCH /v1/estates/:estateId/settings` typed by `estateSettingsSchema` (defaults from §6), entitlement checks for `@RequiresFeature`. Changes are audited through the outbox.

Onboarding workflows, invitations, setup progress and imports are Phase 1. Local estates come from `pnpm db:seed:dev`.

## 15. Phase 1 implementation notes (onboarding)

Built in `src/modules/tenancy/onboarding` (decisions in [ADR-0008](../adr/0008-estate-onboarding.md)):

- **Tables:** `estate_applications` (+ append-only `estate_application_documents`), `onboarding_leads`, `estate_invitations` (token hash only), `estate_setup_progress`. Status machines in `domain/application-status.ts` and `domain/estate-lifecycle.ts`, unit-tested per transition.
- **Self-service:** `POST /v1/me/estate-applications` (signed in; documents are the applicant's own `estate_application` uploads), `GET /v1/me/estate-applications`, `…/:id/resubmit`, `…/:id/withdraw`. Review: `GET /v1/platform/estate-applications[/:id]` (applicant phone + duplicate check), `…/start-review`, `…/request-info`, `…/approve`, `…/reject`, `…/documents/:fileId/download-url` (audited). Approval needs one clean document and creates estate + membership + Estate Administrator in one transaction.
- **Assisted:** `POST /v1/public/onboarding-leads` (rate-limited), `GET/PATCH /v1/platform/onboarding-leads`, `POST/GET /v1/platform/estates[/:id]`, `POST/GET /v1/platform/estates/:id/invitations`, `…/:invitationId/revoke`, `GET /v1/public/invitations/:token`, `POST /v1/invitations/:token/accept` (invited phone only). Links are sent by the worker on the `onboarding` queue.
- **Lifecycle:** `POST /v1/platform/estates/:id/suspend|reactivate|deactivate` (reason required, audited). Suspension is enforced in the authorization guard (`ESTATE_SUSPENDED` except reads and safety actions).
- **Setup:** `GET /v1/estates/:estateId/setup-progress`, `POST …/:step/complete`, `POST …/activate`. Required: spaces, gates, security supervisor, SOS policy. The supervisor step is verified through authz; spaces and gates are confirmed by the administrator until property and security register their verifiers.
- **Not yet built:** applicant/ops email notifications (applicant notices go by push or SMS), "stale application" alerts to Techguard ops, `invitations.expire` job (expiry is computed on read), `GET /v1/estates/search` for join requests (arrives with occupancy), imports framework, offboarding purge.
