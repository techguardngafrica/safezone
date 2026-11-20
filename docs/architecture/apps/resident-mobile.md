# Resident App (`apps/resident-mobile`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Mobile lead

## 1. Purpose

The Resident App is the everyday app for people who live in, own property in, or serve a Safezone estate. It is the main reason most users install Safezone: inviting visitors, raising SOS, paying dues, getting announcements and talking to neighbours.

It also hosts two optional modes for people who are not residents:

- **Vendor mode** — for marketplace vendors to manage listings, orders and payouts (vendors can also use the web Vendor Portal; there is no separate vendor app).
- **Advertiser mode** — for advertisers to submit enquiries and view their campaign reports (advertisers can also use the web).

## 2. Users

| User                              | What they do here                                                   |
| --------------------------------- | ------------------------------------------------------------------- |
| Homeowner (owner-occupier)        | Everything residents do, plus approve tenants and household members |
| Tenant                            | Visitors, SOS, payments, maintenance, community, facilities         |
| Household member                  | What the household head permits (invite visitors, pay, SOS, etc.)   |
| Non-resident property owner       | **Owner mode**: see owned units, tenants, owner charges, approvals  |
| Domestic staff (optional account) | See own pass and schedule                                           |
| Vendor                            | Vendor mode                                                         |
| Advertiser                        | Advertiser mode                                                     |

One account can belong to several estates and hold several roles; the app shows an **estate switcher** when a user has more than one membership.

## 3. Platforms and tech

- Android 8+ and iOS 15+; Android is the priority (device lab of low/mid-range phones).
- Expo (React Native), TypeScript, Expo Router.
- State and data: TanStack Query over the typed `packages/api-client`; Zustand for local UI state.
- Shared packages: `mobile-ui`, `design-tokens`, `schemas`, `permissions`, `i18n`, `auth`.
- Push: Expo Notifications.
- Secure storage: `expo-secure-store` for tokens.
- Maps/location: `expo-location` (used only during an active SOS or when the user taps "share location").
- Target install size < 40 MB; works on 2 GB RAM devices.

## 4. Scope by phase

| Phase | Features                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Sign-up and sign-in, join estate, household, visitor invites, domestic staff passes, SOS, emergency contacts, announcements, notifications, profile, estate switcher, help |
| 2     | Dues and invoices, payments, receipts and statements, electricity tokens and bills, maintenance requests, owner mode, move-in/move-out                                     |
| 3     | Community (building and estate channels, resident channels, private messages), polls, facility bookings, documents                                                         |
| 4     | Marketplace (browse, book, pay, review), vendor mode, advertiser mode, sponsored placements                                                                                |
| 5     | Governance (AGMs, voting, policies), more analytics for owners                                                                                                             |

## 5. Navigation

Bottom tabs (Phase 1 → 4):

1. **Home** — estate status, quick actions (Invite visitor, SOS, Pay), latest announcements, upcoming visitors, sponsored banner (Phase 4).
2. **Visitors** — upcoming, active, history, staff passes.
3. **Pay** (Phase 2) — balance, invoices, utilities.
4. **Community** (Phase 3) — channels, messages.
5. **More** — household, maintenance, facilities, marketplace, documents, settings, help.

A persistent **SOS button** is reachable from every screen (floating action or header), never covered by any other element, including ads.

## 6. Screens and features

### 6.1 Onboarding and account

| Screen           | Details                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Welcome          | Language choice (English first), sign in / get started                                                                 |
| Phone entry      | E.164 phone, country defaults to Nigeria                                                                               |
| OTP              | 6-digit code, auto-read on Android, resend after 30 s, WhatsApp fallback                                               |
| Profile          | Name, photo (optional), email (optional)                                                                               |
| Join estate      | Search estate by name/code, or open an invite link; choose unit; select relationship (owner, tenant, household member) |
| Pending approval | Shows who must approve (owner or manager) and status                                                                   |
| Estate switcher  | List of memberships, last used first                                                                                   |

Rules:

- A user with an invite link skips search and unit selection.
- Until approved, the user sees only the pending screen, help and SOS-free emergency numbers (state numbers, not estate SOS).

### 6.2 Household

- View household members, roles and permissions.
- Invite a member by phone; set permissions: invite visitors, pay, trigger SOS, receive gate alerts, see bills.
- Register vehicles (plate, make, colour, photo).
- Register domestic staff (name, phone, photo, days and hours, gates) → creates a recurring staff pass that needs manager approval if the estate requires it.
- Emergency contacts (name, phone, relationship); consent text shown before saving another person's number.

### 6.3 Visitors

Create invite:

1. Choose type: guest, delivery, contractor, event, ride-hailing.
2. Visitor name and phone (or pick from contacts); multiple visitors allowed.
3. Date/time window: one-time, recurring (days of week), or event (date + guest list).
4. Vehicle plate (optional).
5. Gate(s) allowed.
6. Share: the app sends the pass by SMS or WhatsApp, or the resident shares the link manually.

Pass details:

- QR code, 6-digit PIN, validity, gate, status (scheduled, active, used, expired, revoked).
- Actions: share again, edit window (if not used), revoke.

Walk-in approvals:

- When a guard logs an unexpected visitor, the resident gets a push with photo/name; actions: **Approve**, **Reject**, **Call gate**.
- Timeout (estate-configured, default 3 min) → guard sees "no response".

History: entries and exits with times and gate.

### 6.4 SOS

Flow:

1. Press and hold SOS (or tap then confirm, per accessibility setting).
2. Choose category (security threat, medical, fire, accident, suspicious activity, general) — skippable; defaults to general.
3. Cancellation countdown (estate-configured, default 5 s).
4. Alert sent with GPS location (if permitted), unit and household.
5. Live status screen: Triggered → Acknowledged (by whom) → Assigned → Responding → Resolved.
6. In-app call to the responding guard or the gate.

Rules:

- If the phone has no data, the app offers **SOS by SMS** to the estate's SOS number with a pre-filled code.
- Location is shared only during an active SOS and stops on resolution.
- False alarm: resident can mark "I'm safe / false alarm"; security still closes the incident.
- Drill mode: alerts marked DRILL are visually distinct.

### 6.5 Announcements and notifications

- Official estate announcements are visually distinct (badge, colour) from community messages.
- Categories: general, security, utilities, payments, maintenance, emergency broadcasts.
- Notification centre with filters; per-category push settings (emergency broadcasts cannot be turned off).

### 6.6 Payments (Phase 2)

- Balance per unit, invoices (due, overdue, paid), statements, receipts (PDF).
- Pay by card/bank via provider checkout, or by transfer to the unit's **dedicated virtual account** (shown with copy button).
- Partial payments allowed if the estate permits.
- Utilities: buy electricity tokens (meter number saved), pay water/waste/internet bills where configured; token shown in-app and by SMS.
- Payment confirmation screen shows only after server-side verification; no ads on this screen.

### 6.7 Maintenance (Phase 2)

- New request: category, description, location (unit or common area), photos/videos, preferred time.
- Track status: Submitted → Under Review → Approved → Assigned → In Progress → Awaiting Materials → Resolved → Closed (or Rejected).
- Comment thread with management; rate the work after resolution.

### 6.8 Owner mode (Phase 2)

For property owners (resident or not):

- Owned units, current occupants, tenancy dates.
- Approve or decline tenant and household requests.
- Owner-billed charges and payments.
- Notifications on move-in/move-out.

### 6.9 Community (Phase 3)

- Channel list: my buildings, estate channels, resident channels, direct messages.
- Building channels appear automatically from active occupancy.
- Create a channel (if estate allows): name, description, public/restricted/invite-only; may need approval.
- Messages: text, images, files, reactions, replies; report, mute, block user.
- Polls (Phase 3), voting (Phase 5).
- Private messaging only if the estate has enabled it.

### 6.10 Facilities (Phase 3)

- Browse facilities, see availability calendar, rules and price.
- Book a slot; pay if required; get approval if required; cancel within policy.
- Report damage with photos.

### 6.11 Documents (Phase 3)

- Estate documents shared with residents (rules, constitution, notices).
- Personal documents (tenancy agreement, receipts) with expiry reminders.

### 6.12 Marketplace (Phase 4)

- Browse categories (cleaning, plumbing, electrical, laundry, gas, internet, food, etc.); only vendors approved by the estate.
- Service detail, price, availability, reviews.
- Book/order, pay, track, chat with vendor, rate and review, raise dispute.

### 6.13 Vendor mode (Phase 4)

Switch via profile → "Vendor mode" (only for users with vendor roles):

- Orders inbox (new, accepted, in progress, done), accept/decline, update status.
- Listings: edit price and availability.
- Payouts summary.
- Staff assignment (for vendor employees).
  Full vendor management is in the web Vendor Portal (see [public-web.md](public-web.md)).

### 6.14 Advertiser mode (Phase 4)

- Submit an advertising enquiry (objectives, budget range, duration, audience, placements).
- Track enquiry status.
- View campaign status and performance report (own campaigns only).

### 6.15 Sponsored content (Phase 4)

- Placements: Home banner, community feed sponsored post, marketplace banner, service discovery.
- Every ad labelled **Sponsored**.
- Never shown on: SOS screens, visitor pass and approval screens, payment confirmation, onboarding.
- Respects estate opt-outs, frequency caps and the user's ad-personalisation consent.

## 7. Permissions in the app

The app reads the user's permissions from `GET /v1/me/memberships` and hides actions the user cannot perform. The API enforces the same rules.

| Action           | Owner-occupier   | Tenant              | Household member | Non-resident owner   |
| ---------------- | ---------------- | ------------------- | ---------------- | -------------------- |
| Invite visitor   | Yes              | Yes                 | If permitted     | No                   |
| Trigger SOS      | Yes              | Yes                 | If permitted     | No                   |
| Pay dues         | Yes              | Yes                 | If permitted     | Owner-billed charges |
| Approve tenant   | Yes              | No                  | No               | Yes                  |
| Manage household | Yes              | Yes (own household) | No               | No                   |
| Create channel   | If estate allows | If estate allows    | If estate allows | No                   |

## 8. Offline and poor connectivity

- Cached: profile, memberships, active passes (QR rendered offline), emergency contacts, last 50 announcements.
- Queued for retry: visitor invites, maintenance requests, messages (marked "sending").
- SOS: SMS fallback when the API is unreachable.
- Payments are never queued offline.

## 9. Notifications

| Event                          | Channel              | Can user disable?                 |
| ------------------------------ | -------------------- | --------------------------------- |
| Visitor arrived / left         | Push                 | Yes                               |
| Walk-in approval request       | Push (high priority) | No (if user receives gate alerts) |
| SOS updates (own)              | Push + realtime      | No                                |
| Estate emergency broadcast     | Push + SMS           | No                                |
| Invoice issued / due / overdue | Push, email          | Yes (push only)                   |
| Payment received               | Push, email          | No                                |
| Maintenance status             | Push                 | Yes                               |
| Community mentions / DMs       | Push                 | Yes                               |
| Booking approved/cancelled     | Push                 | Yes                               |

## 10. Security and privacy

- Tokens in secure storage; biometric unlock option for the app.
- Screenshots allowed except on payment card screens (provider checkout handles card entry).
- Phone numbers of other residents hidden unless shared by the user.
- Location only during active SOS.
- Ad personalisation off by default; consent toggle in settings.
- Account deletion request in settings (handled per data retention rules).

## 11. Analytics events (examples)

`app_opened`, `signup_completed`, `estate_join_requested`, `visitor_invite_created`, `visitor_pass_shared`, `walkin_approved`, `sos_triggered`, `sos_cancelled`, `payment_started`, `payment_succeeded`, `maintenance_request_created`, `channel_message_sent`, `booking_created`, `marketplace_order_placed`, `ad_impression`, `ad_click`.

Events carry no personal data beyond user id and estate id.

## 12. Folder structure

```text
apps/resident-mobile/
├── app/                      # Expo Router routes
│   ├── (auth)/               # welcome, phone, otp, profile
│   ├── (tabs)/
│   │   ├── home/
│   │   ├── visitors/
│   │   ├── pay/
│   │   ├── community/
│   │   └── more/
│   ├── sos/
│   ├── vendor/               # vendor mode
│   └── advertiser/           # advertiser mode
├── src/
│   ├── features/             # one folder per feature (hooks, components, screens)
│   ├── lib/                  # api client setup, push, storage, location
│   └── providers/
├── assets/
├── app.config.ts
└── eas.json
```

## 13. Testing

- Unit tests for hooks and utilities.
- Maestro flows: sign-up, join estate, invite visitor, approve walk-in, SOS trigger and cancel, pay invoice, create maintenance request.
- Device lab runs on low-end Android + one iPhone per release; poor-3G and offline checks.

## 14. Release

- EAS Build for store releases every two weeks; EAS Update (OTA) for JS-only fixes.
- Staged rollout: 10% → 50% → 100% over 3 days, halted on crash-free sessions < 99.5%.
- Forced update when the API's minimum version for the app is above the installed version.

## 15. Acceptance highlights (Phase 1)

- A new resident can sign up, request to join and be approved in under 3 minutes of user time.
- A visitor invite can be created and shared in under 30 seconds.
- SOS reaches the security team in under 5 seconds on a normal 4G connection.
- The SOS button is visible and usable on every screen.

## Implementation note: prepaid tokens (20 Nov 2026)

[ADR-0018](../adr/0018-prepaid-token-purchases.md): **Buy token** on a verified prepaid DisCo meter (Utilities), quick amounts or a custom whole-naira amount within the API's limits, checkout on Safezone's account, then the purchase screen, which checks the payment through the API until it is verified and the token is vended. The token is shown only then, selectable and shareable; failures show the refund note. Recent tokens are listed under Utilities. Returning from checkout uses `safezone://utilities/return`. While no aggregator is configured the API reports purchases as unavailable and the screen says so.
