# Local Development Guide

## Prerequisites

- **Node.js** `>= 22`
- **pnpm** `>= 10`
- **Docker & Docker Compose** (for PostgreSQL + PostGIS and Redis)

## First-Time Setup

```bash
cp .env.example .env
cp apps/backend-api/.env.example apps/backend-api/.env
pnpm install
pnpm --filter @safezone/backend-api prisma:generate
pnpm infra:up
pnpm build:packages
```

## Running Applications

- Backend API: `pnpm dev:backend` (http://localhost:4000/api/v1, Swagger: http://localhost:4000/api/docs)
- Backend Worker: `pnpm --filter @safezone/backend-api dev:worker`
- Backend Realtime: `pnpm --filter @safezone/backend-api dev:realtime`
- Management Web: `pnpm dev:management-web` (http://localhost:3000)
- Super Admin: `pnpm dev:super-admin` (http://localhost:3001)
- Public Web: `pnpm dev:public-web` (http://localhost:3002)
- Resident Mobile: `pnpm dev:resident-mobile`
- Management Mobile: `pnpm dev:management-mobile`
- Security Mobile: `pnpm dev:security-mobile`

