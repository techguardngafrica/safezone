# Estate Management App — Web (`apps/management-web`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Web lead

## 1. Purpose

The web version of the Estate Management App gives estate owners, managers and staff the full management experience: configuration, property and resident administration, finance, security oversight, maintenance, facilities, community moderation, documents and reporting. It is the most complete management surface; the mobile version ([management-mobile.md](management-mobile.md)) covers on-the-go tasks with the same backend and permissions.

## 2. Users and roles

| Role                 | Typical use                                                    |
| -------------------- | -------------------------------------------------------------- |
| Estate Owner         | Full access, appoints administrators, sees all reports         |
| Estate Administrator | Configuration, users, roles, all modules                       |
| Estate Manager       | Day-to-day operations, approvals, announcements                |
| Estate Accountant    | Charges, invoices, payments, reconciliation, financial reports |
| Facility Manager     | Facilities, maintenance, assets                                |
| Security Supervisor  | Gates, guards, shifts, visitor logs, incidents, SOS console    |
| Maintenance Officer  | Work orders assigned to them                                   |
| Procurement Officer  | Purchase requests, suppliers, inventory (Phase 5)              |
| Custom roles         | Built by the estate from the permission catalogue              |

Permissions come from [authz.md](../modules/authz.md). The UI hides what a role cannot do; the API enforces it.

## 3. Tech

- Next.js (App Router), React, TypeScript.
- Data: TanStack Query over `packages/api-client`; server components only for static shells (all data is per-user and per-estate).
- UI: `packages/web-ui` + `design-tokens`; data tables with server-side pagination, filters and CSV export.
- Realtime: Socket.IO client for SOS console, gate activity and dashboards.
- Auth: same identity service; web sessions use httpOnly secure cookies holding the refresh token; MFA required for staff.
- Browsers: last 2 versions of Chrome, Edge, Safari, Firefox; usable from 1280 px down to tablet width.

## 4. Scope by phase

| Phase | Areas                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Setup wizard, estate configuration, spaces tree, bulk import, residents and households, approvals, staff and guards, gates, visitor logs, SOS console, incidents, announcements, basic reports, audit log, support access consent |
| 2     | Charges, billing runs, invoices, payments and reconciliation, utilities, maintenance and work orders, owner records, move-in/move-out, financial approvals, data export                                                           |
| 3     | Community management and moderation, polls, facilities and bookings, documents                                                                                                                                                    |
| 4     | Vendor approvals for the estate, ad category opt-outs                                                                                                                                                                             |
| 5     | Full accounting, procurement and inventory, staff and HR, governance, security companies, advanced analytics                                                                                                                      |

## 5. Navigation

Left sidebar (items shown by permission and entitlement):

1. **Dashboard**
2. **Estate** — profile, configuration, spaces, gates
3. **People** — residents, households, owners, staff, roles
4. **Visitors & Security** — live gate, visitor log, guards, shifts, patrols, incidents, SOS console
5. **Finance** — charges, invoices, payments, reconciliation, utilities, reports (Phase 2); accounting (Phase 5)
6. **Operations** — maintenance, work orders, facilities, procurement, inventory
7. **Community** — announcements, channels, moderation, polls
8. **Documents**
9. **Governance** (Phase 5)
10. **Marketplace** — approved vendors (Phase 4)
11. **Reports**
12. **Settings** — notifications, policies, integrations, audit log, data export

Top bar: estate switcher (for multi-estate managers), global search (residents, units, plates, passes), notifications, profile.

## 6. Feature detail

### 6.1 Setup wizard (first login after approval)

Shown to the first administrator after the estate is approved (self-service) or invited (Techguard-assisted):

1. Confirm estate profile (name, address, location pin, logo, contact).
2. Define the spaces tree (phases, zones, streets, blocks, buildings, units) — manually or by import.
3. Add gates (name, type: pedestrian/vehicle, hours).
4. Invite management staff and assign roles.
5. Register security supervisor and guards; register gate devices.
6. Set visitor and SOS policies (approval rules, pass limits, cancellation countdown, escalation).
7. Import residents (or send invite links).
8. Review and go live.

Progress is saved per step; the dashboard shows a setup checklist until complete.

### 6.2 Estate configuration

- Profile, branding (logo, colour), timezone (WAT), currency (NGN).
- Policies: tenant approval (owner, manager, both), visitor pass max duration, walk-in approval timeout, domestic staff approval, SOS countdown and escalation, community settings (private messaging on/off, channel approval), ad category opt-outs (Phase 4).
- Modules on/off within the free core plan (entitlements).

### 6.3 Spaces (property tree)

- Tree editor with drag-and-drop; types: phase, zone, street, block, building, floor, unit.
- Unit fields: code, type (house, flat, shop, office), bedrooms, size, status (occupied, vacant, under construction).
- Bulk create (e.g. "Block C, floors 1–5, flats A–D").
- History per unit (ownership, occupancy, charges).

### 6.4 Bulk import

- Templates (XLSX/CSV) for units, owners, residents, households, vehicles, opening balances.
- Upload → validation → dry-run report (errors per row) → confirm → import job → result report.
- Imports are idempotent by external reference; re-running updates rather than duplicates.
- The import runs in the worker; the screen polls the job and shows created, updated, unchanged and failed rows ([ADR-0020](../adr/0020-import-execution-support-enforcement-role-grants.md)).

### 6.5 People

- Residents list with filters (unit, status, type, building); profile with memberships, household, vehicles, passes, payments, requests, audit trail.
- Join requests queue: approve, reject (with reason), request more info.
- Owners: ownership records, shares, evidence documents, transfers.
- Move-in / move-out wizard (Phase 2): dates, deposit/balance check, access revocation, channel removal.
- Staff: profiles, roles, departments, shifts (security staff in Security).
- Roles: built-in roles and custom roles from the permission catalogue; temporary permissions with expiry.

### 6.6 Visitors & Security

- **Live gate view**: entries/exits in real time per gate, expected visitors today, walk-ins awaiting approval.
- **Visitor log**: search by name, phone, plate, unit, date; export.
- **Restricted visitors** (estate-only blacklist) with reason and expiry.
- **Guards**: profiles, gate assignments, PINs (reset), devices.
  - Built (19 Nov 2026, [ADR-0017](../adr/0017-gate-devices-and-guard-pin-sessions.md)): **Guards** (`/security/guards`, `security.staff.manage`): name, phone (masked without `pii.view`), role, gate PIN status, open shift, and **Reset PIN** with confirmation. **Gate devices** (`/security/devices`, `gate.device.manage`): name, gate, status, last seen, registered, and **Deregister** with confirmation. Phones are registered from the Security App, not here. Profiles and gate assignments are not built.
- **Shifts and patrols**: rosters, attendance, checkpoints, patrol logs, handover notes.
- **Incidents**: reports from guards and residents, categories, attachments, assignment, resolution, export for police.
- **SOS console**: live map/list of active alerts, timer since trigger, acknowledgement and assignment, escalation status, notes, resolution; drill mode; SOS history and response-time reports.

### 6.7 Finance (Phase 2)

- **Charges**: dues, service charge, security levy, development levy, utility charges, special assessments; amount, frequency, applicable spaces/unit types, who pays (occupant or owner), penalties, discounts.
- **Billing runs**: preview → approve (two-level if configured) → issue; per-unit invoices; reminders schedule.
- **Invoices**: list, detail, adjust (credit note), waive (with approval), resend.
- **Payments**: online, virtual-account transfers, manual (cash/cheque with evidence and approval); allocation to invoices.
- **Reconciliation**: auto-matched vs unmatched transactions, manual match, settlement reports from the provider.
- **Utilities**: meters, utility providers, consumption records, outage announcements.
- **Reports**: collections, arrears ageing, revenue by charge, payment methods.
- Full accounting (Phase 5): chart of accounts, journals, payables, bank reconciliation, budgets, periods, statements.

### 6.8 Operations

- **Maintenance**: request queue with filters; triage (category, priority); approve/reject; create work order; assign staff or vendor; schedule; track materials and cost; resolution notes; resident feedback; SLA timers; recurring maintenance.
- **Facilities** (Phase 3): registration, rules, pricing, calendar, booking approvals, cancellations, damage reports, utilisation.
- **Procurement & inventory** (Phase 5): see [procurement.md](../modules/procurement.md).

### 6.9 Community (Phase 3)

- Announcements composer: audience (estate, buildings, specific units, roles), channels (in-app, push, SMS, email), schedule, attachments; emergency broadcast option (permission-gated).
- Channels: create official channels, review resident-created channel requests, assign moderators.
- Moderation queue: reported messages, actions (remove, mute user, remove from channel, suspend channel), audit log, appeals.
- Polls: create, target, results.

### 6.10 Documents (Phase 3)

- Folders by category; permissions (managers only, all residents, specific roles, a unit).
- Versioning, expiry reminders, access history.

### 6.11 Marketplace (Phase 4)

- Browse platform vendors serving the estate's area; approve or block per estate (`/[estateId]/marketplace`, `marketplace.moderate`).
- See orders volume and disputes involving the estate's residents (no vendor financials).

### 6.12 Reports and dashboard

Dashboard widgets (by permission): occupancy, residents onboarded, visitors today, open incidents, active SOS, collections this month, arrears, open maintenance, SLA breaches, community activity.

Reports: occupancy, resident registration, visitor/gate activity, incidents, SOS response times, revenue, outstanding invoices, reconciliation, maintenance performance, facility utilisation, staff attendance, community engagement. All exportable (CSV/XLSX/PDF).

### 6.13 Settings

- Notification templates and sender preferences (where the estate can customise wording).
- Integrations (Phase 2+: estate's payment subaccount status; Phase 6: devices).
- **Support access**: approve/deny Techguard support "view as" requests; see history.
- **Audit log**: filter by actor, action, resource, date.
- **Data export**: request a full estate export (Phase 2).

## 7. Cross-cutting UI rules

- Every destructive or financial action asks for confirmation and, where configured, a second approver.
- Every list has filters, saved views and export.
- Tables paginate server-side; nothing loads all rows.
- Masked personal data (phone, ID numbers) unless the role has `pii.view`.
- No ads on the management web app except the optional, clearly labelled informational area on the dashboard (if enabled by Techguard and the estate).

## 8. Security

- MFA required for all staff roles.
- Session timeout after 30 minutes idle (configurable down to 10).
- Content Security Policy, no third-party scripts except monitoring.
- All exports watermarked with user and time; export actions audited.

## 9. Folder structure

```text
apps/management-web/
├── app/
│   ├── (auth)/
│   ├── [estateId]/
│   │   ├── dashboard/
│   │   ├── estate/
│   │   ├── people/
│   │   ├── security/
│   │   ├── finance/
│   │   ├── operations/
│   │   ├── community/
│   │   ├── documents/
│   │   ├── governance/
│   │   ├── marketplace/
│   │   ├── reports/
│   │   └── settings/
│   └── onboarding/          # setup wizard
├── src/
│   ├── features/
│   ├── components/
│   └── lib/
└── next.config.ts
```

## 10. Testing

- Component tests for complex forms (charges, billing runs, roles).
- Playwright E2E: setup wizard, import, approve resident, live gate view, SOS console acknowledge/resolve, billing run and payment, maintenance work order, moderation action. Specs live in `apps/management-web/e2e/`; how to run them is in [docs/operations/e2e-tests.md](../../operations/e2e-tests.md).
- Accessibility checks (axe) in CI on key pages.

## 11. Acceptance highlights (Phase 1)

- An approved estate can complete setup (spaces, gates, staff, guards, policies) in one sitting with the wizard.
- A 500-unit import with 2% bad rows produces a clear error report and imports the rest.
- The SOS console shows a new alert within 2 seconds of trigger and plays an audible alarm.
