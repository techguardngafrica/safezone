# ADR-0008: Estate onboarding implementation

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** tenancy module (onboarding), authz, files, notifications, authorization guard, public-web, super-admin, management-web

## Context

tenancy.md §4–§9 proposes the two onboarding workflows, their tables and endpoints. Building them raised five questions the doc leaves open: how approval grants a role owned by another module atomically, where invitation links and their tokens live, which endpoints need a signed-in caller, how a suspended estate is enforced, and how to check duplicates without PostGIS.

## Decision

1. **Cross-module work in one transaction.** `asModule(tx, context, fn)` switches `app.context` inside the caller's transaction and restores it. Only a module's exported service uses it for its own tables (`AuthzService.assignBuiltInRole`), so approval creates the estate, membership and Estate Administrator assignment atomically. This amends ADR-0005: fencing is still per module, but a module may do its part inside another module's transaction.
2. **Invitation tokens are derived, never stored.** The token is `HMAC-SHA256(OTP_HMAC_SECRET, "estate-invitation:v1:<id>")` (base64url, 43 characters). Only its SHA-256 is stored, for lookup. The API writes `tenancy.invitation.sent` with the invitation id only; the worker (`onboarding` queue) derives the token again and sends the link by SMS and email through `ContactDeliveryService`, which records masked addresses in `contact_deliveries` and sends each channel once. Rotating the secret invalidates open invitations.
3. **Endpoint paths.**
   - `POST /v1/me/estate-applications` (signed in) instead of `/v1/public/estate-applications`: step 1 of self-service is "create account", and the application needs the applicant's own uploaded documents.
   - `GET /v1/public/invitations/:token` previews an invitation; `POST /v1/invitations/:token/accept` needs a signed-in user whose verified phone is the invited one.
   - Added `POST /v1/me/estate-applications/:id/resubmit` and `/withdraw`, `POST /v1/platform/estate-applications/:id/start-review`, document download for reviewers, leads list/update, platform estate list/get, invitation list/revoke, and `POST /v1/estates/:estateId/setup-progress/:step/complete` and `/activate`.
   - Platform estate routes use `:id`, never `:estateId`, so the guard does not treat Techguard staff as estate members.
4. **Suspension** is enforced in the authorization guard: in a suspended estate, any non-read request is refused with `ESTATE_SUSPENDED` unless its permission is a safety action (`visitor.invite`, `gate.verify`, `incident.report`, `incident.manage`, `sos.trigger`, `sos.respond`, `broadcast.emergency`).
5. **Setup steps are verified where the facts are owned.** Modules register a verifier per step with `SetupVerifiers` (security supervisor is checked through authz today; property registers `spaces`, security registers `gates` when they land). Steps without a verifier are confirmed by the administrator. Activation re-runs every verifier.
6. **Duplicate check without PostGIS.** Applications store latitude/longitude as plain columns. The reviewer view compares significant name tokens (Jaccard) within the same state, and distance by haversine within 500 m. It flags, never blocks. Move to `geography` columns when PostGIS lands.
7. **Limits.** Three open applications per applicant, ten documents per application, at least one clean document before approval, five leads and thirty invitation previews per IP per hour.

## Consequences

- Approval and invitation acceptance cannot half-succeed.
- No live invitation token exists in the database, the outbox or logs; a database leak does not leak usable links.
- Staff who accept an invitation must complete MFA enrolment before any other request (expected: they now hold a staff role).
- Deactivated estates are unreachable through estate routes; the read-only offboarding period and data export arrive with Phase 2.
