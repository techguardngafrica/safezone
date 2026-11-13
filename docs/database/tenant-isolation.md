# Tenant Isolation & Row-Level Security (RLS)

Safezone enforces defense-in-depth multi-tenancy:

1. **Application Layer**: Every authenticated request resolves `TenantContext` (`userId`, `estateId`, `roles`, `platformRoles`) from verified database memberships. A client-supplied `x-estate-id` header is treated only as a selector hint and is always validated against the user's memberships.
2. **Database Layer (PostgreSQL RLS)**:
   - Estate-owned tables will include `estate_id UUID NOT NULL`.
   - PostgreSQL RLS policies will check `estate_id = NULLIF(current_setting('app.current_estate_id', true), '')::uuid`.
   - Each tenant-scoped Prisma transaction will set `SET LOCAL app.current_estate_id = '<estate_id>'`.
   - Platform-level tables (e.g. onboarding applications, ad campaigns) remain outside estate RLS scope and require `PlatformRole` authorization.

