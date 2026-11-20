# ADR-0021: Composition modules for staff, search and reports; no cross-module table access

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Sunday Etom Eni
- **Affects:** `apps/backend-api` (authz, identity, tenancy, property, occupancy, visitor, security, emergency, billing, community, reports, realtime; new `staff` and `search` modules)

## Context

AGENTS.md §5.1 says a module owns its tables and never queries another module's. A review of the Phase 1-3 endpoints found four places that broke this:

1. `authz/StaffRolesService` created and updated `platform.users` (identity) and `tenant.estate_memberships` (tenancy) to invite staff, list them and suspend them. It could not call `IdentityService` instead, because `IdentityModule` imports `AuthzModule`.
2. `tenancy/SearchService` read spaces, household members, vehicles, visitor passes and invoices. It could not call their services, because every one of those modules imports `TenancyModule`.
3. `reports/ReportsService` counted rows in property, occupancy, visitor, security, emergency and billing tables.
4. The realtime gateway read community's `channel_members` to authorise channel room joins.

`analytics.md` §3 plans projection read models (`rm_*` tables fed by event consumers) for reports. Building them needs consumers, a backfill and reconciliation tests; that is a feature of its own, not a boundary fix.

## Options considered

| Option                                                                                  | Pros                                                                | Cons                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A. Leave the code where it is and use `forwardRef` between modules                      | Small diff                                                          | Circular module graph; still couples the lower modules to the higher ones               |
| B. Composition modules above the owners, calling small read/write methods on each owner | No cycles; each table touched by one module only; same transactions | More methods on owner services; a composer depends on many modules                      |
| C. Reports from projection read models now                                              | Matches analytics.md long term; no live joins across modules        | New tables, consumers and backfill; figures lag events; out of scope for a boundary fix |

## Decision

Option B, with projections left as the long-term path for reports.

- **`modules/staff`** (new) holds the staff directory, invitations and suspension. It imports `AuthzModule`, `IdentityModule` and `TenancyModule` and calls `IdentityService.findOrCreateStaffUser`, `UserDirectory.staffProfilesOf`, `TenancyService.staffMemberships` / `activateStaffMembership` / `setStaffMembershipStatus` and `StaffRolesService.activeStaffAssignments` / `grantInvitedRoles` / `assertMayChangeStaffStatus`. Role CRUD and role assign/revoke stay in authz. Routes, permissions and responses are unchanged.
- **`modules/search`** (new) holds global search, moved out of tenancy. It calls `PropertyService.searchSpaces`, `OccupancyService.searchMembers` / `searchVehicles`, `PassesService.searchPasses` and `InvoicesService.searchInvoices`, all inside one `withTenant` transaction (the owner methods take the caller's `tx`, as existing cross-module methods such as `OccupancyService.activeHouseholdAt` already do).
- **`reports`** calls `PropertyService.unitCounts`, `OccupancyService.residencyCounts`, `GateService.gateEventsBetween`, `PassesService.activePassCount`, `IncidentsService.incidentsBetween`, `ShiftsService.shiftsBetween`, `SosService.alertsBetween` and `InvoicesService.invoicesCreatedBetween`, still in one tenant transaction so the report is one snapshot. `SecurityModule` now exports `IncidentsService` and `ShiftsService`.
- **Realtime** uses community's `ChannelMembershipReader.isActiveMember`, a database-only service the realtime process can provide without the rest of `CommunityModule`.

## Consequences

- None of these services touches another module's Prisma models; a `tx.<model>` call outside the owning module is now a review finding.
- Owner methods used by other modules take `tx` and `estateId` and return only the fields the caller needs.
- Staff invitation still runs as three transactions (user, membership, roles), as before; a failure in role granting leaves an active membership with no staff role, which is harmless and the invitation can be retried.
- When reports move to projection read models (analytics.md §3), `ReportsService` swaps these calls for reads of its own `rm_*` tables; the owner methods can then be removed if nothing else uses them.
