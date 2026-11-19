# Security App (`apps/security-mobile`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Mobile lead

## 1. Purpose

The Security App is the gate and patrol tool for security officers and supervisors. It replaces the paper visitor book, verifies visitor passes (online and offline), records entries and exits, receives and responds to SOS alerts, and logs incidents, shifts and patrols.

It is designed for **shared phones mounted at the gate**, used by guards on rotating shifts, often in poor connectivity and harsh light. Speed and clarity come before everything else.

## 2. Users

| Role                      | Main tasks                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Gate officer              | Verify passes, log walk-ins, record entries/exits, check vehicles                               |
| Security officer (patrol) | Patrol checkpoints, incident reports, respond to SOS                                            |
| Security supervisor       | Everything above, plus shift handovers, guard sign-in management, SOS assignment and escalation |

## 3. Platforms and tech

- Android 8+ (priority; most gate devices) and iOS 15+.
- Expo (React Native), TypeScript.
- Camera QR scanning (`expo-camera`), local SQLite (`expo-sqlite`) for offline cache and sync queue.
- Offline signature check: `@noble/curves` (Ed25519) and `@noble/hashes` (SHA-256 for PIN digests), pure JS so they run in Hermes without a native module. Approved by the product owner on 19 Nov 2026.
- Kiosk mode: Android screen pinning / dedicated device policy where available; app stays foreground.
- Push via Expo Notifications plus a foreground realtime socket for SOS.
- **No advertising anywhere in this app.**

## 4. Device and sign-in model

1. **Device registration** (once, by a supervisor or manager): the device is registered to an estate and a gate using a one-time code from the management app. The API issues a long-lived device credential stored in secure storage.
2. **Guard sign-in** (each shift): guard selects their name or enters staff number, then a 4–6 digit PIN. This starts a shift session on that device.
3. **Shift end**: guard signs out with a handover note; the next guard signs in.
4. Supervisors and managers can **remote sign-out** a guard or **deregister** a device from the management app.
5. Personal phones may be used by patrol officers with normal phone + OTP sign-in plus PIN.

All actions are recorded against both the device and the signed-in guard.

## 5. Scope by phase

| Phase | Features                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Device registration, guard PIN sign-in, expected visitor list for the shift, QR and PIN verification (online and offline), walk-in requests with resident approval, entry/exit logging, vehicle check, delivery and contractor handling, domestic staff passes, SOS receive/acknowledge/respond, incident reports, shift start/end with handover |
| 2     | Move-in/move-out gate notices (furniture, trucks), maintenance contractor passes linked to work orders                                                                                                                                                                                                                                           |
| 5     | Patrol checkpoints (QR/NFC), security company multi-estate assignment, performance reports                                                                                                                                                                                                                                                       |
| 6     | Gate barrier triggers, number-plate recognition events, CCTV event links                                                                                                                                                                                                                                                                         |

## 6. Home screen (gate mode)

Large, high-contrast layout:

- **Scan pass** (primary, largest button)
- **Enter PIN**
- **Walk-in visitor**
- **Expected today** (count badge)
- **Inside now** (visitors currently in the estate)
- **SOS alerts** (red banner when any alert is active)
- **Report incident**
- Connection status (online / offline with pending sync count)
- Signed-in guard name and shift time

## 7. Feature detail

### 7.1 Expected visitor list

- List of passes valid for this gate during the current shift: name, host unit, type, time window, vehicle plate, photo if provided.
- Search by name, plate, unit, PIN.
- Pre-cached on the device at shift start and refreshed every few minutes when online.

### 7.2 Pass verification (QR or PIN)

1. Guard scans QR or types PIN.
2. App validates:
   - **Online**: calls `POST /v1/estates/:estateId/gate/verify` with the token.
   - **Offline**: verifies the token's Ed25519 signature with the estate public key cached on the device, checks validity window, gate, and the local revocation list.
3. Result screen — full-screen colour:
   - **Green — ALLOW**: visitor name, host, unit, type, vehicle, remaining uses.
   - **Amber — CHECK**: e.g. outside time window but within grace period, different gate, vehicle mismatch; guard decides and records a reason.
   - **Red — DENY**: expired, revoked, wrong estate, restricted visitor, used up.
4. Guard taps **Record entry** (with optional photo of visitor/vehicle if the estate requires it).
5. Host resident is notified.
6. On exit, guard scans again or picks from **Inside now** → **Record exit**.

Target: scan to decision in under 3 seconds; full entry recorded in under 20 seconds.

### 7.3 Walk-in visitor

1. Guard enters visitor name, phone (optional), purpose, host unit, vehicle plate, photo (if permitted).
2. App sends an approval request to the host household (push; SMS fallback if configured).
3. Screen shows a countdown (estate timeout, default 3 min).
4. Outcomes: **Approved** → record entry; **Rejected** → deny; **No response** → guard can call the host (masked call or number shown per estate policy) or deny.

### 7.4 Deliveries, contractors, domestic staff, events

- **Delivery**: quick form (company, rider name, plate, host unit); may be pre-approved by resident invite; option to "drop at gate" without entry.
- **Contractor**: linked to a maintenance work order when available; time-boxed.
- **Domestic staff**: recurring passes with photo; days/hours enforced.
- **Event**: guest list for a host; check off guests by name or pass.

### 7.5 Vehicle check

- Search or scan plate (typed in Phase 1); show registered resident vehicles and visitor vehicles expected today.
- Record vehicle entry/exit with optional photo.

### 7.6 SOS

- Incoming SOS shows a full-screen alarm with sound, even if the guard is on another screen.
- Shows: category, unit, resident name, location pin, time since trigger, other responders.
- Actions: **Acknowledge** (claims it), **On my way**, **Call resident**, **Request backup**, **Add note/photo**, **Resolved**, **False alarm**.
- Guards can **trigger SOS** themselves (e.g. attack at the gate).
- If the device is offline, the alarm still arrives by SMS to the gate phone number and the guard can acknowledge by replying with the code (Phase 1 stretch) or by calling the supervisor.

### 7.7 Incidents

- Categories: suspicious activity, unauthorised access attempt, theft, fight, fire, accident, damage, other.
- Fields: description, location (gate, unit, common area), time, people involved (free text), photos/videos, severity.
- Submitted to the security supervisor and managers; statuses: Reported → Under review → Resolved → Closed.
- Evidence files are retained under the incident evidence policy (chain of custody: who uploaded, when, hash of file).

### 7.8 Shifts and handover

- Shift start: guard signs in; app shows handover note from the previous guard, open incidents and visitors inside.
- Shift end: guard writes a handover note; app lists unresolved items.
- Attendance is recorded from sign-in/sign-out times.

### 7.9 Patrols (Phase 5)

- Assigned routes with checkpoints; guard scans checkpoint QR/NFC; missed checkpoints flagged to the supervisor.

## 8. Offline design

| Data on device                                       | Refresh                                         |
| ---------------------------------------------------- | ----------------------------------------------- |
| Estate public key(s) for pass signatures             | At device registration and on rotation          |
| Revocation list (pass ids revoked)                   | Every 2–5 min when online; pushed on revocation |
| Expected passes for this gate (current + next shift) | At shift start and every few minutes            |
| Restricted visitor list (estate)                     | Every 15 min                                    |
| Resident vehicles (plates)                           | Daily                                           |

Sync queue:

- Entries, exits, walk-in records, incidents and attachments are stored locally with a client UUID and timestamp, then sent in order when online (`POST /v1/estates/:estateId/gate/sync`).
- The server deduplicates by client UUID and accepts the device timestamp (with server receive time recorded).
- Walk-in approvals need a connection (or the SMS fallback); offline the guard must call the host.

## 9. Usability rules

- Minimum touch target 56 px; font sizes large; high contrast for sunlight.
- Colour is never the only signal: ALLOW/CHECK/DENY also use icons and words.
- Pidgin and local-language strings planned after pilot.
- Every flow completes in at most 3 taps after scan.
- Works with gloves (no small gestures).

## 10. Security

- Device credential + guard PIN; PIN lockout after 5 wrong attempts (supervisor reset).
- No access to resident financial data, documents or community content.
- Resident phone numbers masked unless estate policy allows guards to see them.
- Screenshots disabled on resident detail screens.
- Device auto-locks to the guard sign-in screen after 10 minutes idle.

## 11. Notifications

| Event                                   | Priority              |
| --------------------------------------- | --------------------- |
| SOS triggered / escalated to this guard | Critical, alarm sound |
| Walk-in approved / rejected             | High                  |
| Pass revoked for an expected visitor    | High                  |
| Supervisor message                      | Normal                |

## 12. Folder structure

```text
apps/security-mobile/
├── app/
│   ├── (device)/            # registration
│   ├── (signin)/            # guard PIN
│   └── (gate)/
│       ├── home/
│       ├── scan/
│       ├── walkin/
│       ├── inside/
│       ├── expected/
│       ├── sos/
│       ├── incidents/
│       └── shift/
├── src/
│   ├── offline/             # sqlite cache, sync queue, signature verify
│   ├── features/
│   └── lib/
├── app.config.ts
└── eas.json
```

## 13. Testing

- Unit tests for offline signature verification and revocation logic (including clock skew).
- Maestro flows: register device, guard sign-in, scan valid/expired/revoked pass, walk-in approve/reject/timeout, SOS acknowledge/resolve, incident with photo, shift handover.
- Field test at a real gate before every Phase 1 release (morning peak, sunlight, poor network).

## 14. Implementation status (19 Nov 2026)

Built: gate home, QR scan and PIN check (online, with the offline signed-pass fallback in `src/offline/`), full-screen ALLOW / CHECK / DENY result with entry, exit, override and refusal recording, sync queue (`gate/sync`), expected list with search (name, plate, unit, PIN), inside now with exit, walk-in request and countdown, vehicle check, SOS alarm (polled every 4 s while open, plus Expo push when an EAS project id is set), SOS response actions, guard-raised SOS, gate settings.

Differences from this spec, until their APIs exist:

- Sign-in is phone + OTP (+ MFA) per person, not device registration plus guard PIN (§4). Idle auto-lock (§10) waits for the PIN sign-in.
- Incidents (§7.7) and shifts and handover (§7.8) have no screens yet.
- **Request backup** and **Call resident** are not offered on the SOS screen: there is no backup endpoint, and guards do not get the resident's number. Emergency contacts on the alert can be called.
- A pass picked from the expected list by name is never stronger than CHECK, because the guard has not seen its QR or PIN.
- Offline entries the server rejects during sync leave the queue, and the home screen shows how many so the guard can tell the supervisor.

## 15. Acceptance highlights (Phase 1)

- With the network off, a valid pass is accepted, a revoked pass (revoked before the last sync) is denied, and all entries sync correctly when the network returns.
- A guard can process a pre-approved visitor in under 20 seconds.
- An SOS alarm sounds on the gate device within 5 seconds of trigger when online.
