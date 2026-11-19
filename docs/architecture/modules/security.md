# Module: Security Operations

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (gates, guards, incidents, shifts), 5 (patrols, security companies) · Owner: Backend · Apps: security-mobile, management-web, management-mobile

## 1. Responsibility

Security owns the **security operation of an estate**: gates, security personnel and their assignments, gate devices (with identity), shifts and attendance, handovers, incidents and suspicious activity, patrols and checkpoints, vehicle movement records, unauthorised access alerts and security performance reports. Visitor passes and gate decisions are in [visitor](visitor.md); SOS is in [emergency](emergency.md).

## 2. Capabilities

1. Gates: name, type (pedestrian, vehicle, both), operating hours, status.
2. Security personnel registration (in-house guards) and profile.
3. Gate assignments and scoped roles (guard at Gate A).
4. Gate device registration (with [identity](identity.md)) and status.
5. Shift templates and rosters; shift start/end through PIN sign-in.
6. Attendance from sign-in/out; late/absent flags.
7. Shift handover notes and open-items carry-over.
8. Incident reporting (guards, residents, managers) with categories, severity, evidence and assignment.
9. Suspicious activity and unauthorised access alerts (e.g. repeated DENY at a gate, override spikes).
10. Vehicle movement log (from gate events) and lookups.
11. Patrol routes, checkpoints (QR/NFC tags), patrol logs, missed checkpoint alerts (Phase 5).
12. Security companies serving multiple estates (Phase 5).
13. Security performance reports.

## 3. Data model

| Table                                                  | Key columns                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gates`                                                | `id`, `estate_id`, `name`, `type`, `hours` (jsonb), `status`, `space_id` (location)                                                                                                                                                                                                                                                         |
| `security_personnel`                                   | `id`, `estate_id`, `user_id`, `staff_number`, `employer_type` (estate, security_company), `security_company_id`, `photo_file_id`, `status`                                                                                                                                                                                                  |
| `gate_assignments`                                     | `id`, `estate_id`, `personnel_id`, `gate_id`, `valid_from`, `valid_to`                                                                                                                                                                                                                                                                      |
| `shift_templates`                                      | `id`, `estate_id`, `name`, `start_time`, `end_time`, `days`                                                                                                                                                                                                                                                                                 |
| `shift_rosters`                                        | `id`, `estate_id`, `date`, `template_id`, `gate_id`, `personnel_id`                                                                                                                                                                                                                                                                         |
| `shift_sessions`                                       | `id`, `estate_id`, `personnel_id`, `device_id`, `gate_id`, `started_at`, `ended_at`, `handover_note`, `roster_id`                                                                                                                                                                                                                           |
| `incidents`                                            | `id`, `estate_id`, `category`, `severity` (low, medium, high, critical), `title`, `description`, `location_space_id`, `gate_id`, `occurred_at`, `reported_by`, `reporter_type` (guard, resident, manager), `status` (reported, under_review, assigned, resolved, closed), `assigned_to`, `resolution`, `linked_sos_id`, `police_report_ref` |
| `incident_evidence`                                    | `id`, `estate_id`, `incident_id`, `file_id`, `sha256`, `uploaded_by`, `uploaded_at`                                                                                                                                                                                                                                                         |
| `security_alerts`                                      | `id`, `estate_id`, `type` (repeated_denies, override_spike, unanswered_walkins, device_offline), `details`, `status`, `acknowledged_by`                                                                                                                                                                                                     |
| `patrol_routes` / `patrol_checkpoints` / `patrol_logs` | Phase 5: route, ordered checkpoints with tag ids, scans with time and guard                                                                                                                                                                                                                                                                 |
| `security_companies`                                   | Phase 5: platform-level org; `estate_security_contracts` link companies to estates                                                                                                                                                                                                                                                          |

## 4. Business rules

1. A guard can act only at gates they are assigned to (scoped role), unless they are a supervisor.
2. Shift session starts at PIN sign-in; one active session per device.
3. Attendance: late if sign-in > 15 min after roster start; absent if no sign-in by +60 min (alerts supervisor).
4. Handover note required at shift end (can be "nothing to report").
5. Incidents are never deleted; corrections append notes.
6. Evidence files are hashed (SHA-256) at upload; the hash and uploader are stored for chain of custody.
7. Residents can report incidents but see only their own reports.
8. Critical incidents notify the supervisor and managers immediately.
9. Security alerts are generated by rules over gate events (e.g. ≥ 3 denies for the same plate in 1 hour).

## 5. API

| Method         | Path                                                      | Purpose                                 |
| -------------- | --------------------------------------------------------- | --------------------------------------- |
| GET/POST/PATCH | `/v1/estates/:estateId/gates[/:id]`                       | Gates                                   |
| GET/POST/PATCH | `/v1/estates/:estateId/security-personnel[/:id]`          | Personnel                               |
| POST           | `/v1/estates/:estateId/security-personnel/:id/pin-reset`  | Reset PIN                               |
| GET/POST       | `/v1/estates/:estateId/gate-devices`                      | Register device (returns one-time code) |
| POST           | `/v1/devices/register`                                    | Device redeems code                     |
| DELETE         | `/v1/estates/:estateId/gate-devices/:id`                  | Deregister                              |
| GET/POST       | `/v1/estates/:estateId/shift-templates`, `/shift-rosters` | Rosters                                 |
| POST           | `/v1/estates/:estateId/shift-sessions/:id/end`            | End shift with handover                 |
| GET            | `/v1/estates/:estateId/shift-sessions/current?gateId=`    | Current shift + last handover           |
| GET            | `/v1/estates/:estateId/attendance?from=&to=`              | Attendance                              |
| POST           | `/v1/estates/:estateId/incidents`                         | Report incident                         |
| GET/PATCH      | `/v1/estates/:estateId/incidents[/:id]`                   | Manage incidents                        |
| POST           | `/v1/estates/:estateId/incidents/:id/evidence`            | Add evidence                            |
| GET            | `/v1/estates/:estateId/incidents/:id/export`              | Evidence pack (PDF + files, audited)    |
| GET            | `/v1/estates/:estateId/security-alerts`                   | Alerts                                  |
| GET            | `/v1/estates/:estateId/reports/security?from=&to=`        | Performance report                      |

## 6. Events

`security.shift.started`, `security.shift.ended`, `security.attendance.late`, `security.attendance.absent`, `security.incident.reported`, `security.incident.assigned`, `security.incident.resolved`, `security.alert.raised`, `security.device.registered`, `security.device.offline`.

## 7. Jobs

- `security.attendance.check` — every 5 min against rosters.
- `security.alerts.evaluate` — consumes gate events.
- `security.devices.heartbeat` — flags devices silent > 30 min during operating hours.

## 8. Reports

Gate throughput by hour, average verification time, overrides, denies, walk-in response times, attendance rate, incidents by category and resolution time, device uptime.

## 9. Acceptance criteria

- A guard not assigned to Gate B cannot record events there.
- An incident evidence export includes file hashes matching the stored originals.
- A device silent for 30 minutes in operating hours raises an alert to the supervisor.

## 9. Phase 1 implementation notes (so far)

Built in `src/modules/security`: `tenant.gates` and `GET/POST/PATCH /v1/estates/:estateId/gates` (`security.staff.manage` to change). Registers the setup wizard's `gates` verifier.

**Incidents (19 Nov 2026).** Tables `tenant.incidents`, `tenant.incident_evidence` and `tenant.incident_notes` (migration `20261119120000_security_incidents`), with RLS, no DELETE grant on incidents, and append-only triggers on evidence and notes. Endpoints, all under `/v1/estates/:estateId/incidents`:

| Method | Path              | Permission                             | Notes                                                                                                               |
| ------ | ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/`               | `incident.report` or `incident.manage` | Reporter type comes from the caller's roles; evidence must be the caller's own finished `incident_evidence` uploads |
| GET    | `/`               | `incident.report` or `incident.manage` | Managers see all; others see incidents they reported or are assigned (rule 7). Cursor paged                         |
| GET    | `/:id`            | same                                   | With evidence (hash, uploader, upload time) and the timeline                                                        |
| POST   | `/:id/notes`      | same                                   | Append-only; refused once closed                                                                                    |
| POST   | `/:id/evidence`   | same                                   | Up to 30 files per incident; hash copied from the file record                                                       |
| POST   | `/:id/transition` | `incident.manage`                      | `review`, `assign`, `resolve`, `reopen`, `close`; the body carries the `version` seen (optimistic concurrency)      |

Decisions made while building, open to review:

- The status set has no separate "under review" step after assignment; `assign` works from reported, under review or assigned (reassign). `reopen` goes from resolved back to under review.
- Assignees must hold an estate role with `incident.manage` or `gate.verify`.
- Critical incidents notify every holder of an estate role with `incident.manage` (`security.incident_critical`, push and SMS without push). Status changes notify the reporter and a new assignee (`security.incident_updated`).
- Events: `security.incident.reported`, `.reviewed`, `.assigned`, `.resolved`, `.reopened`, `.closed`, `.noted`, `.evidence_added`, each audited.
- The evidence export (PDF pack) and `linked_sos_id` input are not built yet.

**Not yet built:** security personnel, gate assignments, shift templates, rosters and sessions (PIN sign-in, kiosk), attendance, handovers, security alerts, gate-device registration, incident evidence export.
