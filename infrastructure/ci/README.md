# CI

Workflows live in `.github/workflows/` (GitHub requires that location). This folder holds CI notes and helper scripts.

## Pipeline (`.github/workflows/ci.yml`)

1. Install with pnpm (frozen lockfile), Turborepo cache.
2. `pnpm format:check`
3. `pnpm build` → `pnpm typecheck` → `pnpm lint` → `pnpm test`

## To add in Phase 0

- Postgres + Redis service containers for backend integration and isolation tests.
- OpenAPI drift check: regenerate `packages/contracts/openapi.json` and fail if it differs from the commit.
- Management-web e2e job (Playwright). Locally it runs in host mode (`pnpm --filter @safezone/management-web e2e`,
  see `docs/operations/e2e-tests.md`). In CI: Postgres 17 and Redis 7 service containers; create the
  `safezone_app` role (`pnpm --filter @safezone/backend-api db:app-role` against the service); set
  `E2E_PG_ADMIN_URL` (superuser, database `postgres`), `E2E_PG_APP_PASSWORD` and `E2E_REDIS_URL`
  (index 14); install the browser with `pnpm --filter @safezone/management-web exec playwright install --with-deps chromium`
  (cache `~/.cache/ms-playwright` keyed on the Playwright version); run `pnpm e2e` (Turborepo builds the
  packages first, the harness builds the backend and `.next-e2e`). Upload
  `apps/management-web/e2e/.run/{logs,test-results,report}` as artifacts on failure. Playwright retries
  once when `CI` is set and refuses `test.only`.
- Dependency and container image scanning.
- Image build and push for `backend-api` (see `infrastructure/docker/backend-api.Dockerfile`).
- EAS build triggers for the three Expo apps on release tags.
