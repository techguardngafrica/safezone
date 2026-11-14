# Module: Maintenance and Complaints

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 2 · Owner: Backend · Apps: resident-mobile, management-web, management-mobile, security-mobile (contractor passes)

## 1. Responsibility

Maintenance handles **requests and complaints from residents and staff** and the **work orders** that resolve them: submission, categorisation, priority, triage, approval, assignment to staff or vendors, scheduling, materials, costs, resolution, resident feedback, escalation, SLAs, recurring (planned) maintenance and reports.

## 2. Capabilities

1. Submit maintenance requests (unit or common area) and complaints (noise, neighbour, service quality, other).
2. Categories configurable per estate (plumbing, electrical, structural, cleaning, landscaping, security equipment, generator, water, pest control, other).
3. Priority: low, normal, high, urgent (urgent can page facility manager).
4. Image and video attachments (video up to 60 s / 50 MB).
5. Triage, approve, reject (with reason), request more info.
6. Work orders generated from requests or directly (planned work).
7. Assignment to estate staff or marketplace/approved vendors.
8. Scheduling with resident availability; contractor visitor pass auto-created for the visit window.
9. Materials and repair cost records (labour, parts); optional recharge to resident via billing.
10. Status updates and comments visible to the requester.
11. Resolution notes and photos; resident confirmation and rating.
12. SLA targets per priority with timers; escalation on breach.
13. Recurring maintenance schedules (e.g. generator service monthly, tank cleaning quarterly).
14. Reports: volume, resolution time, SLA compliance, cost, by category, by assignee.

## 3. Statuses

Request: `submitted → under_review → approved → assigned → in_progress → awaiting_materials → resolved → closed`; also `rejected`, `cancelled`, `info_requested`.

Work order: `open → scheduled → in_progress → on_hold → completed → verified → closed`; `cancelled`.

## 4. Data model

| Table                    | Key columns                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maintenance_categories` | `id`, `estate_id`, `name`, `default_priority`, `default_assignee_role`                                                                                                                                                                                                                               |
| `maintenance_requests`   | `id`, `estate_id`, `number`, `kind` (maintenance, complaint), `category_id`, `priority`, `space_id`, `common_area`, `title`, `description`, `preferred_times`, `requested_by`, `household_id`, `status`, `sla_due_at`, `rejection_reason`, `resolved_at`, `closed_at`, `rating`, `feedback`          |
| `request_attachments`    | `request_id`, `file_id`, `type`                                                                                                                                                                                                                                                                      |
| `request_comments`       | `id`, `request_id`, `author_id`, `body`, `internal` (bool), `created_at`                                                                                                                                                                                                                             |
| `work_orders`            | `id`, `estate_id`, `number`, `request_id` (nullable), `title`, `scope`, `assignee_type` (staff, vendor), `assignee_id`, `scheduled_start`, `scheduled_end`, `status`, `visitor_pass_id`, `labour_cost`, `materials_cost`, `recharge_to_resident` (bool), `invoice_id`, `completed_at`, `verified_by` |
| `work_order_materials`   | `work_order_id`, `item`, `quantity`, `unit_cost`, `inventory_item_id` (Phase 5)                                                                                                                                                                                                                      |
| `recurring_maintenance`  | `id`, `estate_id`, `title`, `space_id`, `rrule`, `assignee`, `next_run_at`                                                                                                                                                                                                                           |
| `sla_policies`           | `estate_id`, `priority`, `response_minutes`, `resolution_hours`                                                                                                                                                                                                                                      |

## 5. Business rules

1. Residents see only their household's requests and estate-wide complaints they filed.
2. Complaints about a named neighbour are visible only to management (never to the neighbour by default).
3. Only users with `maintenance.assign` can assign; assignees see only their work orders.
4. Assigning a vendor for an in-unit job creates a contractor visitor pass for the scheduled window.
5. SLA clock pauses in `info_requested` and `awaiting_materials`.
6. SLA breach notifies the facility manager; second breach level notifies the estate manager.
7. Recharge to resident needs manager approval and creates a billing invoice.
8. A request is `closed` automatically 7 days after `resolved` if the resident does not reopen it.
9. Reopening within 7 days returns it to `in_progress`.

## 6. API

| Method         | Path                                                                                                                      | Purpose                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| GET/POST/PATCH | `/v1/estates/:estateId/maintenance-categories`                                                                            | Categories                         |
| POST           | `/v1/estates/:estateId/maintenance-requests`                                                                              | Submit                             |
| GET            | `/v1/estates/:estateId/maintenance-requests?status=&mine=`                                                                | List                               |
| GET            | `/v1/estates/:estateId/maintenance-requests/:id`                                                                          | Detail                             |
| POST           | `/v1/estates/:estateId/maintenance-requests/:id/approve` · `/reject` · `/request-info` · `/resolve` · `/reopen` · `/rate` | Transitions                        |
| POST           | `/v1/estates/:estateId/maintenance-requests/:id/comments`                                                                 | Comment                            |
| POST           | `/v1/estates/:estateId/work-orders`                                                                                       | Create work order                  |
| PATCH          | `/v1/estates/:estateId/work-orders/:id`                                                                                   | Assign / schedule / status / costs |
| GET            | `/v1/estates/:estateId/work-orders?assignee=me`                                                                           | My work                            |
| GET/POST       | `/v1/estates/:estateId/recurring-maintenance`                                                                             | Planned work                       |
| GET/PUT        | `/v1/estates/:estateId/sla-policies`                                                                                      | SLAs                               |
| GET            | `/v1/estates/:estateId/reports/maintenance`                                                                               | Reports                            |

## 7. Events

`maintenance.request.submitted`, `maintenance.request.approved`, `maintenance.request.rejected`, `maintenance.request.resolved`, `maintenance.request.closed`, `maintenance.workorder.assigned`, `maintenance.workorder.completed`, `maintenance.sla.breached`.

## 8. Jobs

`maintenance.sla.check` (every 5 min), `maintenance.recurring.generate` (daily), `maintenance.autoclose` (daily).

## 9. Acceptance criteria

- A resident can submit a request with photos in under 1 minute and track every status change.
- Assigning a vendor to an in-unit job creates a matching contractor pass.
- SLA breach notifications fire at the right times, excluding paused periods.

## 10. Phase 2 implementation notes

Built in `src/modules/maintenance` ([ADR-0014](../adr/0014-phase-2-operations-modules.md)):

- Default categories seeded on first use; requests and complaints with the full status machine, comments (internal notes for staff), rating, reopen within 7 days, auto-close after 7 days.
- SLA policies per priority with pause and two escalation levels (5-minute job); work orders for staff or vendors with schedule, materials, labour cost, verification and recharge invoices; contractor visitor passes for scheduled vendor visits to units; planned (recurring) work orders; maintenance report.
- **Not yet built:** marketplace vendors (Phase 4), video length check (size is enforced by the files module), resident availability slots.
