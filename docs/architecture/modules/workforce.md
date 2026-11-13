# Module: Workforce (staff and HR)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (staff profiles, departments, role links), 5 (attendance, leave, rosters, payroll export) · Owner: Backend · Apps: management-web, management-mobile, security-mobile

## 1. Responsibility

Workforce manages **estate employees** (not residents, not vendors): staff profiles, departments, role assignments links, duty assignments, attendance, shift scheduling for non-security staff, leave, employment documents, salary records, payroll export, activity history and performance. Security personnel profiles and gate shifts live in [security](security.md) but share the staff profile here.

## 2. Capabilities

1. Staff profiles: name, phone, photo, staff number, department, job title, employment type (full-time, part-time, contract), start date, emergency contact, status.
2. Departments (administration, finance, facility, security, maintenance, cleaning, landscaping).
3. Link to app access: invite staff to the management app or Security App with roles (via [authz](authz.md)).
4. Duty assignments (areas, tasks, buildings).
5. Shift scheduling and rosters for non-security staff (Phase 5).
6. Attendance: clock-in/out in the management mobile app (with optional geofence), or from security shift sessions; timesheets.
7. Leave: types, balances, requests, approvals, calendar.
8. Employment documents (contract, ID, guarantor forms) via [documents](documents.md), with expiry.
9. Salary records (amount, allowances, deductions) — restricted to finance/HR roles.
10. Payroll export (CSV for payroll provider / bank bulk payment); payroll integration later.
11. Staff activity history (work orders completed, attendance, incidents handled).
12. Performance reports.

## 3. Data model

| Table                                               | Key columns                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `staff`                                             | `id`, `estate_id`, `user_id`, `staff_number`, `department_id`, `job_title`, `employment_type`, `start_date`, `end_date`, `status`, `emergency_contact` |
| `departments`                                       | `id`, `estate_id`, `name`, `head_staff_id`                                                                                                             |
| `duty_assignments`                                  | `id`, `estate_id`, `staff_id`, `description`, `space_ids`, `valid_from`, `valid_to`                                                                    |
| `staff_rosters`                                     | `id`, `estate_id`, `staff_id`, `date`, `start_time`, `end_time`                                                                                        |
| `attendance_records`                                | `id`, `estate_id`, `staff_id`, `clock_in`, `clock_out`, `source` (app, security_shift, manual), `geo_ok`, `approved_by`                                |
| `leave_types` / `leave_balances` / `leave_requests` | Types per estate; balances per year; requests with status                                                                                              |
| `salary_records`                                    | `id`, `estate_id`, `staff_id`, `basic`, `allowances` (jsonb), `deductions` (jsonb), `effective_from` — encrypted columns                               |
| `payroll_exports`                                   | `id`, `estate_id`, `period`, `file_id`, `created_by`                                                                                                   |

## 4. Business rules

1. Salary data visible only to roles with `payroll.view` (Estate Accountant, Estate Owner by default).
2. A staff member leaving ends their role assignments and device access on `end_date`.
3. Attendance edits need approval and are audited.
4. Leave approval cannot be done by the requester.

## 5. API (selection)

`/v1/estates/:estateId/staff` (CRUD, `/invite`, `/offboard`), `/departments`, `/duty-assignments`, `/staff-rosters`, `/attendance` (+ `/clock-in`, `/clock-out`), `/leave-requests` (+ `/approve`), `/salary-records`, `/payroll-exports`, `/reports/staff`.

## 6. Events

`workforce.staff.onboarded`, `workforce.staff.offboarded`, `workforce.attendance.recorded`, `workforce.leave.approved`.

## 7. Acceptance criteria

- Offboarding a staff member revokes all their estate roles and signs them out of all devices.
- An Estate Manager without `payroll.view` cannot read salary records through any endpoint.
