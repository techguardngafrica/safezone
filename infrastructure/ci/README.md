# CI

Workflows live in `.github/workflows/` (GitHub requires that location). This folder holds CI notes and helper scripts.

## Pipeline (`.github/workflows/ci.yml`)

1. Install with pnpm (frozen lockfile), Turborepo cache.
2. `pnpm format:check`
3. `pnpm build` → `pnpm typecheck` → `pnpm lint` → `pnpm test`

## To add in Phase 0

- Postgres + Redis service containers for backend integration and isolation tests.
- OpenAPI drift check: regenerate `packages/contracts/openapi.json` and fail if it differs from the commit.
- Dependency and container image scanning.
- Image build and push for `backend-api` (see `infrastructure/docker/backend-api.Dockerfile`).
- EAS build triggers for the three Expo apps on release tags.
