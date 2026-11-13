# Prisma conventions (draft)

> Draft. The ORM is decided in ADR-0001 (Phase 0 task 1; AGENTS.md recommends Drizzle). Nothing here applies until that ADR is accepted, and Prisma tooling is not installed.

- Schema location: `apps/backend-api/prisma/schema.prisma`
- Use `snake_case` database column names (`@map("estate_id")`) and `PascalCase` Prisma model names.
- Always use `@db.Timestamptz(3)` for timestamp columns.
- Never edit generated migration SQL after it has been applied to shared environments.
