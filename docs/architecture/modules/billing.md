# Module: Billing (estate charges and receivables)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 2 (billing, receivables, ledger), 5 (full accounting) · Owner: Backend · Apps: management-web, management-mobile, resident-mobile

## 1. Responsibility

Billing lets an **estate bill its residents and owners**: charge definitions, billing runs, invoices, partial payments, penalties, discounts, waivers, credit notes, statements, receipts, reminders and the double-entry ledger behind them. Money movement is in [payments](payments.md). Phase 5 extends the ledger into full accounting (chart of accounts, general ledger, payables, budgets, periods, statements).

> This module is about estates billing residents. Safezone does not bill estates at launch (free core plan).

## 2. Capabilities

### Phase 2

1. Charge types: estate dues, service charge, maintenance charge, security levy, development levy, utility charges, special assessments, custom.
2. Charge rules: amount (fixed, per unit type, per bedroom, per sqm), frequency (one-off, monthly, quarterly, annual), applicable spaces/unit types, payer (occupant or owner), start/end dates, proration on move-in/move-out.
3. Billing runs: preview → approve (two-level if configured) → issue.
4. Individual invoices and bulk invoices.
5. Partial payments and allocation (oldest first by default).
6. Late payment penalties (fixed or %, after grace period, capped).
7. Discounts (early payment, configured) and waivers (with approval and reason).
8. Credit notes and invoice adjustments (never edit an issued invoice).
9. Statements per unit/payer; receipts per payment (PDF).
10. Reminders schedule (before due, on due, after due).
11. Opening balances import.
12. Arrears ageing and collection reports.
13. Financial approval workflows (creator → approver; thresholds).

### Phase 5

14. Chart of accounts, journals, general ledger, expenses, accounts payable, bank reconciliation, budgets, financial periods and closing, cash flow, income statement, balance sheet; exports to accounting software.

## 3. Ledger design

- Double-entry, append-only `ledger_entries`; every financial event posts balanced lines.
- Accounts per estate: `receivable:<payer>:<unit>`, `income:<charge_type>`, `cash:<provider|bank>`, `penalty_income`, `discounts`, `waivers`, `credits`.
- Examples:
  - Invoice issued: Dr Receivable / Cr Income.
  - Payment received: Dr Cash / Cr Receivable.
  - Waiver: Dr Waivers expense / Cr Receivable.
  - Refund: Dr Receivable (or Credits) / Cr Cash.
- Balances = sum of entries; materialised balances updated in the same transaction for speed, verified nightly.
- Amounts in integer kobo.

## 4. Data model

| Table                | Key columns                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `charges`            | `id`, `estate_id`, `type`, `name`, `amount_rule` (jsonb), `frequency`, `payer` (occupant, owner), `applies_to` (jsonb space ids/unit types), `starts_on`, `ends_on`, `penalty_rule`, `discount_rule`, `status`                                                                      |
| `billing_runs`       | `id`, `estate_id`, `period`, `charge_ids`, `status` (draft, previewed, awaiting_approval, approved, issuing, issued, cancelled), `created_by`, `approved_by`, `totals`                                                                                                              |
| `invoices`           | `id`, `estate_id`, `number` (per-estate sequence), `space_id`, `payer_user_id`, `payer_type`, `billing_run_id`, `issue_date`, `due_date`, `subtotal`, `discount`, `penalty`, `total`, `amount_paid`, `balance`, `status` (issued, partially_paid, paid, overdue, waived, cancelled) |
| `invoice_lines`      | `invoice_id`, `charge_id`, `description`, `quantity`, `unit_amount`, `amount`                                                                                                                                                                                                       |
| `credit_notes`       | `id`, `estate_id`, `invoice_id`, `amount`, `reason`, `approved_by`                                                                                                                                                                                                                  |
| `waivers`            | `id`, `estate_id`, `invoice_id`, `amount`, `reason`, `requested_by`, `approved_by`, `status`                                                                                                                                                                                        |
| `allocations`        | `payment_id`, `invoice_id`, `amount`                                                                                                                                                                                                                                                |
| `ledger_accounts`    | `id`, `estate_id`, `code`, `name`, `type` (asset, liability, income, expense, equity)                                                                                                                                                                                               |
| `ledger_entries`     | `id`, `estate_id`, `journal_id`, `account_id`, `debit`, `credit`, `occurred_at`, `source_type`, `source_id`                                                                                                                                                                         |
| `journals`           | `id`, `estate_id`, `type`, `description`, `posted_at`, `posted_by`, `reverses_journal_id`                                                                                                                                                                                           |
| `reminder_schedules` | `estate_id`, `offsets_days` (e.g. −7, 0, +7, +30), `channels`                                                                                                                                                                                                                       |

## 5. Business rules

1. Issued invoices are immutable; changes happen by credit note, waiver or new invoice.
2. Every journal balances (sum debits = sum credits) — enforced by a DB constraint/trigger.
3. Billing run approval required if total > estate threshold or if two-level approval is on.
4. The approver cannot be the creator.
5. Penalties apply only after the grace period and only to principal (no penalty on penalty) unless the estate configures otherwise.
6. Waivers above threshold need a second approver.
7. Payer resolution at issue time: occupant charges → active occupancy household head; owner charges → active owners by share (split invoice) or primary owner (configurable).
8. Vacant units: occupant charges go to the owner if `bill_owner_when_vacant` is on.
9. Proration by days for move-in/move-out mid-period.
10. Financial records and ledger are never deleted; retained at least 6 years.

## 6. API

| Method         | Path                                                                                             | Purpose             |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------- |
| GET/POST/PATCH | `/v1/estates/:estateId/charges[/:id]`                                                            | Charges             |
| POST           | `/v1/estates/:estateId/billing-runs`                                                             | Create run          |
| POST           | `/v1/estates/:estateId/billing-runs/:id/preview` · `/submit` · `/approve` · `/issue` · `/cancel` | Run steps           |
| GET            | `/v1/estates/:estateId/invoices?status=&spaceId=&payer=`                                         | List                |
| GET            | `/v1/estates/:estateId/invoices/:id` (+ `/pdf`)                                                  | Detail / PDF        |
| POST           | `/v1/estates/:estateId/invoices`                                                                 | One-off invoice     |
| POST           | `/v1/estates/:estateId/invoices/:id/credit-notes`                                                | Credit note         |
| POST           | `/v1/estates/:estateId/invoices/:id/waivers` · `/waivers/:wid/approve`                           | Waiver              |
| GET            | `/v1/estates/:estateId/statements?spaceId=&payer=&from=&to=`                                     | Statement           |
| GET            | `/v1/me/invoices?estateId=`                                                                      | Resident view       |
| GET            | `/v1/estates/:estateId/reports/arrears`, `/collections`                                          | Reports             |
| GET            | `/v1/estates/:estateId/ledger?account=&from=&to=`                                                | Ledger (accountant) |

## 7. Events

`billing.run.approved`, `billing.invoice.issued`, `billing.invoice.overdue`, `billing.invoice.paid`, `billing.waiver.approved`, `billing.penalty.applied`, `billing.credit_note.issued`.

## 8. Jobs

- `billing.run.issue` (chunked, idempotent per invoice).
- `billing.recurring.schedule` — creates draft runs per frequency.
- `billing.overdue.mark` and `billing.penalties.apply` — daily.
- `billing.reminders.send` — daily per schedule.
- `billing.balances.verify` — nightly ledger vs materialised balances.

## 9. Acceptance criteria

- A billing run for 1,000 units previews in < 30 s and issues in < 5 min.
- A partial payment allocates to the oldest invoice and updates balances and the ledger in one transaction.
- No issued invoice can be edited via any endpoint.
- Nightly verification finds zero mismatches on pilot data.

## 10. Phase 2 implementation notes

Built in `src/modules/billing` ([ADR-0012](../adr/0012-billing-ledger-and-invoices.md)):

- Charges (`fixed`, `per_unit_type`, `per_bedroom`, `per_sqm`, `metered`), payer `occupant` or `owner` (primary owner), optional `penaltyRule` (fixed or percent with cap). Edits use `If-Match` and never touch issued invoices.
- Billing runs: create → preview (per-unit items with skip reasons) → submit → approve (not by the creator or submitter) → issue; or cancel. Proration by days for move-ins and charges starting or ending mid-period. Issue refuses if a charge changed since the preview and re-checks payers.
- Invoices with per-estate numbers (`INV-000001`), one-off invoices, credit notes (approvers), waivers (two-person above `billing.waiver_threshold_kobo`), statements and a trial balance from the ledger, `InvoicesService.allocate` for payments (chosen invoices, then oldest due first, remainder to payer credit, idempotent per source).
- Database guarantees: immutable invoice terms, money checks, append-only financial tables, balanced journals checked at commit.
- Daily job (06:00 WAT, `billing` queue): `billing.invoice.overdue` once per invoice, one late-penalty invoice per late invoice after `billing.penalty_grace_days`, reminders on `billing.reminder_offsets_days`, invoice-vs-ledger verification.
- Routes are under `/v1/estates/:estateId/…` (residents see their own and their household's invoices there; no `/v1/me/invoices`).
- Opening balances import: one-off invoices created through `InvoicesService.createOneOffIn` by the imports worker, once per `(unit, external_ref)` ([ADR-0020](../adr/0020-import-execution-support-enforcement-role-grants.md)).
- **Not yet built:** PDF invoices and receipts, arrears ageing and collection reports, early-payment discounts, co-owner invoice splitting, chunked issuing for very large runs, recurring run scheduling.
