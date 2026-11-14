# Local development

## Prerequisites

- Node.js 22+ (`.nvmrc`), pnpm 10.28 (`corepack enable` picks it up from `package.json`)
- Docker, for Postgres 17, Redis, Mailpit and MinIO

## First-time setup

```bash
pnpm install
cp .env.example apps/backend-api/.env
pnpm infra:up
pnpm build            # compiles packages/* to dist/, which the apps consume
pnpm --filter @safezone/backend-api db:migrate    # apply migrations as the owner
pnpm --filter @safezone/backend-api db:app-role   # let safezone_app log in (local only)
pnpm --filter @safezone/backend-api build && pnpm --filter @safezone/backend-api db:seed:dev   # roles + demo estate
```

The dev seed creates **Demo Gardens Estate** and three accounts: `+2348000000001` (estate administrator, MFA), `+2348000000002` (tenant) and `+2348000000003` (super admin, MFA). With `SMS_PROVIDER=fake`, OTP codes arrive in Mailpit (http://localhost:8025), never in logs. Run the worker too (`dev:worker`): it relays the outbox, writes audit records, sends notifications and scans files.

> MinIO community images (`minio/minio`) can no longer be pulled from Docker Hub or Quay, so `pnpm infra:up` cannot start the `minio` service. Start the others with `docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis mailpit` until the storage image is replaced.

The API connects as `safezone_app`, which cannot bypass row-level security. Migrations use `DATABASE_MIGRATION_URL` (the owner). See [prisma-conventions.md](../database/prisma-conventions.md) for writing migrations.

Each web and mobile app has its own `.env.example`; copy it to `.env.local` (web) or `.env` (Expo) only if you need to override the defaults.

## Running

| What              | Command                                            | URL                               |
| ----------------- | -------------------------------------------------- | --------------------------------- |
| Everything        | `pnpm dev`                                         |                                   |
| Backend API       | `pnpm dev --filter @safezone/backend-api`          | http://localhost:4000/health/live |
| Worker            | `pnpm --filter @safezone/backend-api dev:worker`   |                                   |
| Realtime          | `pnpm --filter @safezone/backend-api dev:realtime` | ws://localhost:4001               |
| Public Web        | `pnpm dev --filter @safezone/public-web`           | http://localhost:3000             |
| Management Web    | `pnpm dev --filter @safezone/management-web`       | http://localhost:3001             |
| Super Admin       | `pnpm dev --filter @safezone/super-admin`          | http://localhost:3002             |
| Resident App      | `pnpm --filter @safezone/resident-mobile dev`      | Expo                              |
| Management Mobile | `pnpm --filter @safezone/management-mobile dev`    | Expo                              |
| Security App      | `pnpm --filter @safezone/security-mobile dev`      | Expo                              |
| Mailpit           |                                                    | http://localhost:8025             |
| MinIO console     |                                                    | http://localhost:9001             |

On a physical phone, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP instead of `localhost`.

## Checks before a PR

```bash
pnpm format:check && pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm test:integration   # database tests on Postgres 17 via Testcontainers; needs Docker
```

The pre-commit hook (husky + lint-staged) runs Prettier on staged files. `pnpm install` enables it.
