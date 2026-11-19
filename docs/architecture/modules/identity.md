# Module: Identity

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 (foundation) · Owner: Backend · Used by: all apps

## 1. Responsibility

Identity knows **who** someone is and **how they prove it**. It owns user accounts, phone numbers, credentials, OTP, MFA, sessions, devices and account recovery. It does not decide what a user may do (that is [authz](authz.md)) or which estate they belong to (that is [tenancy](tenancy.md)).

One person = one global account, identified by a verified phone number, usable across every estate and every app.

## 2. Capabilities

1. Sign up and sign in with phone number + OTP (SMS, WhatsApp fallback).
2. Optional password (mainly for web).
3. TOTP MFA (authenticator app); recovery codes.
4. Sessions per device with access and refresh tokens; refresh rotation; reuse detection.
5. Device management: list devices, sign out one or all.
6. Gate device credentials and guard PIN sign-in (for the Security App).
7. Profile: name, photo, email (verified), preferred language.
8. Phone number change (verify new number, notify old number).
9. Account recovery (lost phone/SIM) with support-assisted identity check.
10. Optional identity verification (NIN) through a KYC provider for owners, staff and vendors.
11. Account lock/unlock and deletion requests.
12. Abuse protection: OTP rate limits, SIM-swap check for sensitive actions, suspicious sign-in alerts.

## 3. Actors

| Actor                  | Actions                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Any person             | Sign up, sign in, manage own profile, sessions, MFA                                      |
| Estate staff           | Must enrol MFA                                                                           |
| Guard                  | PIN sign-in on a registered gate device                                                  |
| Platform Support Agent | Lock/unlock, force sign-out, assisted recovery, reset MFA (four-eyes for staff accounts) |
| System                 | Expire sessions, purge OTPs                                                              |

## 4. Data model

| Table                    | Key columns                                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | `id`, `phone_e164` (unique), `phone_verified_at`, `email`, `email_verified_at`, `full_name`, `photo_file_id`, `locale`, `status` (active, locked, deleted), `password_hash` (argon2id, nullable), `mfa_enabled`, `identity_verified_at`, `created_at` |
| `otp_challenges`         | `id`, `phone_e164`, `purpose` (signin, phone_change, sensitive_action), `code_hash`, `channel`, `attempts`, `expires_at`, `consumed_at`, `ip`, `device_fingerprint`                                                                                   |
| `mfa_factors`            | `id`, `user_id`, `type` (totp), `secret_encrypted`, `confirmed_at`                                                                                                                                                                                    |
| `recovery_codes`         | `id`, `user_id`, `code_hash`, `used_at`                                                                                                                                                                                                               |
| `sessions`               | `id`, `user_id`, `device_id`, `refresh_token_hash`, `family_id`, `app` (resident-mobile, management-web, …), `ip`, `user_agent`, `created_at`, `last_seen_at`, `revoked_at`, `revoked_reason`                                                         |
| `user_devices`           | `id`, `user_id`, `platform`, `model`, `app`, `app_version`, `push_token`, `last_seen_at`                                                                                                                                                              |
| `gate_devices`           | `id`, `estate_id`, `gate_id`, `name`, `credential_hash`, `registered_by`, `status`, `last_seen_at` (estate-scoped, RLS)                                                                                                                               |
| `guard_pins`             | `id`, `estate_id`, `user_id`, `pin_hash`, `failed_attempts`, `locked_until`                                                                                                                                                                           |
| `identity_verifications` | `id`, `user_id`, `type` (nin), `provider`, `reference`, `result` (match, mismatch, error), `verified_at` — raw ID number is **not stored**; only a provider reference and last 4 digits                                                               |

`users` and sessions are platform-level (no `estate_id`). Gate devices and PINs are tenant-scoped.

## 5. Flows

### 5.1 Phone OTP sign-in

1. `POST /v1/auth/otp/request {phone, channel}` → creates challenge, sends code (6 digits, 5 min expiry).
2. `POST /v1/auth/otp/verify {phone, code, device}` → if user exists: sign in; else: create user with verified phone.
3. If MFA required (staff role in any estate, or platform role): returns `mfa_required` + temporary token → `POST /v1/auth/mfa/verify`.
4. Returns `accessToken` (JWT, 15 min) and `refreshToken` (opaque, 30 days).

### 5.2 Refresh rotation

- `POST /v1/auth/refresh {refreshToken}` → new pair; old refresh token invalidated.
- Reuse of an old refresh token revokes the whole token family (likely theft) and alerts the user.

### 5.3 Guard sign-in on a gate device

1. Device registered by a manager (one-time code) → device credential.
2. `POST /v1/auth/gate/signin {deviceCredential, userId, pin}` → shift session token scoped to `estate_id` + `gate_id`, 12-hour max.
3. 5 failed PINs → locked until supervisor reset.

### 5.4 Account recovery (lost phone)

1. User contacts support or starts recovery on web with old number + new number.
2. Identity check: NIN match (if previously verified) or estate administrator attestation + support call.
3. Support (four-eyes for staff accounts) moves the account to the new number; all sessions revoked; old number notified if reachable.

## 6. Business rules

1. Phone numbers are unique and stored in E.164.
2. OTP: max 5 requests per phone per hour, 10 per IP per hour; max 5 verify attempts per challenge.
3. OTP codes are hashed; never logged.
4. MFA is mandatory for any user holding an estate staff role or a platform role.
5. Access tokens carry `sub`, `sid`, `app`, `iat`, `exp` only — no roles (roles are evaluated per request).
6. Sensitive actions (phone change, payout details, platform role changes, MFA reset) require recent re-authentication (OTP or MFA within 5 minutes).
7. Before sensitive actions, a SIM-swap check is run where the provider supports it; a recent swap blocks the action for 24 hours.
8. Deleting an account anonymises personal fields; safety and financial records referencing the user keep a pseudonymous id per retention rules.

## 7. API

| Method     | Path                                                                                     | Purpose                          |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| POST       | `/v1/auth/otp/request`                                                                   | Send OTP                         |
| POST       | `/v1/auth/otp/verify`                                                                    | Verify OTP, sign in or sign up   |
| POST       | `/v1/auth/password/signin`                                                               | Phone + password (web)           |
| POST       | `/v1/auth/mfa/verify`                                                                    | Complete MFA                     |
| POST       | `/v1/auth/refresh`                                                                       | Rotate tokens                    |
| POST       | `/v1/auth/signout`                                                                       | Revoke current session           |
| POST       | `/v1/auth/gate/signin`                                                                   | Guard PIN sign-in on gate device |
| GET/PATCH  | `/v1/me`                                                                                 | Profile                          |
| POST       | `/v1/me/phone-change`                                                                    | Start phone change               |
| GET/DELETE | `/v1/me/sessions[/:id]`                                                                  | List / revoke sessions           |
| POST       | `/v1/me/mfa/totp`                                                                        | Enrol TOTP                       |
| POST       | `/v1/me/identity/nin`                                                                    | Start NIN verification           |
| POST       | `/v1/me/deletion-request`                                                                | Request account deletion         |
| POST       | `/v1/platform/users/:id/lock` · `/unlock` · `/force-signout` · `/mfa-reset` · `/recover` | Support actions                  |

## 8. Events

`identity.user.created`, `identity.user.signed_in`, `identity.session.revoked`, `identity.refresh.reuse_detected`, `identity.phone.changed`, `identity.mfa.enabled`, `identity.mfa.reset`, `identity.account.locked`, `identity.identity.verified`, `identity.account.deletion_requested`.

## 9. Integrations

SMS and WhatsApp (OTP delivery, via [notifications](notifications.md) with a dedicated high-priority OTP route), KYC provider (NIN), SIM-swap check (via SMS/telco aggregator where available).

## 10. Security and privacy

- Argon2id for passwords and PINs; HMAC-SHA256 for OTP codes and refresh tokens.
- JWT signing keys rotated; `kid` header; old keys accepted until expiry.
- No raw NIN stored; provider reference only.
- All support actions audited with reason.

## 11. Acceptance criteria

- A new user can sign up with phone + OTP in under 60 seconds.
- Reusing a rotated refresh token revokes all sessions in that family.
- A staff user without MFA cannot access any management endpoint.
- OTP abuse beyond limits returns 429 and does not send SMS.

## 12. Open questions

1. Is WhatsApp OTP enabled by default or only as fallback?
2. Which KYC provider, and is NIN verification mandatory for any role at launch?

## 13. Phase 0 implementation notes

Built (`apps/backend-api/src/modules/identity`): OTP request/verify with sign-up on first use, sessions per device, refresh rotation with reuse detection, sign-out and session revocation, TOTP MFA with recovery codes, `GET/PATCH /v1/me`, `GET/DELETE /v1/me/sessions`. Design decisions: [ADR-0007](../adr/0007-sessions-and-refresh-families.md).

- Table refinement: refresh tokens live in `refresh_tokens` (one row per issued token); the session is the family.
- Gate devices and guard PINs (19 Nov 2026, [ADR-0017](../adr/0017-gate-devices-and-guard-pin-sessions.md)): `gate_devices` and `guard_pins` are owned by the security module (it already depends on identity). Identity adds `sessions.kind` (`personal`, `gate_shift`), `gate_device_id` and `scope_estate_id`, `SessionService.createGateSession` (MFA satisfied, fixed 12-hour end that refresh never extends) and `revokeGateSessions`. `POST /v1/auth/gate/signin` and `POST /v1/auth/gate/guards` (device credential in the body) are served by the security module.
- OTP: 6 digits, 5 minutes, HMAC with `OTP_HMAC_SECRET`, 5 attempts per code; 5 requests per phone and 10 per IP per hour, 30-second resend cooldown; 15 verifies per phone per hour. Sent directly through the SMS adapter.
- MFA: required for staff and platform roles (`requiresMfa` in `@safezone/permissions`); state on the session; TOTP secrets AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY`; replay of a used 30-second step is rejected; 10 one-time recovery codes.
- Web refresh tokens: `sz_rt` httpOnly cookie, `SameSite=Strict`, path `/v1/auth`.
- Not built yet: password sign-in, gate device credentials and guard PINs (Phase 1, with the Security App), phone change, recovery, NIN verification, platform support actions.
