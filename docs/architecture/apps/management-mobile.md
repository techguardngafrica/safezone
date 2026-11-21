# Estate Management App — Mobile (`apps/management-mobile`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Mobile lead

## 1. Purpose

The mobile version of the Estate Management App lets estate owners, managers and staff run the estate away from a desk: watch the gates, respond to SOS, approve requests, post announcements, check collections and handle maintenance. It uses the same backend APIs, permissions and business rules as [management-web.md](management-web.md). It is a separate app from the Resident App; a manager who also lives in the estate uses both with one account.

## 2. Users

Estate Owner, Estate Administrator, Estate Manager, Estate Accountant, Facility Manager, Security Supervisor, Maintenance Officer and custom estate roles. The home dashboard and menu are **permission-aware**: each user sees only what their roles allow.

## 3. Platforms and tech

- Android 8+ and iOS 15+.
- Expo (React Native), TypeScript, Expo Router.
- Shares `api-client`, `schemas`, `permissions`, `mobile-ui`, `design-tokens`, `i18n`, `auth` with the other apps.
- Push via Expo Notifications; realtime via Socket.IO for SOS and gate activity.
- Biometric unlock required after the first MFA sign-in on the device.

## 4. What is on mobile vs web

| Area           | Mobile                                                                             | Web only                                  |
| -------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Dashboard      | Yes (permission-aware)                                                             | —                                         |
| Residents      | Lookup, profile, approve/reject join requests, call/message                        | Bulk import, bulk edits                   |
| Property       | Unit info, occupancy, ownership view                                               | Spaces tree editing                       |
| Visitors       | Live gate feed, expected visitors, visitor search                                  | Restricted visitor list admin             |
| Access         | Revoke passes, approve staff passes                                                | Gate configuration                        |
| SOS            | Receive alerts, acknowledge, assign, escalate, resolve                             | Reports and drill planning                |
| Security staff | Shift roster view, attendance today, incident review                               | Roster editing                            |
| Finance        | Collections summary, arrears, payment monitoring, approve waivers and billing runs | Charge setup, reconciliation, accounting  |
| Maintenance    | Queue, triage, assign, update status, photos                                       | SLA config, recurring schedules           |
| Facilities     | Bookings today, approve/reject bookings                                            | Facility setup and pricing                |
| Announcements  | Compose and send (incl. emergency broadcast if permitted)                          | Templates                                 |
| Community      | Moderation queue actions                                                           | Channel administration                    |
| Approvals      | Single inbox for all approvals                                                     | —                                         |
| Reports        | Operational summaries                                                              | Full reports and exports                  |
| Settings       | Notifications, profile, estate switcher                                            | Estate configuration, roles, integrations |

## 5. Scope by phase

| Phase | Features                                                                                                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Sign-in with MFA, estate switcher, dashboard, resident lookup and approvals, visitor monitoring, pass revocation, SOS alerts and response, incidents, announcements, approvals inbox, notifications |
| 2     | Finance overview and approvals, payment monitoring, maintenance management, move-in/move-out approvals                                                                                              |
| 3     | Community moderation, facility bookings                                                                                                                                                             |
| 4     | Vendor approval requests                                                                                                                                                                            |
| 5     | Procurement approvals, staff attendance, governance notices                                                                                                                                         |

## 6. Navigation

Bottom tabs:

1. **Home** — permission-aware dashboard cards: active SOS, gate activity today, pending approvals, open maintenance, collections this month, upcoming bookings.
2. **Approvals** — unified inbox (join requests, tenant approvals, staff passes, waivers, billing runs, bookings, channel requests, purchase requests). Swipe to approve/reject with reason.
3. **Security** — live gate feed, expected visitors, SOS, incidents.
4. **Estate** — residents, units, maintenance, facilities, finance summary.
5. **More** — announcements, moderation, reports, settings.

## 7. Feature detail

### 7.1 SOS response

- Full-screen alert with sound and vibration overriding silent mode (with OS permission), showing: category, unit, resident, map pin, time since trigger.
- Actions: **Acknowledge**, **Assign** (pick guard or supervisor), **Call resident**, **Escalate**, **Add note**, **Resolve**, **Mark false alarm**.
- Escalation timers follow estate policy (default: 60 s next guard, 120 s supervisor and manager, 180 s emergency contacts by voice).
- Status changes broadcast to everyone on the alert in real time.

### 7.2 Visitor monitoring

- Live feed of entries/exits per gate, filter by gate and type.
- Expected visitors today, overstaying visitors (past their window), walk-ins awaiting resident response.
- Search by name, phone, plate, unit.
- Revoke a pass or flag a visitor (adds to estate restricted list after confirmation on web or with permission).

### 7.3 Resident lookup

- Search by name, unit, phone, plate.
- Profile: unit(s), household, vehicles, active passes, balance (if finance permission), open requests.
- Actions: call, message, approve/reject requests.

### 7.4 Finance overview (Phase 2)

- Collections this month vs billed, arrears by age band, recent payments, failed payments.
- Approve billing runs, waivers and refunds (second-approver flows).
- No editing of charges or ledger entries on mobile.

### 7.5 Maintenance (Phase 2)

- Queue with priority and SLA badges.
- Triage, approve/reject, assign staff/vendor, add photos and notes, change status, close.

### 7.6 Announcements

- Compose: title, body, audience (estate, buildings, units, roles), channels (in-app, push, SMS, email), schedule.
- Emergency broadcast (permission-gated, requires confirmation, sends push + SMS to all members).

### 7.7 Community moderation (Phase 3)

- Reported content queue; actions: remove, mute, remove member, suspend channel, dismiss.
- All actions write a moderation audit entry.

## 8. Notifications

| Event                     | Who                                      | Priority         |
| ------------------------- | ---------------------------------------- | ---------------- |
| SOS triggered / escalated | Security supervisor, managers per policy | Critical (sound) |
| Walk-in unanswered        | Security supervisor                      | High             |
| New join request          | Managers                                 | Normal           |
| Approval needed           | Approver                                 | Normal           |
| Payment failure spike     | Accountant                               | Normal           |
| Maintenance SLA breach    | Facility manager                         | Normal           |
| Content reported          | Moderators                               | Normal           |

## 9. Offline behaviour

- Dashboard and last-viewed lists cached for read-only use.
- Approvals and SOS actions need a connection; if offline, the app shows "offline" and, for SOS, a direct-call button to the gate and supervisor.

## 10. Security

- MFA at first sign-in; biometric or device PIN on each open; auto-lock after 5 minutes in background.
- Personal data masked unless the role has `pii.view`.
- Remote sign-out of all devices from web or by Techguard support (with audit).

## 11. Folder structure

```text
apps/management-mobile/
├── app/
│   ├── (auth)/
│   └── (tabs)/
│       ├── home/
│       ├── approvals/
│       ├── security/
│       ├── estate/
│       └── more/
├── src/
│   ├── features/
│   └── lib/
├── app.config.ts
└── eas.json
```

## 12. Testing

Maestro flows: MFA sign-in, approve join request, acknowledge and resolve SOS, revoke pass, approve billing run, assign maintenance, send announcement, moderation action. Run on the device lab before each release.

## 13. Acceptance highlights (Phase 1)

- A manager can acknowledge an SOS from a locked phone in under 10 seconds of receiving the alert.
- The approvals inbox shows every pending item the user can act on, and nothing they cannot.
- Every action is reflected on the web app within 2 seconds.

## 14. Implementation status (21 Nov 2026)

Built:

- **Sign-in and estate**: phone + OTP, then authenticator MFA (shared `SignInFlow`). The app opens only estates the user can manage, the same rule as management-web. The estate switcher lists the last-used estate first, and permissions and features are loaded per estate (`src/lib/manager.tsx`).
- **Home**: active SOS cards, plus tiles for active SOS, waiting approvals, entries today and open incidents. "This month so far" (occupancy, collected against billed, outstanding) needs `report.read`. Also the latest announcements and a notification bell.
- **Approvals**: one inbox for join requests, billing runs awaiting approval, pending waivers and facility bookings awaiting approval. Each source is fetched only with its permission and feature. Approve and reject use in-app confirms, and rejecting needs a reason. These use buttons, not swipes.
- **Security**: live gate feed, expected visitors per gate (with pass revoke and a reason), pending walk-ins, and SOS (active and history). Name, plate or unit search on the gate lists. Incidents list and detail, with notes and review, resolve, reopen and close.
- **SOS response** (§7.1): full-screen red alarm opened by a watcher that polls every 4 s while the app is open, plus Expo push (SOS Android channel at max importance) when an EAS project id is set. Vibration repeats until the alert is acknowledged. The screen offers acknowledge, responding, assign (guard list needs `security.staff.manage`), map, emergency contact calls, notes, resolve, false alarm and close.
- **Estate**: resident lookup. Phone numbers are masked unless the role has `pii.view`, and only then can the resident be called.
- **App lock** (§10, `src/features/app-lock.tsx`, `expo-local-authentication`): asks for biometrics or the phone PIN when a saved session reopens the app, and after 5 minutes in the background. A fresh sign-in does not ask again. The SOS screen is never covered, so an alert can be acknowledged from a locked app. A phone with no screen lock cannot be locked; More shows a notice asking the user to set one. Adding this native module needs a new development build.
- **More**: announcements (list; compose to the whole estate; emergency broadcast with `broadcast.emergency` after a confirmation), notifications centre, estate, account and sign-out.

Differences from this spec, until they are built:

- No **Escalate** or **Call resident** on the SOS screen. Escalation runs on the server's timers, and the alert does not carry the resident's phone number.
- No offline cache for the dashboard or last-viewed lists (§9). Lists show an offline banner. Approvals and SOS actions need a connection.
- Not on mobile yet: the finance overview, maintenance queue, move approvals, moderation queue, overstaying-visitor flag and flag-visitor action, incident assignment, and announcement targeting by building or unit.
- No Maestro flows yet (§12).
