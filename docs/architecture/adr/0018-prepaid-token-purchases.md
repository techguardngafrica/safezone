# ADR-0018: Prepaid electricity token purchases (Safezone collects)

- **Status:** Proposed
- **Date:** 2026-11-20
- **Deciders:** Sunday Etom Eni
- **Affects:** utilities, payments, integrations (payments, bills), worker, resident-mobile, super-admin (later), AGENTS.md §2.8 wording

## Context

utilities.md §2 and §5 want residents to buy prepaid electricity tokens in the app. ADR-0014 §16 left open who receives the money. On 20 Nov 2026 the product owner decided: **Safezone receives the money** for token purchases through its own payment provider account (Paystack, Flutterwave or Stripe were named).

This is a new money flow. Every payment so far settles to the estate's subaccount and is allocated to invoices (ADR-0013); Safezone never holds it. AGENTS.md §2.8 ("Safezone never holds estate money") still holds, because token money is not estate money: the resident buys a product from Safezone, and Safezone buys the token from a bills aggregator. But Safezone now holds resident money between payment and vending, and owes a token or a refund for every paid purchase.

Constraints: payment success only after server-side verification (§6.3); webhooks signed and idempotent; a token is shown only after successful vending, never before payment verification (utilities.md rule 1); a paid purchase must end vended or fully refunded, never pending (rule 2, alert after 15 minutes); tokens are secrets (rule 4); no provider SDKs in domain code (§5.7).

## Options considered

**Who collects**

| Option                                                            | Pros                                             | Cons                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A. Safezone collects on its own account, pays aggregator (chosen) | One checkout, Safezone controls refunds and fees | Safezone holds resident money briefly; needs an aggregator wallet float and reconciliation; regulatory check |
| B. Aggregator's hosted checkout (money never touches Safezone)    | No money held                                    | Another checkout and refund process; fewer aggregators offer it                                              |

**Payment provider**

| Option              | Notes                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Paystack (existing) | Already integrated (ADR-0013). A charge without `subaccount` settles to Safezone's own account.                                                |
| Flutterwave         | Same adapter class; not built yet.                                                                                                             |
| Stripe              | Not recommended: Stripe does not support NGN card acquiring for Nigerian residents in the way Paystack does. Revisit only for non-NGN markets. |

## Decision (proposed)

1. **Collection.** Token purchases use the existing `PaymentGateway` with a new **platform charge**: `initialize` without a subaccount, so the money settles to Safezone's own account. The purpose is `utility_purchase`; the route kind is `platform_purchase`, so webhook processing never touches estate ledgers or invoices.
2. **Data.** `tenant.utility_purchases` (utilities module, RLS): `id`, `estate_id`, `meter_id`, `user_id`, `amount` (kobo, token value), `fee` (kobo), `total`, `payment_reference`, `provider_ref`, `token_wrapped` (KeyVault, like pass PINs), `units_kwh`, `status` (`created`, `paid`, `vending`, `vended`, `failed`, `refund_pending`, `refunded`), `attempts`, `vended_at`, `refunded_at`, `failure_reason`. Append-only history in `utility_purchase_events`.
3. **Flow.** `POST …/utility-purchases {meterId, amountKobo}` (household member with the meter's unit; Idempotency-Key) checks the meter is prepaid and validated, the amount is within limits (₦1,000 to ₦200,000 to start, configurable), adds the fee (configurable, ₦0 to start), and returns the checkout URL. Only verification (webhook or `…/verify`) marks it `paid`, then the `utilities` queue vends through the bills aggregator adapter (`BillsProvider.vend`, idempotent on the purchase id). The token is wrapped at rest and shown only to the buyer and their household members, and sent by SMS.
4. **Failure.** Vend failures retry 3 times over 10 minutes; then the purchase moves to `refund_pending` and the worker refunds the full total through the provider (`PaymentGateway.refund`). Anything paid and not vended or refunded after 15 minutes raises a platform alert. Refund failures stay `refund_pending` and alert until resolved by support.
5. **Aggregator.** No aggregator is chosen. Until one is configured, `UnconfiguredBillsProvider.vend` refuses, and the purchase endpoint answers 503 `TOKENS_UNAVAILABLE` outside local development, so no one can pay for a token that cannot be vended. The fake vends deterministic tokens locally and in tests.
6. **Reconciliation.** A daily job compares paid purchases, vends and refunds with the provider's settlement report and the aggregator's statement; mismatches go to the Super Admin transactions queue (Phase 2 super-admin work).
7. **AGENTS.md §2.8** gets a clarifying sentence: Safezone never holds _estate_ money; it may sell its own services (such as prepaid tokens) on its own account.

## Open points needing the product owner

- Which bills aggregator, and who funds its wallet (float size, top-up process).
- The service fee, if any, and whether it is shown as a separate line.
- Legal and regulatory sign-off for Safezone (Techguard) reselling tokens and holding resident money until vending, including refund timelines.
- Whether Flutterwave is needed at launch or Paystack alone.

## Consequences

- Payments gains a second route kind; the estate payment path is unchanged and keeps its tests.
- New tables and a migration in utilities; a new queue job; a KeyVault use for tokens; resident screens for buying, history and the token.
- Super Admin needs a view of stuck and refunded purchases before launch.
- Until the open points are settled, the feature can be built and tested end to end with the fakes, but stays off in staging and production.
