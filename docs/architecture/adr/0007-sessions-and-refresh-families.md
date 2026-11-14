# ADR-0007: Sessions, refresh-token families and MFA state

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** identity module, all app shells, `packages/auth`, `packages/api-client`

## Context

identity.md proposed `sessions(refresh_token_hash, family_id)` and a temporary token for MFA. We need refresh rotation with reuse detection, immediate revocation, MFA for staff, and web clients that never expose refresh tokens to JavaScript.

## Decision

1. **A session is the token family.** `sessions` holds one row per device sign-in; `refresh_tokens` holds every token issued to it (HMAC hash only, `used_at`). Rotation marks the presented token used atomically (`UPDATE … WHERE used_at IS NULL`); a token that is already used revokes the whole session and emits `identity.refresh.reuse_detected` (audited, and the user gets a security alert).
2. **Access tokens** are 15-minute HS256 JWTs with `sub`, `sid`, `app` only. Every request also checks the session is live, so sign-out and revocation are immediate.
3. **MFA state lives on the session** (`mfa_verified_at`), not in a second token. The authorization guard requires it whenever the user holds a staff or platform role (`requiresMfa` in `@safezone/permissions`); only routes marked `@AllowMfaPending` (MFA verify and enrolment, profile, sign-out) are reachable before it. Sign-in and refresh responses report `mfaRequired` and `mfaEnrolled`.
4. **Web apps** (`management-web`, `super-admin`, `public-web`) receive the refresh token as an `HttpOnly; SameSite=Strict` cookie scoped to `/v1/auth`; cookie refreshes also require the `X-Safezone-App` header. Mobile apps keep it in SecureStore.
5. **OTP codes** go straight to the SMS adapter from the API (the dedicated OTP route), not through the worker queue, so sign-in does not depend on queue health.

## Consequences

- Passwords and guard PINs (Argon2id) are not built yet; the Security App shell uses supervisor phone + OTP + MFA until Phase 1 adds gate-device registration and PIN shift sessions.
- `packages/auth` provides `SessionController`, the shared sign-in state machine every shell uses.
