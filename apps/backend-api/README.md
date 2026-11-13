# `@safezone/backend-api`

Safezone's NestJS modular monolith backend, supporting three independently runnable entry points:

- **API Server** (`src/main.ts` / `src/app.module.ts`) — HTTP REST API under `/api/v1` and Swagger docs at `/api/docs`.
- **Background Worker** (`src/worker.main.ts` / `src/worker.module.ts`) — BullMQ job consumers.
- **Realtime Gateway** (`src/realtime.main.ts` / `src/realtime.module.ts`) — WebSocket/event gateway.

## Running Locally

```bash
cp .env.example .env
pnpm --filter @safezone/backend-api prisma:generate
pnpm --filter @safezone/backend-api dev
pnpm --filter @safezone/backend-api dev:worker
pnpm --filter @safezone/backend-api dev:realtime
```

