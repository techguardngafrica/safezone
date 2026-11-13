# Module: Facilities and Bookings

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 3 · Owner: Backend · Apps: resident-mobile, management-web, management-mobile

## 1. Responsibility

Facilities manages **shared estate facilities** and their **reservations**: event halls, swimming pools, gyms, sports courts, guest houses, parking spaces and others — availability, booking rules, pricing, approvals, payments, cancellations, usage limits, maintenance blackouts, damage reports and utilisation.

## 2. Capabilities

1. Facility registration: name, type, location (space), capacity, photos, description, rules, amenities.
2. Availability: opening hours, slot length or free-form time ranges, blackout dates.
3. Booking rules: who can book (residents, owners, staff), advance window (e.g. up to 30 days ahead), minimum/maximum duration, per-household limits (per week/month), buffer between bookings, guest limits.
4. Pricing: free, flat per booking, per hour, per day, deposit; resident vs guest rates.
5. Approval: auto-confirm or manager approval.
6. Payment via [payments](payments.md) (pay at booking or after approval); deposits refundable.
7. Cancellation policy: free until X hours before, partial refund after, no refund within Y hours.
8. Guest passes linked to bookings (e.g. event guests) via [visitor](visitor.md).
9. Maintenance scheduling blocks (from [maintenance](maintenance.md)).
10. Check-in (optional) and no-show marking.
11. Damage reporting with photos; deposit deduction workflow.
12. Utilisation reports.

## 3. Data model

| Table                   | Key columns                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `facilities`            | `id`, `estate_id`, `space_id`, `name`, `type`, `capacity`, `description`, `photos`, `rules_text`, `status` (active, closed, maintenance)                                                                                                                                                                                       |
| `facility_availability` | `facility_id`, `day_of_week`, `open_time`, `close_time`, `slot_minutes`                                                                                                                                                                                                                                                        |
| `facility_blackouts`    | `id`, `facility_id`, `starts_at`, `ends_at`, `reason`                                                                                                                                                                                                                                                                          |
| `facility_policies`     | `facility_id`, `who_can_book`, `advance_days`, `min_minutes`, `max_minutes`, `limit_per_household` (jsonb), `buffer_minutes`, `max_guests`, `requires_approval`, `cancellation` (jsonb)                                                                                                                                        |
| `facility_prices`       | `facility_id`, `basis` (flat, hourly, daily), `amount`, `deposit`, `guest_amount`                                                                                                                                                                                                                                              |
| `bookings`              | `id`, `estate_id`, `facility_id`, `booked_by`, `household_id`, `starts_at`, `ends_at`, `guests`, `purpose`, `status` (pending_approval, pending_payment, confirmed, cancelled, completed, no_show, rejected), `price`, `deposit`, `payment_intent_id`, `visitor_invitation_id`, `approved_by`, `cancelled_at`, `refund_amount` |
| `damage_reports`        | `id`, `estate_id`, `facility_id`, `booking_id`, `description`, `photos`, `reported_by`, `deduction_amount`, `status`                                                                                                                                                                                                           |

Exclusion constraint on `bookings` (facility, tstzrange) for confirmed/pending bookings to prevent overlaps.

## 4. Booking flow

1. Resident picks facility, date and time; app shows availability.
2. API checks policy (who, advance window, duration, limits, buffer, blackouts) and overlap atomically.
3. Booking created as `pending_approval` (if approval needed) or `pending_payment` (if priced) or `confirmed`.
4. Payment within 30 min hold window, else released.
5. Confirmation notification; guest passes if guests listed.
6. Reminders 24 h and 1 h before.
7. After end: `completed`; damage report window 24 h; deposit refunded or deducted.

## 5. Business rules

1. No overlapping confirmed bookings (DB constraint).
2. Unpaid holds expire after 30 minutes.
3. Cancellation refunds follow the facility policy at cancellation time.
4. Managers can override rules with a reason (audited).
5. Households with unpaid dues above a threshold can be blocked from paid facilities (estate setting).
6. Maintenance blackout creation notifies affected bookers and offers rebooking or refund.

## 6. API

| Method         | Path                                                                                            | Purpose     |
| -------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| GET/POST/PATCH | `/v1/estates/:estateId/facilities[/:id]`                                                        | Facilities  |
| PUT            | `/v1/estates/:estateId/facilities/:id/policy` · `/prices` · `/availability`                     | Rules       |
| POST           | `/v1/estates/:estateId/facilities/:id/blackouts`                                                | Blackouts   |
| GET            | `/v1/estates/:estateId/facilities/:id/availability?date=`                                       | Free slots  |
| POST           | `/v1/estates/:estateId/bookings`                                                                | Book        |
| GET            | `/v1/estates/:estateId/bookings?mine=true&facilityId=&date=`                                    | List        |
| POST           | `/v1/estates/:estateId/bookings/:id/approve` · `/reject` · `/cancel` · `/check-in` · `/no-show` | Transitions |
| POST           | `/v1/estates/:estateId/bookings/:id/damage-reports`                                             | Damage      |
| GET            | `/v1/estates/:estateId/reports/facilities`                                                      | Utilisation |

## 7. Events

`facilities.booking.created`, `facilities.booking.confirmed`, `facilities.booking.cancelled`, `facilities.booking.completed`, `facilities.damage.reported`.

## 8. Acceptance criteria

- Two residents trying to book the same slot at the same moment: one succeeds, one gets a clear conflict message.
- Unpaid holds release at 30 minutes.
- Cancellation refund amounts match the policy.
