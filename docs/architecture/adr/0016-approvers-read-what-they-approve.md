# ADR-0016: Approvers can read what they approve

- **Status:** Accepted
- **Date:** 2026-11-18
- **Deciders:** Sunday Etom Eni
- **Affects:** authz, billing, payments, management-web

## Context

Billing runs and office (manual) payments follow a two-person rule ([ADR-0012](0012-billing-ledger-and-invoices.md) §7, [ADR-0013](0013-payments-flow.md) §8): an accountant prepares or records them, and someone with `billing.run.approve` (estate owner, administrator, manager) approves them. Reading them, though, needed the preparer's permission: `GET billing-runs[/:id[/items]]` required `billing.run.create` and `GET manual-payments` required `payment.reconcile`. Approvers could call `approve` but could not list or open what they were approving, so the management web had no way to show them the queue.

`@Can()` accepted exactly one permission, so a route could not say "either of these".

## Decision

1. `@Can(permission, ...alternatives)` admits a user who holds the permission **or** any alternative. The rule is stored as `{ kind: 'permission', permission, alternatives? }`; `permits()` in `common/auth/auth.decorators.ts` is the single check the guard uses. Existing `@Can('x')` routes are unchanged.
2. Alternatives follow the same context rules as the primary permission: on routes without `:estateId`, every alternative must be a platform-level permission or the route fails at boot.
3. Suspension exemptions still key on the primary permission. The routes using alternatives are reads, which suspension allows anyway.
4. Reads opened to approvers:
   - `GET /v1/estates/:estateId/billing-runs`, `/billing-runs/:id`, `/billing-runs/:id/items`: `billing.run.create` or `billing.run.approve`.
   - `GET /v1/estates/:estateId/manual-payments`: `payment.reconcile` or `billing.run.approve`.
5. Writes are unchanged: approvers still cannot prepare, preview, submit, issue or cancel runs, or record office payments. No role gains a permission; the permission catalogue and built-in roles do not change.
6. The OpenAPI description lists each accepted permission ("Requires `a` or `b`.").

## Consequences

- Estate owners, administrators and managers see the Billing runs page and the office payments tab, and approve from them.
- Approvers now see run previews (unit codes, payer names, amounts) and office payment records. They could already approve these and see the resulting invoices, so no new kind of data is exposed to them, and residents, vendors and advertisers are unaffected.
- Any later route that needs "either permission" uses the same mechanism instead of a new permission.
