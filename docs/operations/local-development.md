# Local development

## Two ways to run locally

|                                             | **Without Docker** (lighter)                                                        | **With Docker**                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| Postgres 17, Redis                          | Installed natively (Homebrew)                                                       | `pnpm infra:up` (or native)     |
| OTP codes and email                         | Files in `apps/backend-api/.dev-outbox/` (`MAIL_TRANSPORT=file`)                    | Mailpit, http://localhost:8025  |
| Uploaded files                              | Folder `apps/backend-api/.dev-storage/`, served by the API (`STORAGE_DRIVER=local`) | RustFS (S3-compatible) on :9000 |
| Integration tests (`pnpm test:integration`) | Not available (Testcontainers needs Docker)                                         | Yes                             |

Both use the same code paths for everything except the two adapters above, which exist only for development; the API refuses `MAIL_TRANSPORT=file` and `STORAGE_DRIVER=local` in staging and production.

## Prerequisites

- Node.js 22+ (`.nvmrc`), pnpm 10.28 (`corepack enable` picks it up from `package.json`)
- Without Docker: PostgreSQL 17+ and Redis 7+ running natively, for example `brew install postgresql@17 redis && brew services start postgresql@17 && brew services start redis`
- With Docker: Docker Desktop

## First-time setup

```bash
pnpm install
cp .env.example apps/backend-api/.env
pnpm build            # compiles packages/* to dist/, which the apps consume
```

Then edit `apps/backend-api/.env`:

- **Without Docker**: set `MAIL_TRANSPORT=file` and `STORAGE_DRIVER=local`. Point `DATABASE_MIGRATION_URL` at a native superuser (for example `postgres://<you>@127.0.0.1:5432/safezone`) and create the database once with `createdb safezone`.
- **With Docker**: keep the defaults and run `pnpm infra:up` (all services) or `pnpm infra:up:services` (Mailpit and storage only, when Postgres and Redis already run natively on 5432/6379).
- Either way, prefer `127.0.0.1` over `localhost` in the database and Redis URLs (see [troubleshooting](troubleshooting.md)).

Create the schema and demo data:

```bash
pnpm --filter @safezone/backend-api db:migrate    # apply migrations as the owner
pnpm --filter @safezone/backend-api db:app-role   # let safezone_app log in (local only)
pnpm --filter @safezone/backend-api build && pnpm --filter @safezone/backend-api db:seed:dev   # roles + demo estate
```

The dev seed creates **Demo Gardens Estate** (join code `DEMOGD`) and four accounts: `+2348000000001` (estate administrator, MFA), `+2348000000004` (estate accountant, MFA), `+2348000000002` (tenant) and `+2348000000003` (super admin, MFA). Billing runs and office payments need two people: sign in as the accountant to prepare or record them, and as the administrator to approve them. With `SMS_PROVIDER=fake`, OTP codes never appear in logs; get the latest one with:

```bash
pnpm dev:otp 08000000001
```

It reads the file outbox or Mailpit, whichever `MAIL_TRANSPORT` selects.

**Demo data to try.** `pnpm dev:demo-data` (alias `dev:demo-billing`) adds an open estate poll and three bookable facilities to the demo estate (a paid event hall, a free tennis court and gym), links a fake payout account and issues sample bills for unit ADM-12, all through the real services (re-run it to get new bills once those are paid). With `PAYMENTS_PROVIDER=fake`, the checkout link opens the API's test checkout page (`/dev-checkout/<reference>`, development only) with **Pay** and **Fail** buttons; back in the app, the payment is confirmed through the server-side verify step exactly as with Paystack.

The API connects as `safezone_app`, which cannot bypass row-level security. Migrations use `DATABASE_MIGRATION_URL` (the owner). See [prisma-conventions.md](../database/prisma-conventions.md) for writing migrations.

Each web and mobile app has its own `.env.example`; copy it to `.env.local` (web) or `.env` (Expo) only if you need to override the defaults.

## Running

| What                          | Command                                            | URL                               |
| ----------------------------- | -------------------------------------------------- | --------------------------------- |
| API + worker + management web | `pnpm dev:local`                                   | http://localhost:3001             |
| API + worker only             | `pnpm dev:api`                                     | http://localhost:4000/health/live |
| Everything                    | `pnpm dev`                                         |                                   |
| Backend API                   | `pnpm dev --filter @safezone/backend-api`          | http://localhost:4000/health/live |
| Worker                        | `pnpm --filter @safezone/backend-api dev:worker`   |                                   |
| Realtime                      | `pnpm --filter @safezone/backend-api dev:realtime` | ws://localhost:4001               |
| Public Web                    | `pnpm dev --filter @safezone/public-web`           | http://localhost:3000             |
| Management Web                | `pnpm dev --filter @safezone/management-web`       | http://localhost:3001             |
| Super Admin                   | `pnpm dev --filter @safezone/super-admin`          | http://localhost:3002             |
| Resident App                  | `pnpm --filter @safezone/resident-mobile dev`      | Expo                              |
| Management Mobile             | `pnpm --filter @safezone/management-mobile dev`    | Expo                              |
| Security App                  | `pnpm --filter @safezone/security-mobile dev`      | Expo                              |
| Latest sign-in code           | `pnpm dev:otp <phone>`                             |                                   |
| Demo facilities and bills     | `pnpm dev:demo-data`                               |                                   |
| Mailpit (Docker)              |                                                    | http://localhost:8025             |

The worker relays the outbox, writes audit records, sends notifications and scans files; without it the audit log stays empty.

### Mobile apps on your phone (Expo Go)

The iOS Simulator and Android emulator are too heavy for low-memory machines, so run the apps in **Expo Go** on your phone. Install Expo Go (SDK 58) from the App Store or Play Store; phone and Mac must be on the same Wi-Fi.

```bash
pnpm dev:api                                     # API + worker
pnpm --filter @safezone/resident-mobile dev      # or management-mobile, security-mobile
```

Scan the QR code with Expo Go (Android) or the Camera app (iPhone), or type the `exp://<ip>:8081` address Metro prints into Expo Go.

Each app's `dev` script first runs `scripts/phone-env.mjs`, which reads this Mac's IP with `ipconfig getifaddr en0` and writes it into the app's `.env` (`EXPO_PUBLIC_API_URL=http://<ip>:4000`) and into the API's `API_PUBLIC_URL`, so the phone never calls `localhost`. Run it alone with `pnpm phone:env` (or `pnpm phone:env <ip>` to override). When your IP changes, restart Metro with `--clear` (the URL is inlined into the bundle) and restart the API if `phone:env` says so. If the phone cannot reach the API, allow incoming connections for Node in macOS firewall settings.

Expo Go includes every module the apps use today; remote push notifications on Android are not available in Expo Go. A native build (`run:android` / `run:ios` with a phone on USB, about 5 to 8 GB of free disk) is only needed once features need native code outside Expo Go.

Visitor pass links use `PUBLIC_WEB_URL` (default `http://localhost:3000`), so they only open on this computer unless public-web is running and `PUBLIC_WEB_URL` uses your LAN IP.

## Checks before a PR

```bash
pnpm format:check && pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm test:integration   # database and cross-tenant isolation tests (Testcontainers); needs Docker running
```

The pre-commit hook (husky + lint-staged) runs Prettier on staged files. `pnpm install` enables it.
