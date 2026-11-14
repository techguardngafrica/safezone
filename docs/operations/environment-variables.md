# Environment variables

## Rules

- Never commit `.env` or `.env.local`; only `.env.example` files are tracked.
- Never put server secrets behind `NEXT_PUBLIC_` or `EXPO_PUBLIC_` — those are bundled into clients.
- Every backend variable is validated in `apps/backend-api/src/config/env.ts`; the process fails fast on boot.

## Backend (`apps/backend-api/.env`, copied from the root `.env.example`)

The root [`.env.example`](../../.env.example) is the single list. Core ones: `NODE_ENV`, `APP_PROCESS`, `API_PORT` (4000), `REALTIME_PORT` (4001), `DATABASE_URL` (runtime role `safezone_app`), `DATABASE_MIGRATION_URL` (schema owner, migrations only), `DATABASE_POOL_MAX`, `REDIS_URL`, `CORS_ORIGINS`, `APP_MIN_VERSION`, `APP_RECOMMENDED_VERSION`. Provider keys (SMTP, Expo, Paystack, Flutterwave, SMS…) are sandbox-only in development.

## Web apps (`NEXT_PUBLIC_*`)

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SITE_URL` (public-web), `NEXT_PUBLIC_APP_NAME`

## Mobile apps (`EXPO_PUBLIC_*`)

- `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REALTIME_URL` — override `app.json` `extra` defaults (read in `src/lib/config.ts`).
