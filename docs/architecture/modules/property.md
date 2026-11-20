# Module: Property (spaces and ownership)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (spaces), 2 (ownership transfers, owner mode) · Owner: Backend · Apps: management-web, management-mobile, resident-mobile (owner mode)

## 1. Responsibility

Property models **the physical estate** and **who owns what**: the hierarchy of phases, zones, streets, blocks, buildings, floors and units; unit attributes and status; ownership records, co-ownership, transfers and sales; and property documents and history. Who **lives** in a unit is [occupancy](occupancy.md); ownership and occupancy are deliberately separate.

## 2. Capabilities

1. Spaces tree with flexible depth: estate → phase → zone → street/block → building → floor → unit (estates use only the levels they need).
2. Unit records: code, type, size, bedrooms, status (occupied, vacant, under construction, reserved).
3. Unique property identifiers per estate (`<estate code>-<unit code>`).
4. Bulk creation (e.g. "Block C, floors 1–5, flats A–D") and bulk import.
5. Ownership records with share percentages, start/end dates and evidence.
6. Multiple owners per unit; company owners.
7. Ownership transfer and sale workflow (two-sided).
8. Vacant property management.
9. Property history (ownership, occupancy, charges, maintenance).
10. Property-level charges hook (used by billing).
11. Property documents (via [documents](documents.md)).
12. Common areas as spaces (pool, gym, gatehouse) for maintenance and facilities.

## 3. Data model

| Table                 | Key columns                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spaces`              | `id`, `estate_id`, `parent_id`, `type` (phase, zone, street, block, building, floor, unit, common_area), `code`, `name`, `path` (ltree, e.g. `p1.zoneA.blockC.b3.f2.c2a`), `unit_type` (house, flat, shop, office, other), `bedrooms`, `size_sqm`, `status`, `external_ref`, `archived_at` |
| `ownerships`          | `id`, `estate_id`, `space_id` (unit), `owner_type` (person, company), `owner_user_id`, `owner_company_name`, `share_pct`, `starts_on`, `ends_on`, `evidence_file_ids`, `verified_by`, `verified_at`, `status` (pending, active, ended)                                                     |
| `ownership_transfers` | `id`, `estate_id`, `space_id`, `from_ownership_ids`, `to_owner` (user/company + share), `type` (sale, gift, inheritance, correction), `effective_on`, `status` (requested, seller_confirmed, manager_approved, completed, rejected, cancelled), `documents`, `requested_by`                |
| `space_history`       | `id`, `estate_id`, `space_id`, `event_type`, `payload`, `occurred_at` (projection fed by events)                                                                                                                                                                                           |

Indexes: GiST on `path`, unique (`estate_id`, `path`), unique (`estate_id`, `code`) for units.

## 4. Business rules

1. A unit must have a parent; the root is the estate.
2. Unit codes are unique within an estate.
3. Ownership shares for active ownerships of a unit must total 100% (or 0% if owner unknown/estate-owned, flagged).
4. Ownership changes never edit history: a transfer ends existing ownerships and creates new ones.
5. A transfer needs: request (seller, buyer or manager), seller confirmation (or manager override with documents), manager approval.
6. Archiving a space requires no active occupancy, no open invoices and no children.
7. Changing a unit's parent (re-parenting) updates `path` of the subtree in one transaction.
8. Owners see only their own units; managers see all.

## 5. Flows

### 5.1 Build the tree (setup wizard)

1. Create phases/zones/blocks as needed.
2. Bulk-create buildings and units with a pattern.
3. Or import from template (`external_ref`, parent path, code, type, bedrooms).

### 5.2 Ownership transfer

1. Manager or owner opens transfer: unit, new owner (phone or company), share, type, effective date, documents.
2. Current owner(s) confirm in Owner mode (or manager overrides with documents).
3. Manager approves.
4. On completion: old ownerships ended, new ones active, history updated, owner-billed charges reassigned from effective date, notifications sent.

## 6. API

| Method   | Path                                                                                         | Purpose                   |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------- |
| GET      | `/v1/estates/:estateId/spaces?parentId=&type=`                                               | Browse tree               |
| POST     | `/v1/estates/:estateId/spaces`                                                               | Create space              |
| POST     | `/v1/estates/:estateId/spaces/bulk`                                                          | Pattern-based bulk create |
| PATCH    | `/v1/estates/:estateId/spaces/:id`                                                           | Update / re-parent        |
| POST     | `/v1/estates/:estateId/spaces/:id/archive`                                                   | Archive                   |
| GET      | `/v1/estates/:estateId/spaces/:id/history`                                                   | History                   |
| GET      | `/v1/estates/:estateId/units?status=&q=`                                                     | Unit search               |
| GET/POST | `/v1/estates/:estateId/units/:id/ownerships`                                                 | Ownerships                |
| POST     | `/v1/estates/:estateId/ownership-transfers`                                                  | Start transfer            |
| POST     | `/v1/estates/:estateId/ownership-transfers/:id/confirm` · `/approve` · `/reject` · `/cancel` | Transfer steps            |
| GET      | `/v1/me/owned-units`                                                                         | Owner mode                |

## 7. Events

`property.space.created`, `property.space.updated`, `property.space.archived`, `property.ownership.created`, `property.ownership.ended`, `property.transfer.requested`, `property.transfer.completed`.

Consumed by: occupancy (owner-occupier links), billing (who pays owner-billed charges), community (building channels), analytics.

## 8. Acceptance criteria

- A 1,000-unit estate tree can be created by pattern or import in under 5 minutes.
- "All units in Block C" returns in < 100 ms using the path index.
- A completed transfer shows the full before/after in unit history and moves owner-billed charges from the effective date.

## 9. Open questions

1. Is ownership verification by manager attestation enough, or should Techguard verify for some estates?
2. Do estates need land-title references (C of O numbers) on units?

## 10. Phase 1 implementation notes

Built in `src/modules/property` (path design in [ADR-0009](../adr/0009-spaces-materialised-path.md)):

- `tenant.spaces` with RLS; placement rules and the bulk pattern planner in `domain/spaces.ts` (unit-tested).
- `GET/POST /v1/estates/:estateId/spaces`, `POST …/spaces/bulk` (levels with ranges, letters or lists; `{label}`, `{parentCode}`, `{chain}` templates; unit codes default to `{chain}-{label}`, e.g. `C-1-A`; `dryRun` previews; up to 5,000 spaces in one transaction), `GET/PATCH …/spaces/:id` (If-Match on `version`; re-parenting moves the subtree), `POST …/spaces/:id/archive` (leaves only, not occupied units), `GET …/units?withinId=&status=&q=`.
- Units carry `propertyId` = `<estate code>-<unit code>`. Reads need membership; changes need `space.manage`. All routes require the `property` entitlement (core plan).
- Registers the setup wizard's `spaces` verifier (at least one live unit).
- **Not yet built:** `space_history` projection and `GET …/spaces/:id/history` (the audit log has the changes), ownerships and transfers (Phase 2), archive checks for open invoices (billing, Phase 2). Occupancy will set unit `status` to `occupied`/`vacant`.

## 11. Phase 2 implementation notes

- Ownerships (person or company with a contact person, shares in basis points, at most 100% active per unit, never deleted), transfers with seller confirmation or documented manager override, `property_owner` role kept in step. See [ADR-0014](../adr/0014-phase-2-operations-modules.md).
- `PropertyService.activeOwners` and `ownedUnits` serve billing, join routing and owner mode (`GET …/owned-units`, served by occupancy).
