# Troubleshooting

- **Missing Prisma Client**: Run `pnpm --filter @safezone/backend-api prisma:generate`.
- **Workspace type errors**: Run `pnpm build:packages` so shared packages emit `dist/*.d.ts`.
- **Backend fails on startup with env error**: Ensure `apps/backend-api/.env` exists and `JWT_SECRET` is at least 16 characters.
- **Port conflicts**: Default ports are `4000` (API), `4002` (Realtime), `3000` (Management Web), `3001` (Super Admin), `3002` (Public Web), `5432` (Postgres), `6379` (Redis).

