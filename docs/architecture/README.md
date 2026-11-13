# Safezone Architecture

> Safezone by Techguard · Documentation set v0.1 (13 Nov 2026)
> Companion to the Safezone Product Brief v0.2 and PRD v0.2 (in `docs/product/`) and the [Full Implementation Plan](../product/implementation-plan.md).

Safezone is a multi-tenant estate management, security and smart community platform, Nigeria first. This folder holds one document per **app**, one per **backend module**, and the architecture decision records:

```text
docs/architecture/
├── README.md            (this file)
├── apps/                one file per deployable app
├── modules/             one file per backend domain module
└── adr/                 architecture decision records
```

## Confirmed decisions reflected in these docs

- Four primary application surfaces: **Resident App** (Android, iOS), **Estate Management App** (web, Android, iOS), **Security App** (Android, iOS), **Super Admin Portal** (web), plus **Public Web** for visitors, estate sign-up, enquiries and the Vendor Portal.
- **Free estate onboarding**: all core features free at launch; premium features or paid plans may come later through entitlements.
- **Two onboarding workflows**: self-service (apply → Techguard review → approve/reject → workspace) and Techguard-assisted (Techguard creates estate → invites administrator).
- **All advertising revenue goes to Safezone/Techguard**; no estate revenue share.
- **No dedicated vendor app**: vendors use the web Vendor Portal and/or Vendor mode in the Resident App.
- **Advertisers** use the web and/or Advertiser mode in the Resident App.
- **Push** fully managed by Expo Notifications; **email** through Zoho SMTP.
- Pricing is out of scope for now.

## Apps

| App                                 | Folder                   | Doc                                                    |
| ----------------------------------- | ------------------------ | ------------------------------------------------------ |
| Backend API (API, worker, realtime) | `apps/backend-api`       | [apps/backend-api.md](apps/backend-api.md)             |
| Resident App                        | `apps/resident-mobile`   | [apps/resident-mobile.md](apps/resident-mobile.md)     |
| Estate Management App — web         | `apps/management-web`    | [apps/management-web.md](apps/management-web.md)       |
| Estate Management App — mobile      | `apps/management-mobile` | [apps/management-mobile.md](apps/management-mobile.md) |
| Security App                        | `apps/security-mobile`   | [apps/security-mobile.md](apps/security-mobile.md)     |
| Super Admin Portal                  | `apps/super-admin`       | [apps/super-admin.md](apps/super-admin.md)             |
| Public Web                          | `apps/public-web`        | [apps/public-web.md](apps/public-web.md)               |

## Modules

| Module                 | Covers                                                                                      | Phase         | Doc                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| Identity               | Accounts, OTP, MFA, sessions, devices, guard PINs, recovery                                 | 0             | [modules/identity.md](modules/identity.md)           |
| Authorisation          | Roles, permissions, scoped assignments, policy engine                                       | 0             | [modules/authz.md](modules/authz.md)                 |
| Tenancy and onboarding | Estates, lifecycle, both onboarding workflows, settings, memberships, entitlements, imports | 0–1           | [modules/tenancy.md](modules/tenancy.md)             |
| Property               | Spaces tree, units, ownership, transfers                                                    | 1–2           | [modules/property.md](modules/property.md)           |
| Occupancy              | Residents, households, tenancies, staff, vehicles, join requests, move-in/out               | 1–2           | [modules/occupancy.md](modules/occupancy.md)         |
| Visitor                | Passes, QR/PIN, walk-ins, gate events, offline verification                                 | 1             | [modules/visitor.md](modules/visitor.md)             |
| Security               | Gates, guards, devices, shifts, incidents, patrols                                          | 1, 5          | [modules/security.md](modules/security.md)           |
| Emergency              | SOS, escalation, fan-out, drills, broadcasts                                                | 1             | [modules/emergency.md](modules/emergency.md)         |
| Notifications          | In-app, push, SMS, WhatsApp, email, voice                                                   | 0–1           | [modules/notifications.md](modules/notifications.md) |
| Audit                  | Append-only audit trail, hash chain                                                         | 0             | [modules/audit.md](modules/audit.md)                 |
| Platform               | Flags, entitlements framework, versions, providers, support, compliance, exports            | 0–2           | [modules/platform.md](modules/platform.md)           |
| Billing                | Charges, billing runs, invoices, ledger; full accounting later                              | 2, 5          | [modules/billing.md](modules/billing.md)             |
| Payments               | Provider checkout, virtual accounts, webhooks, split settlement, reconciliation, refunds    | 2             | [modules/payments.md](modules/payments.md)           |
| Utilities              | Meters, electricity tokens, bills, estate-run utilities, outages                            | 2             | [modules/utilities.md](modules/utilities.md)         |
| Maintenance            | Requests, complaints, work orders, SLAs, planned maintenance                                | 2             | [modules/maintenance.md](modules/maintenance.md)     |
| Community              | Announcements, channels, messaging, polls, moderation                                       | 1, 3          | [modules/community.md](modules/community.md)         |
| Facilities             | Facilities, availability, bookings, payments, damage                                        | 3             | [modules/facilities.md](modules/facilities.md)       |
| Documents              | File service, document management, expiry                                                   | 0, 3          | [modules/documents.md](modules/documents.md)         |
| Governance             | Policies, meetings, minutes, voting, resolutions                                            | 3, 5          | [modules/governance.md](modules/governance.md)       |
| Marketplace            | Vendors, listings, orders, commission, reviews, disputes                                    | 4             | [modules/marketplace.md](modules/marketplace.md)     |
| Advertising            | Enquiries, advertisers, campaigns, creatives, decisioning, tracking                         | 4, 6          | [modules/advertising.md](modules/advertising.md)     |
| Procurement            | Suppliers, PRs, POs, goods received, inventory, assets                                      | 5             | [modules/procurement.md](modules/procurement.md)     |
| Workforce              | Staff, departments, attendance, leave, payroll export                                       | 1, 5          | [modules/workforce.md](modules/workforce.md)         |
| Devices                | IoT and smart hardware integrations                                                         | 1 (design), 6 | [modules/devices.md](modules/devices.md)             |
| Analytics              | Dashboards, reports, KPIs, product events                                                   | 1–5           | [modules/analytics.md](modules/analytics.md)         |

## Shared conventions

- API paths, errors, pagination, idempotency, versioning: [apps/backend-api.md §6](apps/backend-api.md#6-api-conventions).
- IDs are UUIDv7; money is integer kobo (NGN); times are UTC, shown in WAT.
- Every tenant table carries `estate_id` with PostgreSQL row-level security.
- Events are named `<module>.<entity>.<past-tense-verb>` and flow through the transactional outbox.
- Each module doc has the same sections: responsibility, capabilities, data model, states, rules, API, events, jobs, acceptance criteria and open questions where relevant.

## Status

Draft v0.1 for stakeholder and engineering review. Table and endpoint names are proposals to be finalised in Phase 0 architecture decision records.
