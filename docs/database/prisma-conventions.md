# Prisma conventions

Accepted in [ADR-0001](../architecture/adr/0001-orm-and-data-access.md). Commands run from the repo root with `pnpm --filter @safezone/backend-api <script>`.

## Schema

- One schema file: `apps/backend-api/prisma/schema.prisma`. Group models by owning module with a comment header; a module only queries its own models.
- Models `PascalCase`, fields `camelCase`; map to `snake_case` with `@map` / `@@map`. Every model sets `@@schema("platform" | "tenant" | "audit")`.
- IDs: `String @id @default(uuid(7)) @db.Uuid`. Times: `DateTime @db.Timestamptz(3)`. Money: `BigInt` kobo plus `currency`.
- Tenant models: `estateId String @map("estate_id") @db.Uuid` (not null) and `@@index([estateId, ...])`.
- The generated client goes to `src/generated/prisma` (gitignored). `build`, `typecheck` and `test` run `prisma generate` first.

## Writing a migration

1. Edit `schema.prisma`.
2. `db:migrate:create -- --name <short_name>` writes `prisma/migrations/<timestamp>_<name>/migration.sql` without applying it.
3. Append the hand-written part to the same file:
   - `GRANT` exactly what `safezone_app` needs on each new table (append-only tables: `INSERT, SELECT`).
   - `ENABLE` and `FORCE ROW LEVEL SECURITY`, plus policies using `nullif(current_setting('app.estate_id', true), '')::uuid`.
   - Anything Prisma cannot express (check constraints, triggers).
4. `db:migrate:dev` applies it locally; then run `test:integration` (it fails on schema drift or a table without forced RLS).
5. Keep migrations backward compatible (expand → migrate → contract). Never edit a migration once it has reached a shared environment.

Partial indexes, partitions and other objects Prisma cannot describe cause drift; avoid them until the follow-up partitioning ADR says how.

## Data access

- Inject `DatabaseService`. Tenant data: `db.withTenant({ estateId, userId }, async (tx) => repo.method(tx, ...))`. Repositories take `tx: Tx` as their first argument.
- Write domain events in the same transaction with `appendOutboxEvents(tx, [...])`.
- Raw SQL only through tagged `tx.$queryRaw\`...\``(parameterised). Never`$queryRawUnsafe` with user input.
