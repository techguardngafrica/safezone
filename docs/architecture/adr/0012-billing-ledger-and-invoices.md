# ADR-0012: Billing ledger, invoices and billing runs

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** billing, payments, occupancy, property, tenancy

## Context

billing.md proposes the tables and rules for estates billing residents. Several implementation details were open: how money is stored, how "issued invoices are immutable" and "every journal balances" are enforced, where approval settings live, how residents reach their invoices given the estate guard, and how payments hand money to billing.

## Decision

1. **Money is `bigint` kobo in the database and a safe integer `number` in the API.** `toKobo()` throws rather than lose precision. Quantities (bedrooms, square metres) are `double precision`; each line is rounded once to the nearest kobo.
2. **Database-enforced integrity.**
   - `invoices_terms_immutable` trigger: only `amount_paid`, `amount_credited`, `amount_waived`, `balance` and `status` may change, and the three amounts may only grow. Invoices cannot be deleted.
   - `invoices_money_check`: `balance = total − paid − credited − waived` and nothing is negative.
   - `invoice_lines`, `credit_notes`, `allocations`, `ledger_accounts`, `journals`, `ledger_entries` are append-only (`audit.reject_mutation`).
   - Deferred constraint triggers on `journals` and `ledger_entries` check at commit that each journal has at least two lines, balances to zero and does not mix estates.
3. **Accounts are created on first use** with stable codes: `receivable:<payer>:<unit>`, `income:<charge_type>`, `income_adjustments` (contra-income for credit notes), `waivers` (expense), `cash:<channel>`, `credits:<payer>` (liability for overpayments). Receivable and credit accounts carry `party_user_id`/`space_id` for statements.
4. **No materialised ledger balances yet.** Invoices hold their own balance (the hot path); ledger balances are sums of entries. `GET …/ledger/balances` is the trial balance. The nightly `billing.balances.verify` job arrives with the jobs slice.
5. **Approval settings are estate settings** (`billing.two_level_approval` default on, `billing.approval_threshold_kobo`, `billing.waiver_threshold_kobo`) validated by `estateSettingsSchema`, not a separate table.
6. **Runs store their preview** in `billing_run_items` (one row per unit, with skip reasons `vacant`, `not_applicable`, `payer_changed`). Issue uses the approved preview, refuses to run if any charge's version changed since the preview (`BILLING_RUN_STALE`), and re-checks each unit's household at issue time. Runs are issued in one transaction, capped at 5,000 units per run; chunked issuing on the `billing` queue is a later optimisation.
7. **Approvers.** `billing.run.create` prepares, previews, submits and issues; `billing.run.approve` approves runs and waivers, and issues credit notes. The approver of a run cannot be its creator or submitter; a waiver's decider cannot be its requester. An approver's waiver at or below the waiver threshold is approved at once.
8. **Residents read invoices through estate routes** (`GET /v1/estates/:estateId/invoices`, `…/invoices/:id`, `…/statements`) rather than `/v1/me/invoices`: staff with `invoice.read` see everything, residents see invoices they pay and their households' (heads, or members with `viewBills`).
9. **Payments call `InvoicesService.allocate(tx, …)`** inside their own transaction: chosen invoices first, then oldest due first; any remainder goes to the payer's credit account. Allocation is idempotent per `(sourceType, sourceId)`.
10. **Payer is the occupant only for now.** Owner-billed charges need ownership records; `chargePayerSchema` will widen to `owner` when they land (backward compatible).
11. **Overdue is derived on read** (open invoice with `due_date` before today in WAT), so no job is needed for correctness; the job that emits `billing.invoice.overdue` and applies penalties comes with reminders.

## Consequences

- No code path, including a bug or a direct SQL session as the app role, can edit an issued invoice's terms, delete financial records or commit an unbalanced journal.
- Statements and the trial balance read straight from the ledger, so they cannot drift from it.
- Large estates (over 5,000 units) split runs by block or zone until chunked issuing exists.
