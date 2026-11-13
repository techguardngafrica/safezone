# `@safezone/backend-api`

NestJS modular monolith with three entry points built from one codebase:

| Process  | Entry             | Port | Run locally                                        |
| -------- | ----------------- | ---- | -------------------------------------------------- |
| API      | `src/main.ts`     | 4000 | `pnpm --filter @safezone/backend-api dev`          |
| Worker   | `src/worker.ts`   | —    | `pnpm --filter @safezone/backend-api dev:worker`   |
| Realtime | `src/realtime.ts` | 4001 | `pnpm --filter @safezone/backend-api dev:realtime` |

Routes live under `/v1/...` (see `docs/architecture/apps/backend-api.md` §6). Health: `GET /health/live`.

## Running locally

```bash
cp .env.example apps/backend-api/.env   # from the repo root
pnpm infra:up
pnpm dev --filter @safezone/backend-api
```

Configuration is validated with Zod in `src/config/env.ts`; keep it in sync with the root `.env.example`.

The ORM is not chosen yet (ADR-0001, Phase 0 task 1). `prisma/schema.prisma` is a placeholder and no
Prisma tooling is installed.
