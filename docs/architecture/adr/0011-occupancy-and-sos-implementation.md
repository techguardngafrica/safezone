# ADR-0011: Occupancy join flow and SOS implementation choices

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** occupancy, emergency, notifications, property, identity

## Context

occupancy.md and emergency.md propose paths and tables written before the authorization guard existed. The guard returns 404 on estate routes to anyone who is not yet a member, ownership records are Phase 2, and there is no voice provider or realtime emitter yet.

## Decision

1. **Joining happens outside estate routes:** `GET /v1/join/estates/:code`, `GET /v1/join/estates/:code/units?q=` (code and name only, rate-limited per user) and `POST /v1/me/join-requests` instead of `POST /v1/estates/:estateId/join-requests`. Decisions stay under the estate (`…/join-requests/:id/approve|reject`).
2. **Approval routing:** household members go to the household head; owners to managers; tenants to the owner when one is known and the policy involves owners, otherwise the manager. Ownership records arrive in Phase 2, so today tenant requests go to managers. Managers (estate staff holding `resident.approve`, not homeowners) may override any open step. The status `awaiting_household_head` is added to the doc's list.
3. **Managers add residents by phone:** `IdentityService.findOrCreateByPhone` creates an unverified user; they verify the phone at first sign-in.
4. **SOS escalation policy is the estate setting `sos.escalation`** (already validated, defaults 60/120/180 s) rather than a separate `escalation_policies` table.
5. **The SOS timeline (`sos_events`) records notifications too**; there is no separate `sos_notifications` table. Per-message delivery rows are in the notifications module (`notification_deliveries`, `contact_deliveries`).
6. **SOS fan-out runs only on the `sos` queue's own worker** and calls the notification delivery service directly, never through the shared `notifications` queue. Responders get push and SMS together (the `emergency.sos` intent sends SMS even when push succeeds).
7. **Not yet available, recorded as gaps rather than simulated:** voice calls (the 180 s step sends SMS to emergency contacts and records `voice: not_configured_sms_sent`), realtime emits to `estate:<id>:sos`, and SMS-triggered SOS (needs the provider's signed inbound webhook). Recipients are every guard and supervisor of the estate until shift sessions exist.

## Consequences

- Residents can find and join an estate with only its code; unit lists expose codes and names, nothing about occupants.
- The tenant-to-owner approval step switches on automatically once property records owners.
- SOS delivery does not depend on the health of the shared notification queue.
