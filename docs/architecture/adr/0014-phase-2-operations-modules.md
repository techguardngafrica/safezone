# ADR-0014: Ownerships, maintenance, utilities, moves and estate exports

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** property, occupancy, billing, maintenance, utilities, platform, files, visitor

## Context

Phase 2 adds ownership records, owner mode, maintenance, utilities, move-in/out and estate data export. The module docs leave several choices open, and some modules need data from each other in both directions (billing needs owners and consumption; moves need balances).

## Decision

### Ownerships and owner mode (property.md)

1. Shares are **basis points** (10,000 = 100%). A deferred constraint trigger rejects any commit that leaves a unit's active shares above 100%, so transfers can end and create ownerships in any order.
2. Company owners carry a **contact person** who signs in and pays owner-billed charges.
3. Recording an owner gives them the `property_owner` role; it is revoked when their last active ownership ends. Ownership rows are never deleted.
4. Transfers: `requested → seller_confirmed → completed`, or `rejected`/`cancelled`. An owner opening a transfer counts as seller confirmation. A manager can complete without the seller only with documents and a reason (`managerOverride`).
5. Owner mode is `GET /v1/estates/:estateId/owned-units` (units, share, current household name and occupancy type; never contact details). Tenant join requests now go to the unit's owner first when one is recorded (ADR-0011 §2 switches on).
6. Owner-billed charges go to the **primary owner** (largest share, then longest held). Splitting one invoice across co-owners by share is not built. `billing.bill_owner_when_vacant` sends occupant charges on vacant units to the primary owner. Run items and invoices are unique per run, unit and payer type, so a unit can get an occupant bill and an owner bill in one run.

### Maintenance (maintenance.md)

7. Categories are seeded with the doc's defaults the first time an estate uses maintenance.
8. SLA is a **resolution** target per priority (defaults: urgent 4 h, high 24 h, normal 72 h, low 168 h). Paused time (`info_requested`, `awaiting_materials`) is added to the due time. Breach level 1 notifies holders of maintenance-assigning roles; level 2, half a target later, notifies estate managers. Checked every 5 minutes.
9. Work orders move the linked request (start, on hold, completed → resolve). Assignees may only change status and resolution notes; assignment, schedule, costs and recharge need `maintenance.assign`.
10. **Recharge** is invoiced at verification by a manager, through `InvoicesService.issue`, in the same transaction.
11. **Contractor passes** are created through `PassesService.create` as the assigning manager (multi-entry, the visit window). This needs `visitor.log.read` (managers have it); if the pass cannot be issued the work order stands and the failure is logged.
12. Neighbour complaints (`aboutNeighbour`) are visible only to the requester and management. Attachments must be the requester's own estate files with purpose `maintenance` (new `FilesService.estateFilesOf`).

### Utilities (utilities.md)

13. Meters: public meters are validated through a `BillsProvider` adapter before registration; estate sub-meters are registered by management. No aggregator is chosen, so a fake runs locally and in tests and an "unconfigured" provider (always unavailable) runs in staging and production.
14. Estate-run supply is billed through a new **`metered` charge rule** (`ratePerUnit` kobo per kWh/m³ plus optional fixed amount), so tariffs go through the normal billing-run approval. Consumption = last reading at or before the period end minus the last reading before the start (or the first in the period); units without two readings are not billed. Readings lower than an earlier reading are rejected; readings are append-only.
15. Outages notify residents of the affected spaces only.
16. **Prepaid token purchases and bill payments are not built.** The docs do not say who receives the resident's money for DisCo tokens; collecting it would put Safezone in the money flow (AGENTS.md §2.8, implementation plan "legal sign-off"). Needs a product and legal decision.

### Move-in and move-out (occupancy.md §5)

17. `MovesModule` sits in the occupancy folder and owns `move_events`, but is its own Nest module because it reads balances from billing, which already depends on occupancy.
18. The head, an owner or a manager schedules a move. Outstanding balance is shown as a warning; `occupancy.block_move_out_with_balance` makes it block completion. A daily job (00:30 WAT) completes due moves through `OccupancyService.endOccupancy` (now callable by the system) and sends lease reminders at 60, 30 and 7 days, then an expiry notice to managers. `POST …/occupancies/:id/renew` sets a new end date. Guards see the day's gate notices but never balances.

### Estate data export (platform.md §6)

19. Modules register their own datasets with a global `EstateExportRegistry` (no module reads another's tables). The worker builds a ZIP of CSV and JSON per dataset with a small built-in ZIP writer (`zlib` deflate, no new dependency). CSV cells that a spreadsheet would evaluate are prefixed with `'`.
20. The ZIP is stored privately at `exports/<estate>/<export>.zip` for 7 days. Instead of one 7-day link, each download request mints a **15-minute** signed link and is audited. The archive is not password-encrypted (standard tools cannot open AES ZIPs reliably); protection is private storage, server-side encryption and short links. Credentials and secrets are left out (pass PIN material, token hashes, provider codes, IPs and user agents in the audit log). Uploaded files are not yet included.

## Consequences

- Billing can read owners (property) and consumption (utilities) without cycles; moves read balances from billing.
- Open product decisions: who collects prepaid token money; co-owner invoice splitting; whether exports must include uploaded files and be password-protected.
