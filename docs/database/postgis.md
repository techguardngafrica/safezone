# PostGIS

Not installed yet. The local image is `postgres:17-alpine`, which has no PostGIS. Nothing needs it until geospatial columns arrive (estate boundaries, SOS location in Phase 1).

When it is needed:

1. Switch the local and test image to a PostGIS build of Postgres 17 and confirm the managed database supports the extension.
2. Enable it in a migration: `CREATE EXTENSION IF NOT EXISTS postgis;`.
3. Declare columns as `Unsupported("geography(Point, 4326)")?` in `schema.prisma`, add `GIST` indexes in the migration SQL, and query them with parameterised `$queryRaw` inside `withTenant`.
4. Record the change in an ADR.
