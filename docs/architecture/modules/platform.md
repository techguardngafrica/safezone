# Module: Platform Administration

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0–1 (core), 2 (exports, plans framework), later phases add vendor/advertiser oversight · Owner: Backend · App: super-admin

## 1. Responsibility

Platform owns **Techguard's control plane** for Safezone: platform staff, feature flags, plans and entitlements framework, app version config, provider configuration, support tickets and support access sessions, data subject requests and compliance records, estate data exports and offboarding, platform settings and platform health views. Estate lifecycle actions are in [tenancy](tenancy.md); this module provides the cross-tenant tools around them.

## 2. Capabilities

1. Platform staff accounts and platform roles (with [authz](authz.md)).
2. Feature flags: global, per estate, per app/version, percentage rollouts.
3. Plans and entitlements framework — **all estates on the free core plan at launch**; premium features can be defined later without code changes.
4. App version config (minimum/recommended per app and platform) for forced/soft updates.
5. Provider configuration: active provider per category, failover order, status (credentials live in the vault).
6. Support tickets from in-app help, WhatsApp line and email, with SLAs.
7. Support access sessions ("view as") with estate consent, time limits and audit.
8. Data subject requests (access, correction, deletion, export) with 30-day clock.
9. Compliance records: DPIA register, data processing agreements per estate, retention schedule, breach log (72-hour workflow), ARCON approvals register.
10. Estate data export (full export as ZIP of CSV/JSON + files) and offboarding.
11. Platform settings: prohibited ad categories, default templates, SMS caps on free plan.
12. Platform health dashboards (from metrics).
13. Platform-wide reports (estates, users, adoption, revenue from ads and marketplace).

## 3. Data model

| Table                     | Key columns                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature_flags`           | `key`, `description`, `default`, `rules` (jsonb: estate ids, apps, versions, percent)                                                                                                                             |
| `app_versions`            | `app`, `platform`, `min_version`, `recommended_version`, `message`, `updated_by`                                                                                                                                  |
| `provider_configs`        | `category`, `provider`, `priority`, `enabled`, `status`, `secret_ref`                                                                                                                                             |
| `support_tickets`         | `id`, `estate_id` (nullable), `requester_user_id`, `channel`, `category`, `priority`, `subject`, `status` (new, open, pending_customer, resolved, closed), `assignee_id`, `sla_due_at`, timestamps                |
| `support_ticket_messages` | `ticket_id`, `author_id`, `body`, `attachments`, `internal`                                                                                                                                                       |
| `support_sessions`        | `id`, `estate_id`, `agent_id`, `reason`, `ticket_id`, `mode` (read_only, read_write), `status` (requested, approved, active, expired, denied, revoked), `approved_by`, `emergency` (bool), `starts_at`, `ends_at` |
| `data_subject_requests`   | `id`, `user_id`, `type`, `status`, `received_at`, `due_at`, `identity_checked_by`, `estate_tasks` (jsonb), `response_file_id`                                                                                     |
| `dpa_records`             | `estate_id`, `version`, `accepted_by`, `accepted_at`, `file_id`                                                                                                                                                   |
| `breach_log`              | `id`, `detected_at`, `description`, `severity`, `affected_estates`, `affected_count`, `ndpc_notified_at`, `subjects_notified_at`, `status`                                                                        |
| `retention_rules`         | `data_type`, `retention_days`, `basis`, `action` (delete, anonymise, archive)                                                                                                                                     |
| `estate_exports`          | `id`, `estate_id`, `requested_by`, `status`, `file_id`, `expires_at`                                                                                                                                              |

## 4. Support access rules

1. Agent requests access to an estate with a reason and ticket.
2. Estate Administrator approves in the management app (or denies).
3. **Emergency** access (e.g. SOS failure investigation) can be self-approved by a Platform Administrator, with immediate notification to the estate and mandatory review.
4. Default 2 hours, read-only; read-write needs explicit approval.
5. During a session, requests carry `support_session_id`; the RLS context is set for that estate.
6. Every action is audited and visible to the estate.

## 5. Data subject requests

1. Intake (in-app, email, support).
2. Identity check.
3. Platform determines controllers: Techguard (accounts, ads) and the estate(s) (estate data) → creates estate tasks.
4. Fulfil: export bundle, corrections, deletion/anonymisation honouring legal holds and safety-record retention.
5. Respond within 30 days; record.

## 6. Estate export

- Contents: estate profile, spaces, ownerships, occupancies, residents (contact data), visitor logs, incidents, SOS history, invoices, payments, ledger, maintenance, bookings, documents (files), community (official announcements; resident messages only with legal basis), audit log.
- Format: ZIP of CSV + JSON + files, encrypted, download link valid 7 days, audited.

## 7. API (selection)

| Method         | Path                                                                       | Purpose                |
| -------------- | -------------------------------------------------------------------------- | ---------------------- |
| GET/PUT        | `/v1/platform/feature-flags[/:key]`                                        | Flags                  |
| GET            | `/v1/public/app-config?app=&platform=&version=`                            | Version check          |
| PUT            | `/v1/platform/app-versions/:app/:platform`                                 | Set versions           |
| GET/PUT        | `/v1/platform/providers`                                                   | Provider config        |
| GET/POST/PATCH | `/v1/platform/support-tickets[/:id]`                                       | Tickets                |
| POST           | `/v1/me/support-tickets`                                                   | Users open tickets     |
| POST           | `/v1/platform/support-sessions`                                            | Request access         |
| POST           | `/v1/estates/:estateId/support-sessions/:id/approve` · `/deny` · `/revoke` | Estate decides         |
| GET/POST/PATCH | `/v1/platform/dsr[/:id]`                                                   | Data subject requests  |
| GET/POST       | `/v1/platform/breaches`                                                    | Breach log             |
| POST           | `/v1/estates/:estateId/exports`                                            | Estate requests export |
| GET            | `/v1/platform/reports/overview`                                            | Platform KPIs          |

## 8. Events

`platform.flag.changed`, `platform.support_session.approved`, `platform.support_session.expired`, `platform.dsr.received`, `platform.dsr.completed`, `platform.breach.logged`, `platform.export.ready`.

## 9. Acceptance criteria

- A support session expires automatically and further requests in that estate are denied.
- Changing a feature flag for one estate takes effect within 1 minute without deploy.
- An estate export includes every listed dataset and opens with standard tools.

## 10. Phase 0 implementation notes

Built (`src/modules/platform`): `feature_flags` (default, targeting by estates, apps, minimum version, stable percentage rollout; public flags) and `app_versions`; `GET /v1/public/app-config`, `GET /v1/me/feature-flags`, `GET/PUT /v1/platform/feature-flags[/:key]`, `PUT /v1/platform/app-versions/:app/:platform` (`platform.config`, audited). Flags are cached for 30 seconds per instance.
