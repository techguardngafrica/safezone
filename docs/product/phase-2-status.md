# Phase 2 status: Money and Maintenance

> Started 14 Nov 2026. Scope: [implementation plan, Phase 2](implementation-plan.md). Goal: estates collect dues digitally and residents report issues in the app.

## Progress

Phase 2 **backend** is largely built; no Phase 2 screens are built yet.

| Area                                                                                                        | Backend         | Notes                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| Charges, billing runs, invoices, credit notes, waivers, statements, ledger                                  | Done            | [ADR-0012](../architecture/adr/0012-billing-ledger-and-invoices.md)                                       |
| Penalties, overdue, reminders, nightly ledger check                                                         | Done            | Daily job on the `billing` queue                                                                          |
| Financial approvals (runs, waivers, office payments, refunds)                                               | Done            | Two different people; thresholds in estate settings                                                       |
| Paystack checkout with split settlement, webhooks, verification, virtual accounts, office payments, refunds | Done            | [ADR-0013](../architecture/adr/0013-payments-flow.md); Flutterwave, reconciliation and disputes not built |
| Ownerships, transfers, owner mode, owner billing                                                            | Done            | [ADR-0014](../architecture/adr/0014-phase-2-operations-modules.md)                                        |
| Maintenance: requests, complaints, work orders, SLAs, recharge, contractor passes, planned work, reports    | Done            |                                                                                                           |
| Utilities: meters, readings, metered billing, outages                                                       | Done (partial)  | Prepaid tokens and bill payments wait for a money-flow decision                                           |
| Move-in/move-out, lease reminders and renewals                                                              | Done            |                                                                                                           |
| Estate data export                                                                                          | Done            | Uploaded files not included; offboarding purge not built                                                  |
| Plans and entitlements framework                                                                            | Done in Phase 0 | All estates on the free core plan                                                                         |
| PDF invoices and receipts, arrears reports, opening balance import                                          | Not started     |                                                                                                           |
| Apps (management web billing console, resident pay and report flows, owner mode screens)                    | Not started     |                                                                                                           |

## Decisions needed

1. **Prepaid electricity tokens and bill payments:** who receives the resident's money and which aggregator. Collecting it would put Safezone in the money flow (AGENTS.md §2.8).
2. **Co-owner billing:** invoice only the primary owner (built) or split by share.
3. **Exports:** include uploaded files? Password-protected archives?

## Verification (14 Nov 2026)

- `pnpm build`, `typecheck` and `lint` (zero warnings) pass across the repo; Prettier check passes.
- Backend: 190 unit tests and 119 integration tests in 24 files on real PostgreSQL 17 and Redis, including the cross-tenant isolation suite (covers every new route automatically) and the migration drift check.
- OpenAPI regenerated: 299 operations (141 after Phase 1).
- Not verified: the worker process booting against real infrastructure, Paystack sandbox calls, performance targets, any app or browser flow.
