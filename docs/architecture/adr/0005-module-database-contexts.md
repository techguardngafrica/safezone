# ADR-0005: Module database contexts for platform tables

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** `apps/backend-api` (identity, authz, tenancy, notifications, files, platform, audit), every migration

## Context

ADR-0001 protects tenant tables with `app.estate_id`. Many Phase 0 tables have no estate: users, sessions, OTP challenges, role assignments, notifications, personal files, feature flags. AGENTS.md §5.2 asks for defence in depth, and the RLS harness fails if any table in `platform`, `tenant` or `audit` lacks enabled and forced RLS. We need a rule for tables that are not scoped by estate, so a tenant code path (`withTenant`) cannot read or change them by mistake.

## Options considered

| Option                                                    | Pros                                                          | Cons                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A. No RLS on platform tables                              | Simple                                                        | Any query from any module sees every user's sessions; harness cannot guard them  |
| B. A second database role per module                      | Real privilege separation                                     | Many pools and credentials; Prisma needs a client per role; heavy for a monolith |
| C. Named module context (`app.context`) plus owner checks | One role, one pool; mistakes fail closed; owners see own rows | Not a boundary against code that deliberately sets another context               |

## Decision

Option C. `DatabaseService.withContext(context, fn, { userId?, estateId? })` sets `app.context` (one of `identity`, `authz`, `tenancy`, `audit`, `notifications`, `files`, `platform_config`, `outbox_relay`) for one transaction. Policies on platform tables admit their owning context and, where it makes sense, the signed-in owner (`user_id = app.user_id`, via `withUser`). Non-personal reference data (roles, plans, feature flags, app versions) is readable by anyone and writable only in its context.

## Consequences

- Every new non-tenant table gets policies naming its context; the harness keeps failing until it does.
- The context is a guard against mistakes, not against compromised code: all code runs as `safezone_app`. The real cross-tenant boundary stays `app.estate_id` plus the authorization guard.
- The separate platform database role from ADR-0001 is deferred to Phase 1 support access, the first feature that reads tenant data across estates.
