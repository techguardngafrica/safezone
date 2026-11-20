# Module: Authorisation (authz)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 (foundation) · Owner: Backend · Used by: every module and app

## 1. Responsibility

Authz decides **what a signed-in user may do, where**. It owns roles, permissions, role assignments (scoped to an estate and optionally to a part of it), custom estate roles, temporary permissions and the policy engine every endpoint and realtime room uses.

## 2. Capabilities

1. Permission catalogue (`resource.action` strings) owned in `packages/permissions`, shared with all apps.
2. Built-in roles at platform, estate, vendor and advertiser levels.
3. Custom estate roles composed from the catalogue.
4. Role assignments scoped by estate and optional scope (building, gate, department, facility).
5. Multiple roles per user, across multiple estates.
6. Temporary assignments with start/end times.
7. Household-level permissions (set by the household head) for residents.
8. Resource-level rules (e.g. "own requests only", "own household only").
9. Assignment history and revocation.
10. Policy evaluation API for the backend (`can(user, action, subject)`) and a permission snapshot for client UIs.

## 3. Role catalogue

### 3.1 Platform roles (Techguard)

Super Admin, Platform Administrator, Platform Support Agent, Platform Finance Officer, Platform Operations Officer, Platform Compliance Officer, Advertising Manager, Advertising Reviewer.

### 3.2 Estate roles

Estate Owner, Estate Administrator, Estate Manager, Estate Accountant, Facility Manager, Security Supervisor, Security Officer, Maintenance Officer, Procurement Officer, Resident, Homeowner, Tenant, Household Member, (Owner — non-resident property owner).

### 3.3 Vendor roles

Vendor Owner, Vendor Administrator, Vendor Employee, Vendor Service Personnel.

### 3.4 Advertiser roles

Advertiser, Advertiser Organisation Owner, Advertiser Account Manager, Advertising Agency Representative.

## 4. Permission examples

| Permission                | Default roles                                                                |
| ------------------------- | ---------------------------------------------------------------------------- |
| `estate.configure`        | Estate Owner, Estate Administrator                                           |
| `space.manage`            | Estate Administrator, Estate Manager                                         |
| `resident.approve`        | Estate Manager, Estate Administrator (+ Homeowner/Owner for their own units) |
| `pii.view`                | Estate Manager, Estate Administrator, Estate Accountant                      |
| `visitor.invite`          | Resident roles (household permission)                                        |
| `gate.verify`             | Security Officer, Security Supervisor                                        |
| `sos.trigger`             | Resident roles (household permission), Security roles                        |
| `sos.respond`             | Security roles, Estate Manager                                               |
| `announcement.publish`    | Estate Manager, Estate Administrator                                         |
| `broadcast.emergency`     | Estate Manager, Estate Administrator, Security Supervisor                    |
| `charge.manage`           | Estate Accountant, Estate Administrator                                      |
| `billing.run.approve`     | Estate Manager or Estate Owner (second approver)                             |
| `payment.refund`          | Estate Accountant (+ approver)                                               |
| `maintenance.assign`      | Facility Manager, Estate Manager                                             |
| `community.moderate`      | Estate Manager, assigned moderators                                          |
| `role.assign`             | Estate Owner, Estate Administrator                                           |
| `platform.estate.approve` | Platform Administrator, Super Admin                                          |
| `platform.support_access` | Platform Support Agent                                                       |
| `ad.campaign.review`      | Advertising Reviewer                                                         |

The full catalogue lives in `packages/permissions/catalogue.ts` with descriptions; changes go through code review.

## 5. Data model

| Table                          | Key columns                                                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles`                        | `id`, `level` (platform, estate, vendor, advertiser), `key`, `name`, `is_builtin`, `estate_id` (null for built-in; set for custom estate roles)                                                                                                                  |
| `role_permissions`             | `role_id`, `permission`                                                                                                                                                                                                                                          |
| `role_assignments`             | `id`, `user_id`, `role_id`, `estate_id` (nullable for platform), `vendor_id`, `advertiser_id`, `scope_type` (building, gate, department, facility, null), `scope_id`, `valid_from`, `valid_to`, `granted_by`, `granted_at`, `revoked_at`, `revoked_by`, `reason` |
| `household_member_permissions` | `household_member_id`, `permission` (visitor.invite, sos.trigger, payment.make, gate.alerts, bills.view)                                                                                                                                                         |

## 6. Policy evaluation

`can(user, action, subject, context)`:

1. Collect active assignments for the user (cached in Redis per user, invalidated on change).
2. Filter to the context: platform, or estate = request estate, or vendor/advertiser id.
3. Filter by scope: e.g. a Security Officer scoped to Gate A can verify passes only at Gate A.
4. Union permissions from matching roles.
5. Apply resource rules (CASL conditions): e.g. `maintenance.request.read` for residents only where `request.household_id ∈ user.households`.
6. For resident actions, intersect with household member permissions.
7. Return allow/deny (+ reason code for logs).

Backend usage:

```ts
@Can('visitor.pass.create')
@Post('estates/:estateId/visitor-passes')
create(@Body() dto, @CurrentUser() user) { ... }
```

Extra arguments are alternatives: `@Can('billing.run.create', 'billing.run.approve')` admits a user with either, so approvers can read what they approve ([ADR-0016](../adr/0016-approvers-read-what-they-approve.md)).

**Gate shift sessions** ([ADR-0017](../adr/0017-gate-devices-and-guard-pin-sessions.md)): a guard PIN session on a shared gate device reaches only its own estate (others answer 404), and only `GATE_SESSION_PERMISSIONS` from `@safezone/permissions` (`gate.verify`, `incident.report`, `sos.trigger`, `sos.respond`) that the guard already holds, whatever else their roles allow. Signed-in routes are refused unless marked `@AllowGateSession()` (profile, memberships, permission snapshot, sign-out, push token). The permission snapshot and memberships answer within the same ceiling.

Client usage: `GET /v1/me/permissions?estateId=` returns a compact permission snapshot used to show/hide UI.

## 7. Business rules

1. An estate must always have at least one active Estate Owner or Estate Administrator.
2. Only roles with `role.assign` can assign roles, and never a role with more permissions than they hold.
3. Custom roles can include only estate-level permissions.
4. Temporary assignments end automatically at `valid_to` (job every minute + check on evaluation).
5. Revoking an assignment ends sessions' cached permissions immediately (cache bust + realtime room eviction).
6. Platform roles cannot be granted from estate apps.
7. Platform access to tenant data requires an active support session or compliance task in addition to the platform role (enforced in the platform service path).
8. All assignment changes are audited.

## 8. API

| Method            | Path                                         | Purpose                            |
| ----------------- | -------------------------------------------- | ---------------------------------- |
| GET               | `/v1/me/permissions?estateId=`               | Permission snapshot                |
| GET               | `/v1/estates/:estateId/roles`                | List built-in + custom roles       |
| POST/PATCH/DELETE | `/v1/estates/:estateId/roles[/:id]`          | Manage custom roles                |
| GET               | `/v1/estates/:estateId/role-assignments`     | List assignments                   |
| POST              | `/v1/estates/:estateId/role-assignments`     | Assign role (with scope, validity) |
| DELETE            | `/v1/estates/:estateId/role-assignments/:id` | Revoke                             |
| GET               | `/v1/permissions/catalogue`                  | Catalogue with descriptions        |
| POST/DELETE       | `/v1/platform/staff/:userId/roles`           | Platform roles (Super Admin only)  |

## 9. Events

`authz.role.created`, `authz.role.updated`, `authz.assignment.granted`, `authz.assignment.revoked`, `authz.assignment.expired`.

## 10. Testing

- Table-driven tests: every built-in role × key permission.
- Scope tests (gate-scoped guard, building-scoped moderator).
- Escalation tests (cannot grant above own level).
- Cross-tenant tests (assignment in Estate A gives nothing in Estate B).

## 11. Acceptance criteria

- A user who is Estate Manager in Estate A and Tenant in Estate B sees management features only in Estate A.
- Revoking a role takes effect on the next request (no stale cache beyond 1 second).
- A household member without `visitor.invite` cannot create a pass via API, even if the UI is bypassed.

## 12. Phase 0 implementation notes

Built (`src/modules/authz`): `roles`, `role_permissions`, `role_assignments`; built-in roles seeded from `@safezone/permissions` (`pnpm db:seed`) with deterministic ids; `AuthorizationGuard` enforcing, per request, access declaration, MFA, estate membership (non-members get 404), the permission and `@RequiresFeature` entitlements; `GET /v1/me/permissions`, `GET /v1/me/memberships`, `GET /v1/permissions/catalogue`.

- Built-in role permissions are read from the package at runtime (code is the source of truth); custom roles use `role_permissions`.
- Assignments are read per request (no cache yet), so a revocation applies on the next request.
- Custom roles and staff assignment endpoints (`…/roles`, `…/staff`): custom roles carry only permissions found in built-in estate roles and that the creator holds; management roles (with `role.assign` or `estate.configure`) and custom roles can only be granted or revoked by someone holding all their permissions; built-in operational roles can be granted by any `role.assign` holder; nobody changes their own roles ([ADR-0020](../adr/0020-import-execution-support-enforcement-role-grants.md), rule pending product confirmation).
- `Grant.staffPermissions` / `EstateAccess.staffPermissions`: permissions held through staff roles only, for estate-wide reads such as global search.
- Not built yet: scope rules (gate, building), household permissions.
