# PostGIS Strategy

Local Docker uses `postgis/postgis:16-3.4-alpine`, with `CREATE EXTENSION IF NOT EXISTS postgis;` initialized in `infrastructure/docker/postgres/init/01-extensions.sql`.

## Prisma Compatibility

Prisma does not natively type all PostGIS `geometry` / `geography` columns. When geospatial columns (e.g., estate boundaries, SOS coordinates) are added:

1. Declare them as `Unsupported("geography(Point, 4326)")?` in `schema.prisma`.
2. Create `GIST` spatial indexes via custom SQL in Prisma migrations (`prisma migrate dev --create-only`).
3. Query spatial operations using parameterized `prisma.$queryRaw`.

