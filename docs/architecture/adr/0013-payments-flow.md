# ADR-0013: Payments flow, webhooks and settlement

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** payments, billing, integrations, worker

## Context

payments.md requires that Safezone never holds estate money, that payment success is set only after server-side verification, and that webhooks are signature-verified and idempotent (AGENTS.md §2.8, §6.3). Webhooks carry no estate, yet every payment table is tenant-scoped under RLS.

## Decision

1. **One `PaymentGateway` adapter** (`src/integrations/payments`) with a Paystack implementation (plain `fetch`, no SDK) and an in-memory fake for tests and local work. `PAYMENTS_PROVIDER=fake|paystack`; `fake` is refused in staging and production. Flutterwave is a second implementation of the same class when needed.
2. **Settlement:** checkout is initialised with the estate's subaccount, `bearer: subaccount` and `transaction_charge: 0`, so the full amount settles to the estate. Dedicated virtual accounts are created against the same subaccount. Safezone's own fees (later, e.g. marketplace) will use the provider's split, never a pass-through.
3. **Payout setup** resolves the account with the provider and creates the subaccount; only the bank name, account name and last 4 digits are stored.
4. **Routing table `platform.payment_routes`** (payments context only) maps a provider reference or customer code to an estate. Webhook processing looks up the route, then works inside `withTenant(estate)`.
5. **Webhooks:** `POST /v1/webhooks/payments/:provider` verifies the HMAC over the raw body (`rawBody: true` on the Nest app), stores a minimised record in `platform.payment_webhook_events` (unique on provider + event id; no card or account data), appends `payments.webhook.received` to the outbox and returns 200. The worker's `PaymentsConsumer` (on the `payments` queue) processes it.
6. **Verification is the only path to "paid":** both the webhook job and `POST …/payment-intents/:id/verify` call `processReference`, which re-verifies with the provider, inserts the transaction (unique on provider transaction id, so duplicates are no-ops), marks the intent, and calls `InvoicesService.allocate` in the same transaction. An amount different from the intent is still recorded (the money is real) and flagged `amount_differs` for reconciliation.
7. **Intents** require `Idempotency-Key`; the amount is the sum of the chosen open invoices, computed server-side. The provider receives a per-user alias email, not the resident's address.
8. **Manual (office) payments** are recorded with `payment.reconcile` and applied only after a different user with `billing.run.approve` approves them.
9. **Refunds come from the payer's unallocated credit only.** To refund money already applied to invoices, the accountant first issues a credit note (moving it to credit). Approval posts Dr payer credit / Cr cash before calling the provider; a provider `refund.failed` posts the reverse entry. Verified transactions are append-only except the refunded total, which only grows.

## Consequences

- No client can mark anything paid, and no replayed or forged webhook can create money.
- A provider outage delays confirmation but never loses a payment: webhooks are stored first and retried, and the payer can trigger verification.
- Not yet built: daily reconciliation against provider settlement reports, disputes/chargebacks, provider failover, intent expiry job, PDF receipts.
