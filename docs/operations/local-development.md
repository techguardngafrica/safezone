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
```

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
```
