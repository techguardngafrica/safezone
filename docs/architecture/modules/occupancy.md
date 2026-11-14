# Module: Occupancy (residents, households, tenancies)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (residents, households, join requests), 2 (move-in/move-out, lease expiry) · Owner: Backend · Apps: resident-mobile, management-web, management-mobile

## 1. Responsibility

Occupancy models **who lives in or uses a unit**: households, household members and their permissions, residential tenancies, domestic staff, vehicles, emergency contacts, join requests and approvals, and move-in/move-out. Gate access, building channel membership and resident billing are all derived from active occupancy.

## 2. Capabilities

1. Join requests: a user asks to join an estate and unit as owner-occupier, tenant or household member.
2. Approval chain per estate policy (owner, manager, or both; manager override).
3. Households linked to a unit; household head; multiple households per unit not allowed by default (configurable for shared flats).
4. Household members with configurable permissions (invite visitors, trigger SOS, pay, receive gate alerts, view bills).
5. Residential tenancies: start/end dates, lease document, landlord (owner) link.
6. Domestic staff registration (cleaner, driver, nanny, security, other) with schedule and photo.
7. Vehicles: plate, make, model, colour, photo, sticker/tag number.
8. Emergency contacts (with consent text).
9. Resident invitations by managers or household heads.
10. Move-in and move-out workflows (Phase 2).
11. Lease expiry reminders and automatic end-of-occupancy actions.
12. Resident privacy settings (show phone to neighbours, show in directory).
13. Multiple estates and multiple units per person.

## 3. Data model

| Table                | Key columns                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `households`         | `id`, `estate_id`, `space_id`, `head_user_id`, `name`, `status` (active, ended)                                                                                                                                                                                                     |
| `household_members`  | `id`, `estate_id`, `household_id`, `user_id`, `relationship` (head, spouse, child, relative, tenant_co_occupant, other), `is_minor` (bool; minors get no app account by default), `status`, `joined_at`, `left_at`                                                                  |
| `occupancies`        | `id`, `estate_id`, `space_id`, `household_id`, `type` (owner_occupier, tenant, staff_quarters, other), `starts_on`, `ends_on`, `status` (pending, active, ending, ended), `lease_file_id`, `landlord_ownership_id`                                                                  |
| `join_requests`      | `id`, `estate_id`, `user_id`, `space_id`, `relationship` (owner, tenant, household_member), `household_id` (target), `evidence_file_ids`, `status` (submitted, awaiting_owner, awaiting_manager, approved, rejected, cancelled, info_requested), `decided_by`, `reason`, timestamps |
| `domestic_staff`     | `id`, `estate_id`, `household_id`, `name`, `phone`, `photo_file_id`, `role`, `schedule` (jsonb days/hours), `gate_ids`, `status` (pending, active, suspended, ended), `approved_by`                                                                                                 |
| `vehicles`           | `id`, `estate_id`, `household_id`, `plate_normalised`, `plate_display`, `make`, `model`, `colour`, `photo_file_id`, `tag_number`, `status`                                                                                                                                          |
| `emergency_contacts` | `id`, `estate_id`, `user_id`, `name`, `phone`, `relationship`, `consent_confirmed_at`                                                                                                                                                                                               |
| `resident_privacy`   | `user_id`, `estate_id`, `show_phone_to_neighbours`, `show_in_directory`                                                                                                                                                                                                             |
| `move_events`        | `id`, `estate_id`, `occupancy_id`, `type` (move_in, move_out), `scheduled_on`, `gate_notice` (trucks, items), `checklist` (jsonb), `status`                                                                                                                                         |

## 4. Join request flow

1. Resident submits request in the app (unit, relationship, optional evidence like tenancy agreement).
2. Routing by estate setting `tenant_approval`:
   - Tenant → owner approves (Owner mode) → manager approves (or manager overrides if owner unreachable).
   - Owner-occupier → manager approves after checking ownership record.
   - Household member → household head approves (manager not needed unless configured).
3. On approval: membership `active`, household/occupancy created or updated, role assignment (Resident + Homeowner/Tenant/Household Member), building channels joined, welcome notification.
4. On rejection: reason sent to requester.
5. Requests not decided in 7 days remind approvers; after 30 days they expire.

## 5. Move-out flow (Phase 2)

1. Tenant, owner or manager schedules move-out (date, items/vehicles for gate notice).
2. Checks: outstanding balance (warn; estate decides if blocking), returned access tags.
3. On move-out date (job): occupancy → `ended`; recurring visitor and staff passes revoked; vehicles deactivated; household members' memberships for that unit ended; building channel memberships removed; role assignments revoked if no other unit in estate.
4. Owner notified; unit status → vacant (if no other occupancy).

Lease expiry: reminders at 60, 30 and 7 days before `ends_on`; at expiry, occupancy moves to `ending` and managers decide (renew or move out).

## 6. Business rules

1. A unit can have one active owner-occupier household or one active tenant household (unless the estate allows shared occupancy).
2. A user can be in many households across units and estates.
3. Household head controls member permissions; managers can override.
4. Minors are recorded as household members without app accounts unless a guardian adds one (with restricted features).
5. Domestic staff need manager approval if `staff_pass.requires_manager_approval`.
6. Plates are normalised (uppercase, no spaces/dashes) and unique per estate among active vehicles.
7. Emergency contacts require the user to confirm they have the contact's consent.
8. Ending an occupancy never deletes history.

## 7. API

| Method          | Path                                                                            | Purpose                                  |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| POST            | `/v1/estates/:estateId/join-requests`                                           | Request to join                          |
| GET             | `/v1/estates/:estateId/join-requests?status=`                                   | Approvals queue                          |
| POST            | `/v1/estates/:estateId/join-requests/:id/approve` · `/reject` · `/request-info` | Decide                                   |
| GET             | `/v1/estates/:estateId/residents?q=&spaceId=`                                   | Resident directory (management)          |
| GET             | `/v1/estates/:estateId/households/:id`                                          | Household detail                         |
| POST            | `/v1/estates/:estateId/households/:id/members`                                  | Invite member                            |
| PATCH           | `/v1/estates/:estateId/household-members/:id`                                   | Permissions / relationship               |
| DELETE          | `/v1/estates/:estateId/household-members/:id`                                   | Remove member                            |
| GET/POST/PATCH  | `/v1/estates/:estateId/domestic-staff[/:id]`                                    | Staff                                    |
| GET/POST/PATCH  | `/v1/estates/:estateId/vehicles[/:id]`                                          | Vehicles                                 |
| GET             | `/v1/estates/:estateId/vehicles/lookup?plate=`                                  | Gate lookup                              |
| GET/POST/DELETE | `/v1/me/emergency-contacts`                                                     | Emergency contacts                       |
| POST            | `/v1/estates/:estateId/occupancies/:id/move-out`                                | Schedule move-out                        |
| POST            | `/v1/estates/:estateId/occupancies`                                             | Manager creates occupancy (incl. import) |

## 8. Events

`occupancy.join_request.submitted`, `occupancy.join_request.approved`, `occupancy.join_request.rejected`, `occupancy.occupancy.started`, `occupancy.occupancy.ended`, `occupancy.member.added`, `occupancy.member.removed`, `occupancy.staff.approved`, `occupancy.vehicle.registered`, `occupancy.lease.expiring`.

Consumers: visitor (revoke passes on end), community (channel membership), billing (who is billed), notifications, analytics.

## 9. Privacy

- Directory visibility follows `resident_privacy`.
- Guards see name, unit and vehicle; phone only if estate setting allows.
- Emergency contacts visible only to the user and SOS responders during an active alert.

## 10. Acceptance criteria

- A tenant join request routes to the owner first, then the manager, per estate setting.
- Ending an occupancy revokes all recurring passes for that household within 1 minute.
- A household member without `visitor.invite` cannot create passes.

## 11. Phase 1 implementation notes

Built in `src/modules/occupancy` ([ADR-0011](../adr/0011-occupancy-and-sos-implementation.md)):

- Tables `households`, `household_members` (permissions JSON: `inviteVisitors`, `triggerSos`, `payBills`, `viewBills`, `receiveGateAlerts`), `occupancies`, `join_requests`, `vehicles`, `domestic_staff` (tenant RLS) and `platform.emergency_contacts` (own rows; read by the `emergency` context). One active household per unit, one open request per user and unit, active plates unique per estate: all enforced by partial unique indexes.
- Join: `GET /v1/join/estates/:code`, `GET …/:code/units?q=`, `POST/GET /v1/me/join-requests`, `POST /v1/me/join-requests/:id/cancel`; decisions at `GET /v1/estates/:estateId/join-requests` and `…/:id/approve|reject`. Approval creates the household, occupancy, membership and role in one transaction and marks the unit occupied.
- Households: `GET …/households/mine`, `GET …/households/:id`, `POST …/households/:id/members`, `PATCH/DELETE …/household-members/:id`; managers: `POST …/occupancies`, `POST …/occupancies/:id/end` (members leave, vehicles and staff end, unit vacant, resident roles and memberships released; visitor passes revoked by the visitor worker). `GET …/residents` (staff with `resident.read`; phones masked without `pii.view`).
- Vehicles (`GET/POST …/vehicles`, `POST …/vehicles/:id/deactivate`, guard lookup `GET …/vehicles/lookup?plate=` returning unit, household name and vehicle only), domestic staff (`GET/POST …/domestic-staff`, `POST …/domestic-staff/:id/status`; manager approval per `staff_pass.requires_manager_approval`), emergency contacts (`/v1/me/emergency-contacts`, consent required, at most 5).
- **Not yet built:** owner approval step (needs Phase 2 ownerships), 7-day reminders and 30-day expiry job (expiry is stored, not yet enforced by a job), resident privacy settings, move-in/out (Phase 2).
