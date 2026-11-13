# Testing Strategy

- **Shared packages** (`types`, `schemas`, `permissions`, `auth`, `api-client`, `i18n`): **Vitest** (`vitest run`).
- **Backend API** (`apps/backend-api`): **Jest** unit tests (`pnpm --filter @safezone/backend-api test`) and e2e tests (`test:e2e`).
- **Root command**: `pnpm test` runs `turbo test` across all workspaces.

