# Environment variables

## Rules

- Never commit `.env` or `.env.local`; only `.env.example` files are tracked.
- Never put server secrets behind `NEXT_PUBLIC_` or `EXPO_PUBLIC_` — those are bundled into clients.
- Every backend variable is validated in `apps/backend-api/src/config/env.ts`; the process fails fast on boot.

## Backend (`apps/backend-api/.env`, copied from the root `.env.example`)

The root [`.env.example`](../../.env.example) is the single list. Every variable is validated by `apps/backend-api/src/config/env.ts`; error messages name the variable but never print its value.

- In `development` and `test`, missing values fall back to local defaults so `pnpm dev` works against docker-compose.
- In `staging` and `production` the process refuses to start unless database, Redis, JWT/OTP secrets (32+ chars, all different, no placeholders), `MFA_ENCRYPTION_KEY` (32 bytes base64), storage credentials, Zoho SMTP credentials and `SMS_API_KEY` are set; `SMS_PROVIDER=fake`, `PAYMENTS_PROVIDER=fake` (and `paystack` without `PAYSTACK_SECRET_KEY`), non-https `CORS_ORIGINS` and non-https `MANAGEMENT_WEB_URL` are refused; `DATABASE_URL` must connect as `safezone_app`.
- Secrets: `JWT_ACCESS_SECRET` (access JWTs), `JWT_REFRESH_SECRET` (refresh and recovery code hashes), `OTP_HMAC_SECRET` (OTP hashes, rate-limit keys and estate invitation link tokens, ADR-0008; rotating it invalidates open invitations), `MFA_ENCRYPTION_KEY` (TOTP secrets at rest).
- `PUBLIC_WEB_URL`: base URL of public-web; visitor pass links open `<url>/p/<token>`.
- `PASS_KEY_ENCRYPTION_KEY`: 32 bytes base64; wraps estate pass-signing keys and pass PINs (ADR-0010). Must differ from `MFA_ENCRYPTION_KEY`.
- `ADS_TRACKING_SECRET`: at least 32 characters; signs ad impression and click tokens and salts the daily user hash (ADR-0024). Required in staging and production.
- `MANAGEMENT_WEB_URL`: base URL of management-web; invitation links open `<url>/invite/<token>`.
- `OUTBOX_RELAY_DISABLED=true` stops the worker's relay loop (tests and maintenance only).
- `MAIL_TRANSPORT`: `smtp` (default; Zoho in staging/production, Mailpit locally) or `file` (development only). With `file`, every email and fake SMS, including OTP codes, is written to `DEV_OUTBOX_DIR` (default `.dev-outbox`, relative to `apps/backend-api`). Read a code with `pnpm dev:otp <phone>`. Refused in staging and production.
- `STORAGE_DRIVER`: `s3` (default; S3 in staging/production, RustFS locally) or `local` (development only). With `local`, uploads are kept in `DEV_STORAGE_DIR` (default `.dev-storage`) and the API serves its own short-lived signed URLs at `/dev-storage/<token>`, bound to the declared content type and size like S3 presigned URLs. Refused in staging and production.
- `API_PUBLIC_URL`: base URL clients use to reach the API, used for `STORAGE_DRIVER=local` links. Defaults to `http://localhost:<API_PORT>`; set your LAN IP when testing uploads from a phone.

## Web apps (`NEXT_PUBLIC_*`)

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SITE_URL` (public-web), `NEXT_PUBLIC_APP_NAME`

## Mobile apps (`EXPO_PUBLIC_*`)

- `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REALTIME_URL` — override `app.json` `extra` defaults (read in `src/lib/config.ts`).

## Safezone Pay (ADR-0025)

- `PAY_TRANSFERS_ENABLED`: `true` or `false`. Transfers between residents are on in development and test; in staging and production they are on only when this is `true` (after the Paystack and legal review).
- `TOPUP_PROVIDER`: `vtpass` or `fake`. Unset outside development and test means airtime and data are unavailable (503). `fake` is refused in staging and production.
- `VTPASS_BASE_URL` (default sandbox `https://sandbox.vtpass.com/api`; live `https://vtpass.com/api`), `VTPASS_API_KEY`, `VTPASS_SECRET_KEY`, `VTPASS_PUBLIC_KEY`: from the VTpass API Keys tab. Secret keys are shown once; store them in the vault.
