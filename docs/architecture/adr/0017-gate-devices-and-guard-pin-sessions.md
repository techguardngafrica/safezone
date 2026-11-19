# ADR-0017: Gate devices and guard PIN shift sessions

- **Status:** Proposed
- **Date:** 2026-11-19
- **Deciders:** Sunday Etom Eni
- **Affects:** identity, security, authz guard, `packages/auth`, `packages/permissions`, security-mobile, management-web (device list)

## Context

security-mobile.md §4 and identity.md §5.3 want shared gate phones: a device is registered once to an estate and a gate, then guards on rotating shifts sign in on it with a 4 to 6 digit PIN. Today every guard signs in with their own phone number, an SMS code and an authenticator app, which does not work on a phone mounted at a gate and handed from guard to guard.

Constraints:

- AGENTS.md §6.1: PINs hashed with Argon2id; brute force, enumeration and replay protection; no Passport.
- ADR-0007: access tokens carry only `sub`, `sid`, `app`; every request checks the session is live; MFA state lives on the session and is required for any staff role.
- A shared device in a public place can be picked up by anyone. Whatever it holds must give the least possible access.
- Gate checks must keep working offline (security-mobile.md §8). SOS must never wait on sign-in.

## Options considered

**Registering a device**

| Option                                                                                           | Pros                                                          | Cons                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A. A supervisor signs in on the gate phone (phone, SMS code, MFA) and taps "Register this phone" | Nothing to copy between devices; works with what exists       | The supervisor's own sign-in touches a shared phone (ended right after)            |
| B. A manager makes a one-time code in management web; the gate phone redeems it                  | Matches the spec; the supervisor never signs in on the device | Needs a new management web page first; codes can be shoulder-surfed (short expiry) |

**How a guard says who they are**

| Option                                                                             | Pros                     | Cons                                                       |
| ---------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| A. Pick from a list of the estate's guards (first name and last initial), then PIN | Fast, works with gloves  | Shows a short staff list to whoever holds the device       |
| B. Type a staff number, then PIN                                                   | Nothing listed on screen | Needs `security_personnel` records and staff numbers first |

**Offline shift change**

| Option                                                                   | Pros                        | Cons                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| A. PIN sign-in needs a connection; a running shift keeps working offline | No PIN hashes on the device | A guard arriving during an outage cannot sign in until the network returns                               |
| B. Keep a PIN verifier on the device and check offline (chosen)          | Sign-in always works        | A 6-digit PIN verifier can be guessed offline by anyone who extracts it; needs the safeguards in point 6 |

## Decision

Chosen on 19 Nov 2026: registration option A, guard picking option A, offline option B (with the safeguards in point 6), and `@node-rs/argon2`. The rest are recommendations awaiting approval with this ADR.

1. **Gate devices** live in identity as `tenant.gate_devices` (`estate_id`, `gate_id`, `name`, `credential_hash`, `registered_by`, `status`, `last_seen_at`, `revoked_at`), RLS on. Registration is option A for Phase 1 (`POST /v1/estates/:estateId/gate-devices`, permission `gate.device.manage`). The response carries a 32-byte random device credential, shown once and stored in the device keychain; the server keeps only its HMAC-SHA256. The supervisor's own session on that phone is signed out as part of registration. Management web lists and deregisters devices (`DELETE …/gate-devices/:id`), which revokes every shift session on it at once. Option B can be added later on the same table.
2. **Guard PINs** live in `tenant.guard_pins` (`estate_id`, `user_id`, `pin_hash` Argon2id, `failed_attempts`, `locked_at`, `set_at`). A guard sets their own PIN once, after a normal phone, SMS code and MFA sign-in (on their own phone or on the gate phone before it is registered). A supervisor reset (`POST …/guards/:userId/pin-reset`, `security.staff.manage`) clears it so the guard sets a new one. PINs are 6 digits; obvious ones (000000, 123456, the same digit six times) are refused.
3. **Sign-in** is `POST /v1/auth/gate/signin { deviceCredential, userId, pin }` (option A for picking the guard; the list comes from `GET /v1/auth/gate/guards` with the device credential, first name and last initial only). On success it creates a normal `sessions` row with new columns `kind = 'gate_shift'`, `gate_device_id`, `scope_estate_id`, and a hard 12-hour expiry, and starts the shift (security.md shift sessions). There is no refresh token: after 12 hours, or at shift end, the guard signs in again.
4. **Scope ceiling.** Device credential plus PIN counts as two factors, so the session is marked MFA-satisfied, but only inside a ceiling: the authorization guard limits a `gate_shift` session to its own estate and to the permissions `gate.verify`, `incident.report`, `sos.trigger` and `sos.respond`, whatever other roles the guard holds. A supervisor who needs more signs in on their own phone.
5. **Lockout and abuse.** 5 wrong PINs lock that guard's PIN until a supervisor resets it (rule from security-mobile.md §10), with `identity.pin.locked` audited and the supervisor notified. Per device, 20 failed sign-ins in 10 minutes block the device for 10 minutes. Wrong guard and wrong PIN give the same error.
6. **Offline sign-in** (option B), with safeguards because a 6-digit PIN has only a million values:
   - Only guards who have signed in **online on this device** in the last 7 days can sign in offline. At each online sign-in the server returns an offline verifier for that guard: Argon2id of the PIN with a per-guard salt and a high work factor (about half a second on a low-end phone). The app wraps it with a key held in the phone's hardware keystore (Android Keystore, iOS Keychain through SecureStore) before storing it, so copying the app's files is not enough; the keystore key would also have to be extracted.
   - The verifier expires after 7 days, is dropped on PIN reset, lockout or deregistration (at the next sync), and is never sent anywhere else.
   - 5 wrong offline PINs for a guard wipe that guard's verifier on the device; they must then sign in online.
   - An offline sign-in grants **local gate mode only**: pass checks against the cached list and queued entries and exits. It cannot reach the API. Queued events record the claimed guard and are marked `offline_signin`; they sync through the device credential when the network returns and show in the visitor log flagged for the supervisor to review. The guard is then asked for their PIN again to get a normal online session.
   - SOS raising and the alarm never wait on any sign-in.
   - **Remaining risk, accepted by the product owner:** someone who steals a gate phone and extracts its keystore key could guess a guard's PIN offline in hours. They would get local gate mode on that stolen phone only (no API access, no other estate, no resident data beyond the cached 24-hour expected list), and deregistering the device stops its sync. A stolen device must be deregistered at once.
7. **Idle lock.** After 10 minutes without a touch the app returns to the guard picker. The session stays alive (so queued entries keep syncing and SOS alarms still ring); unlocking needs the same guard's PIN again, which the server checks.
8. **Library.** Argon2id via `@node-rs/argon2` (prebuilt binaries, no compiler needed; to be approved as a new dependency).

## Consequences

- New tables, a migration with RLS, a device-credential sync endpoint for offline-signed events, an `offline_signin` flag on gate events (visitor module, additive column), and new session columns (expand only; existing sessions get `kind = 'personal'`).
- The authorization guard gains the scope ceiling; every gate route already declares its permission, so no route changes, but the isolation suite gets cases for a gate session reaching another estate or a management route.
- `packages/auth` gains a gate sign-in path (device credential in SecureStore, no refresh token, re-sign-in at expiry). The personal phone path stays for patrol officers and supervisors.
- security-mobile gains: device registration (supervisor), guard picker and PIN keypad, set-your-PIN, offline sign-in against the wrapped verifier, idle lock, and an "end shift and hand over" flow that also signs the guard out.
- management-web gains a gate devices list with deregister, and a PIN reset action on a guard. (These can follow in a separate change.)
- Tests: Argon2 hashing, lockout and offline-verifier expiry unit tests; integration tests for register, sign-in, wrong PIN, lockout and reset, deregistration revoking sessions, the 12-hour expiry, and the scope ceiling; Maestro flows when a device is available.
- Docs to update in the same change: identity.md §4, §5.3 and §13, security.md §9, security-mobile.md §4 and §14, authz.md (scope ceiling), ADR-0007 consequences.
