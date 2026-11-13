# Safezone Super Admin Portal (`apps/super-admin`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Web lead

## 1. Purpose

The Super Admin Portal is Techguard's internal web app for running the whole Safezone platform: onboarding and managing estates, managing platform users and access, vendors and advertisers, advertising campaigns and revenue, support, compliance, audit and platform health.

It is the only surface that can act **across estates**. Every cross-tenant action is authorised by platform roles, requires a reason where it touches estate data, and is written to the audit log.

## 2. Users and platform roles

| Role                        | Can do                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| Super Admin                 | Everything, including platform roles and settings                             |
| Platform Administrator      | Estates, users, vendors, configuration (not platform roles)                   |
| Platform Support Agent      | Support tickets, user lookup, "view as" with estate consent, account recovery |
| Platform Finance Officer    | Transactions, settlements, refunds, ad invoices, revenue reports              |
| Platform Operations Officer | Onboarding operations, provider status, queues, incidents                     |
| Platform Compliance Officer | Data subject requests, DPIA records, retention, breach log, ARCON records     |
| Advertising Manager         | Advertisers, enquiries, proposals, campaigns, inventory                       |
| Advertising Reviewer        | Creative and campaign review/approval                                         |

## 3. Tech

- Next.js (App Router), TypeScript, `packages/web-ui`.
- Hosted on its **own domain**, behind company SSO, with an IP allowlist and TOTP/hardware-key MFA.
- Calls only `/v1/platform/*`, `/v1/vendors/*`, `/v1/advertisers/*` endpoints (platform roles).
- No public sign-up; accounts created by a Super Admin.

## 4. Scope by phase

| Phase | Areas                                                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1   | Estate applications (self-service), Techguard-assisted estate creation, approval/rejection, activation/suspension, platform users, support tickets, support access, audit log, feature flags and entitlements, provider status, app version config |
| 2     | Platform transactions and settlement monitoring, refunds and disputes oversight, estate data exports and offboarding, plans and entitlements framework (all estates on the free core plan)                                                         |
| 3     | Platform-wide moderation escalations, content policy                                                                                                                                                                                               |
| 4     | Vendors (verification, approval, suspension, commissions), advertisers, enquiries, proposals, campaigns, creative review, placements inventory, ad invoices and payments, ad revenue and performance reports                                       |
| 5     | Security companies, property management companies (multi-estate organisations)                                                                                                                                                                     |
| 6     | Advertiser self-service oversight, partner API keys, IoT device fleet                                                                                                                                                                              |

## 5. Navigation

1. **Overview** — platform KPIs and health
2. **Estates** — applications, all estates, onboarding pipeline
3. **Users** — platform-wide user lookup, platform staff
4. **Vendors** (Phase 4)
5. **Advertising** (Phase 4) — enquiries, advertisers, campaigns, review queue, inventory, invoices, reports
6. **Transactions** (Phase 2)
7. **Support** — tickets, support access sessions
8. **Compliance** — data subject requests, retention, breaches, DPIA, ARCON approvals
9. **Platform** — feature flags, entitlements and plans, app versions, providers, templates, settings
10. **Audit** — platform audit log
11. **Health** — queues, error rates, SOS synthetic checks, provider delivery rates

## 6. Feature detail

### 6.1 Estate onboarding

Two workflows, both supported:

**Self-service applications**

1. Applications queue (from public-web sign-up): estate details, representative, documents.
2. Review: check documents, call the representative, check for duplicates (same address/name).
3. Decision: **Approve** (estate workspace created, representative becomes Estate Administrator, welcome email via Zoho SMTP and SMS) or **Reject** (with reason) or **Request more information**.

**Techguard-assisted onboarding**

1. Create estate record manually.
2. Enter initial estate information (profile, address, gates, optionally spaces via import).
3. Invite the estate representative as administrator (SMS + email invite link).
4. Representative signs in, verifies access, completes setup.

Estate statuses: `applied → under_review → (info_requested) → approved → active → suspended → deactivated`, or `rejected`.

Onboarding pipeline board: estates by stage (applied, approved, setup in progress, live), owner on the Techguard side, days in stage.

### 6.2 Estates

- List and search; filters by status, state/city, size, go-live date.
- Estate detail: profile, administrators, unit and resident counts, active modules, health (SOS drills, gate usage, payment adoption), support history, audit trail.
- Actions: suspend (with reason; safety features keep working), reactivate, deactivate, change entitlements, transfer ownership of the estate admin role, start offboarding/export.
- All estates are on the **free core plan** at launch; the plans framework exists for future premium features.

### 6.3 Users

- Platform-wide lookup by phone, email, name, user id.
- See memberships across estates (names only, not estate data, unless in a support session).
- Actions: lock/unlock account, force sign-out on all devices, reset MFA (with identity check), merge duplicate accounts.
- Platform staff management: invite, assign platform roles, require MFA, deactivate.

### 6.4 Support

- Tickets from in-app help, WhatsApp support line and email; SLA timers (gate/SOS issues: 1 hour first response; others: 1 working day).
- **Support access ("view as")**: agent requests access to an estate with a reason; the estate administrator approves (or the request is auto-approved for a declared emergency, with alert to the estate); access is time-limited (default 2 hours), read-only by default, and every action is audited and visible to the estate.

### 6.5 Vendors (Phase 4)

- Vendor applications, verification (business documents, identity, bank details through provider subaccount), approval, suspension.
- Service categories and areas.
- Commission configuration per category or vendor.
- Vendor performance and disputes.

### 6.6 Advertising (Phase 4)

- **Enquiries**: from public-web and the Resident App; statuses Submitted → Under Review → Awaiting Information → Proposal Sent → Negotiation → Approved / Rejected → Converted to Campaign.
- **Advertisers**: individual or organisation records, verification, contacts and account managers, agreements, billing history, suspension.
- **Proposals**: placements, schedule, audience, price (set by Techguard), terms.
- **Campaigns**: Draft → Submitted → Under Review → Awaiting Payment → Approved → Scheduled → Active → Paused → Completed (or Rejected, Cancelled).
- **Review queue**: creatives with preview per placement, destination URL check, policy checklist, **ARCON approval reference** (required field), approve/reject/request revision.
- **Inventory**: placements with dimensions, formats, eligible advertiser categories, targeting options, availability, frequency limits.
- **Invoices and payments**: quotation, invoice, payment verification (server-side), receipts, refunds.
- **Reports**: impressions, clicks, CTR, reach estimates, by placement, estate and audience segment; advertiser-facing PDF report generation.
- All ad revenue is Safezone/Techguard revenue; there is no estate revenue share.

### 6.7 Transactions (Phase 2)

- All payment transactions across estates (amount, estate, type, provider, status), with drill-down.
- Settlement checks against provider reports; failed and stuck payments; disputes and refunds oversight.
- Platform revenue reports (marketplace commission, ad revenue, transaction fees if introduced later).

### 6.8 Compliance

- Data subject requests: intake, identity check, tasks per estate (estate is controller for estate data), 30-day clock, response record.
- Retention schedule view and purge job reports.
- Breach log and 72-hour notification workflow.
- DPIA records and data processing agreements per estate.
- ARCON approval records for campaigns.

### 6.9 Platform configuration

- Feature flags (global, per estate, per app version).
- Plans and entitlements (core plan = all core features free; premium modules can be defined later).
- App version config (minimum and recommended versions per app/platform).
- Providers: active provider per category, failover order, status, credentials reference (secrets live in the vault, never displayed).
- Notification templates (platform defaults).
- Prohibited/restricted ad categories.

### 6.10 Health

- Queue depths and dead-letter queues, error rates, p95 latency, SOS synthetic check history, SMS/WhatsApp/push delivery rates per provider, payment webhook lag, realtime connections.

## 7. Security rules

- Platform roles never bypass audit; reading estate personal data requires a support session or a compliance task.
- Bulk exports require Super Admin approval and are watermarked.
- Sessions expire after 15 minutes idle.
- Four-eyes approval for: estate deactivation, platform role grants, refunds above a threshold, account merges.

## 8. Folder structure

```text
apps/super-admin/
├── app/
│   ├── overview/
│   ├── estates/
│   ├── users/
│   ├── vendors/
│   ├── advertising/
│   ├── transactions/
│   ├── support/
│   ├── compliance/
│   ├── platform/
│   ├── audit/
│   └── health/
├── src/
└── next.config.ts
```

## 9. Testing

Playwright: approve and reject an application, assisted estate creation and admin invite, suspend/reactivate, support access request and expiry, campaign review and activation, refund with four-eyes approval, data subject request flow.

## 10. Acceptance highlights

- An estate application can be reviewed and approved in under 10 minutes when documents are complete.
- A Techguard-assisted estate can be created and its administrator invited in under 15 minutes.
- No platform user can see estate personal data without a support session or compliance task, and every such view appears in the estate's audit log.
