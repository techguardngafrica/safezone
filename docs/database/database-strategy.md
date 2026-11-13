# Database Strategy

Safezone uses **PostgreSQL 16** with **PostGIS 3.4** and **Prisma ORM** (`apps/backend-api/prisma/schema.prisma`).

- All timestamps use UTC (`TIMESTAMPTZ`).
- Soft deletion (`deleted_at`) will be applied to business-critical records where audit retention is required.
- Audit logs will be append-only and isolated from estate-level mutation privileges.
- Business domain tables are intentionally deferred to feature milestones.

