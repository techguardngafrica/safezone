# ADR-0025: Safezone Pay (saved cards, transfers, airtime and data)

- **Status:** Accepted (22 Nov 2026; transfers and VTpass are off outside development until the open points are closed)
- **Date:** 2026-11-22
- **Deciders:** Sunday Etom Eni
- **Affects:** payments, utilities, marketplace, occupancy (read), integrations (payments, bills), schemas, resident-mobile

## Context

ADR-0023 decided that Safezone Pay has **no stored balance**: "wallet" means saved payment methods, one-tap pay and a unified history, and every payment is a fresh, server-verified provider charge that settles straight to whoever is owed. This ADR fixes how each part works. The product owner chose VTpass for airtime and data; other bill categories stay on the fake adapter until an aggregator is chosen.

## Decision

1. **Saved cards.** When a payer opts in (`saveCard: true` when starting a checkout), a verified successful card charge with a reusable Paystack authorization is saved to `platform.payment_methods`: the authorization code wrapped by KeyVault, plus brand, last four digits, expiry and bank for display. The card number never reaches Safezone. One row per card signature per user; removing a card is a soft delete. All charges use the per-user alias email (`<userId>@payers.safezone.ng`), so an authorization is reusable for every Safezone payment of that user.
2. **Pay with a saved card.** Estate dues (payment intents), marketplace orders, prepaid tokens and airtime/data accept `paymentMethodId`. The server charges the authorization (`PaymentGateway.chargeAuthorization`) with the same subaccount and commission rules as checkout, then verifies the reference exactly as for checkout. "Paid" is still only set after verification. A charge the provider leaves pending is resolved by the webhook or a later verify.
3. **Transfers to residents.** A resident who wants to receive money links a payout bank account (provider subaccount; Safezone keeps bank name and last four digits) in `platform.user_payout_accounts`. A sender in the same estate finds recipients by unit code; the API returns only first names of people in that unit who accept transfers. The charge settles 100% to the recipient's subaccount (route kind `transfer`, no Safezone commission). `tenant.transfers` records sender, recipient, amount, note and status (`created → paid | failed`). Limits: ₦100 to ₦500,000 per transfer. Transfers are enabled in development and test; elsewhere only when `PAY_TRANSFERS_ENABLED=true`, after the Paystack individual-subaccount and legal review (ADR-0023 open point).
4. **Airtime and data.** A new `TopUpProvider` adapter with `VtpassTopUpProvider` (live or sandbox, API key plus secret and public keys), `FakeTopUpProvider` (local and tests) and `UnconfiguredTopUpProvider` (refuses). `tenant.topup_purchases` mirrors token purchases (ADR-0018): Safezone sells on its own account (route kind `platform_purchase`), the `utilities` queue delivers after verified payment, retries, then refunds in full. VTpass rules: `request_id` starts with the Lagos date and time (`YYYYMMDDHHII`); code `000` with status `delivered` is success; `099`, `000` with `pending` or `initiated`, timeouts and unknown answers are requeried; `016` and `040` are failures to refund; `014` (duplicate request id) is resolved by requery. Data plans come from `service-variations` and are cached for 10 minutes; the price is always the plan's price, never the client's.
5. **Not built in this step:** gas, water, TV, internet and streaming purchases (they need an aggregator for each), and a separate unified history screen beyond each flow's own history.

## Open points

- Paystack terms for individual subaccounts; legal review of resident-to-resident transfers (blocks `PAY_TRANSFERS_ENABLED`).
- VTpass account, keys and wallet float; whether a service fee applies to airtime and data (0 to start).
- Card-saving consent text reviewed by counsel.

## Consequences

- `PaymentGateway` gains `chargeAuthorization`, and `VerifiedCharge` carries the authorization. The fake implements both.
- New tables: `platform.payment_methods`, `platform.user_payout_accounts`, `tenant.transfers`, `tenant.topup_purchases`. New env: `VTPASS_*`, `TOPUP_PROVIDER`, `PAY_TRANSFERS_ENABLED`.
