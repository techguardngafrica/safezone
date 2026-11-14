# Module: Payments

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 2 · Owner: Backend · Apps: resident-mobile, management-web, management-mobile, super-admin, public-web (vendor/advertiser payments in Phase 4)

## 1. Responsibility

Payments moves money through licensed providers and records it: payment initiation, provider checkout, dedicated virtual accounts for transfers, webhook processing, server-side verification, split settlement to estate (and later vendor) subaccounts, reconciliation, refunds, disputes and transaction history. **Safezone never holds estate funds**: settlement goes directly from the provider to the estate's account.

## 2. Providers

Paystack and Flutterwave behind a `PaymentGateway` adapter: initialise transaction, verify, split/subaccount, dedicated virtual accounts, refunds, settlement reports, webhooks.

## 3. Capabilities

1. Estate payout setup: create provider subaccount for the estate's bank account (bank details captured by provider; Safezone stores only references and last 4 digits).
2. Online payments (card, bank, USSD, transfer via provider checkout) for invoices, facility bookings, utilities, marketplace orders, ad invoices.
3. **Dedicated virtual accounts** per unit or per payer, so bank transfers match automatically.
4. Payment intents with idempotency.
5. Webhook handling with signature verification and server-side re-verification.
6. Split settlement: estate share to estate subaccount; Safezone fee (where applicable later, e.g. marketplace commission) by split.
7. Manual payments (cash/cheque/bank deposit) recorded by accountant with evidence and approval.
8. Allocation to invoices (via [billing](billing.md)).
9. Automatic reconciliation of provider transactions and settlements; unmatched queue.
10. Refunds (full/partial) with approval.
11. Disputes/chargebacks tracking.
12. Transaction history and receipts.
13. Provider failover for initiation.

## 4. Data model

| Table                  | Key columns                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payout_accounts`      | `id`, `owner_type` (estate, vendor), `owner_id`, `provider`, `subaccount_code`, `bank_name`, `account_last4`, `status`, `verified_at`                                                                                                                                                     |
| `virtual_accounts`     | `id`, `estate_id`, `space_id`, `payer_user_id`, `provider`, `account_number`, `bank_name`, `status`                                                                                                                                                                                       |
| `payment_intents`      | `id`, `estate_id`, `purpose` (invoice, booking, utility, order, ad_invoice), `purpose_ids`, `payer_user_id`, `amount`, `currency`, `provider`, `provider_reference`, `split` (jsonb), `status` (created, pending, succeeded, failed, cancelled, expired), `idempotency_key`, `expires_at` |
| `transactions`         | `id`, `estate_id`, `intent_id`, `provider`, `provider_txn_id` (unique), `channel` (card, bank, transfer, ussd, virtual_account, manual), `amount`, `fees`, `status`, `paid_at`, `raw` (encrypted jsonb)                                                                                   |
| `manual_payments`      | `id`, `estate_id`, `payer_user_id`, `space_id`, `amount`, `method`, `evidence_file_id`, `recorded_by`, `approved_by`, `status`                                                                                                                                                            |
| `webhook_events`       | `id`, `provider`, `event_id` (unique), `signature_valid`, `payload` (encrypted), `processed_at`, `result`                                                                                                                                                                                 |
| `settlements`          | `id`, `estate_id`, `provider`, `settlement_ref`, `amount`, `settled_at`, `transaction_ids`                                                                                                                                                                                                |
| `refunds`              | `id`, `estate_id`, `transaction_id`, `amount`, `reason`, `requested_by`, `approved_by`, `provider_ref`, `status`                                                                                                                                                                          |
| `disputes`             | `id`, `estate_id`, `transaction_id`, `provider_ref`, `reason`, `status`, `due_by`                                                                                                                                                                                                         |
| `reconciliation_items` | `id`, `estate_id`, `source` (provider, bank, manual), `ref`, `amount`, `matched_transaction_id`, `status` (matched, unmatched, ignored), `resolved_by`                                                                                                                                    |

## 5. Flows

### 5.1 Card/bank checkout

1. App calls `POST /payment-intents` (purpose, ids, amount computed server-side).
2. API initialises with provider (with split to estate subaccount), returns checkout URL/access code.
3. App opens provider checkout (in-app browser / SDK).
4. Provider sends webhook → API verifies signature → calls provider verify endpoint → marks transaction succeeded → allocates via billing → receipt + notification.
5. App polls/receives realtime update; shows success only after server verification.

### 5.2 Virtual account transfer

1. Resident transfers to their virtual account number from any bank app.
2. Provider webhook (transfer received) → verify → match to payer/unit → allocate to oldest open invoices (or hold as credit).

### 5.3 Reconciliation (daily)

1. Pull provider transactions and settlements.
2. Match by provider txn id; then amount + reference; flag unmatched.
3. Accountant resolves unmatched items in the management web app.

## 6. Business rules

1. Payment success is **only** set after server-side verification (never from client callback).
2. Webhooks are idempotent by provider event id.
3. Amount is computed server-side from invoice balances; client-sent amounts are ignored except for allowed partial payments (bounded).
4. Intents expire after 30 minutes.
5. Refunds require a second approver above threshold and cannot exceed the captured amount minus prior refunds.
6. Manual payments need evidence and approval before posting.
7. No card data touches Safezone servers (provider-hosted checkout); PCI scope minimal.
8. Raw provider payloads stored encrypted; retained per financial retention rules.
9. An estate without an active payout account cannot accept online payments (manual only).
10. Legal sign-off required on the settlement arrangement before go-live.

## 7. API

| Method | Path                                                                       | Purpose                     |
| ------ | -------------------------------------------------------------------------- | --------------------------- |
| POST   | `/v1/estates/:estateId/payout-account`                                     | Start subaccount setup      |
| POST   | `/v1/estates/:estateId/payment-intents`                                    | Create intent               |
| GET    | `/v1/estates/:estateId/payment-intents/:id`                                | Status                      |
| GET    | `/v1/me/virtual-accounts?estateId=`                                        | Resident's transfer account |
| POST   | `/v1/estates/:estateId/manual-payments` · `/:id/approve`                   | Manual payments             |
| GET    | `/v1/estates/:estateId/transactions?filters`                               | Transactions                |
| POST   | `/v1/estates/:estateId/transactions/:id/refunds` · `/refunds/:rid/approve` | Refunds                     |
| GET    | `/v1/estates/:estateId/reconciliation?status=unmatched`                    | Unmatched queue             |
| POST   | `/v1/estates/:estateId/reconciliation/:id/match`                           | Manual match                |
| POST   | `/v1/webhooks/paystack` · `/flutterwave`                                   | Webhooks                    |
| GET    | `/v1/platform/transactions`                                                | Platform view               |

## 8. Events

`payments.intent.created`, `payments.transaction.succeeded`, `payments.transaction.failed`, `payments.transfer.received`, `payments.refund.completed`, `payments.dispute.opened`, `payments.settlement.recorded`, `payments.reconciliation.unmatched`.

## 9. Jobs

`payments.webhook.process`, `payments.intents.expire`, `payments.reconcile.daily`, `payments.settlements.fetch`, `payments.disputes.sync`.

## 10. Acceptance criteria

- A forged webhook (bad signature) changes nothing and is logged.
- A transfer to a virtual account is matched and allocated within 2 minutes of the provider webhook.
- 99% of pilot payments reconcile automatically.
- The resident sees "Payment successful" only after server verification.

## 10. Phase 2 implementation notes

Built in `src/modules/payments` and `src/integrations/payments` ([ADR-0013](../adr/0013-payments-flow.md)):

- `PaymentGateway` with Paystack (fetch) and an in-memory fake; `PAYMENTS_PROVIDER=fake|paystack`.
- Payout account setup (subaccount; last 4 digits only), payment intents with `Idempotency-Key` and server-computed amounts, signed and de-duplicated webhooks processed on the `payments` queue, `…/payment-intents/:id/verify`, dedicated virtual accounts per payer and unit, office (manual) payments with a second approver, refunds from unallocated credit with a second approver and ledger reversal if the provider fails.
- **Not yet built:** Flutterwave adapter and failover, daily reconciliation and settlement import, disputes, intent expiry job, receipts.
