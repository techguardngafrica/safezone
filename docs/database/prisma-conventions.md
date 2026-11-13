# Prisma Conventions

- Schema location: `apps/backend-api/prisma/schema.prisma`
- Use `snake_case` database column names (`@map("estate_id")`) and `PascalCase` Prisma model names.
- Always use `@db.Timestamptz(3)` for timestamp columns.
- Generate client with: `pnpm --filter @safezone/backend-api prisma:generate`.
- Never edit generated migration SQL after it has been applied to shared environments.

