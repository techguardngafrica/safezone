# Database strategy

Safezone uses **PostgreSQL 17** with **Prisma ORM 7** over the `@prisma/adapter-pg` driver ([ADR-0001](../architecture/adr/0001-orm-and-data-access.md)). Schema: `apps/backend-api/prisma/schema.prisma`; migrations: `apps/backend-api/prisma/migrations/`.

- Postgres schemas: `platform`, `tenant`, `audit` (see [README](README.md)).
- All timestamps are `timestamptz(3)` in UTC.
- Soft deletion (`deleted_at`) for business records; hard delete only through retention jobs.
- Append-only tables grant `safezone_app` `INSERT` and `SELECT` only; `audit.audit_events` also has a trigger that rejects `UPDATE` and `DELETE` for every role.
- Monthly partitioning is deferred to a follow-up ADR (Prisma drift detection does not handle partition child tables); it must land before the first high-volume table (gate events).
- Business domain tables are added per module in phase order.
