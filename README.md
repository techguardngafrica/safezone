# Safezone

**Safezone by Techguard** — one platform for residential estates: visitor management and access control, SOS and emergency response, estate billing, maintenance, community, facilities, marketplace and advertising. Nigeria first.

> One platform. Multiple estates. Connected communities. Safer living.

## Repository

Turborepo + pnpm workspaces.

| Path                     | What                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `apps/backend-api`       | NestJS backend — API, worker and realtime entry points                                           |
| `apps/resident-mobile`   | Resident App (Expo)                                                                              |
| `apps/management-web`    | Estate Management App — web (Next.js)                                                            |
| `apps/management-mobile` | Estate Management App — mobile (Expo)                                                            |
| `apps/security-mobile`   | Security App (Expo)                                                                              |
| `apps/super-admin`       | Safezone Super Admin Portal (Next.js)                                                            |
| `apps/public-web`        | Public site, visitor passes, estate sign-up, ad enquiries (Next.js)                              |
| `packages/*`             | Shared contracts, schemas, types, API client, auth, permissions, design tokens, UI, i18n, config |
| `infrastructure/`        | Docker, CI notes, deployment                                                                     |
| `docs/`                  | Product, architecture (apps, modules, ADRs), API, database, operations                           |

## Getting started

Requirements: Node 22+, pnpm 10+, and either Docker (`pnpm infra:up`) or native Postgres 17 and Redis. Docker is optional: with `MAIL_TRANSPORT=file` and `STORAGE_DRIVER=local` the backend runs without any containers. See [local development](docs/operations/local-development.md) for both setups.

```bash
pnpm install
cp .env.example apps/backend-api/.env
pnpm infra:up        # skip when Postgres and Redis run natively
pnpm dev:local       # API + worker + management web; `pnpm dev` runs every app
```

| App                   | URL                               |
| --------------------- | --------------------------------- |
| public-web            | http://localhost:3000             |
| management-web        | http://localhost:3001             |
| super-admin           | http://localhost:3002             |
| backend API           | http://localhost:4000/health/live |
| realtime gateway      | ws://localhost:4001               |
| Mailpit (Docker only) | http://localhost:8025             |

Mobile apps: `pnpm --filter @safezone/resident-mobile dev` (likewise `management-mobile`, `security-mobile`), then open in Expo Go or a development build.

## Common tasks

```bash
pnpm build        # build all packages and apps
pnpm typecheck    # type-check everything
pnpm lint         # lint everything
pnpm test         # run all tests
pnpm format       # format with Prettier
```

## For contributors and coding agents

Read [AGENTS.md](AGENTS.md) and [docs/README.md](docs/README.md) before making changes.
