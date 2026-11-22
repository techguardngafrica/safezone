# ADR-0023: Phase 4 marketplace, resident listings and Safezone Pay

- **Status:** Accepted (22 Nov 2026; open points below still block launch of the money flows)
- **Date:** 2026-11-22
- **Deciders:** Sunday Etom Eni
- **Affects:** marketplace (new), payments, utilities, authz, permissions, schemas, public-web, resident-mobile, management-web, super-admin

## Context

Phase 4 brings the marketplace (marketplace.md), managed advertising (advertising.md), the Vendor Portal and advertiser pages on public-web, and Marketplace, Vendor mode and Advertiser mode in the Resident App. On 22 Nov 2026 the product owner added two requirements:

1. A **pay system** ("wallet") from which a resident can pay vendors and advertisers, send money to other residents, pay community dues and charges, and buy utilities (electricity, gas, water, data, airtime, TV, streaming, internet).
2. **Residents and users can list services and items for sale**, not only verified vendors.

Constraints: Safezone never holds estate money (AGENTS.md §2.8, ADR-0013); a stored-value balance held by Safezone is e-money and needs a CBN licence; payment success only after server-side verification; every provider behind an adapter (§5.7); money in integer kobo.

## Options considered

**Pay system**

| Option                                                      | Pros                                                    | Cons                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| A. Licensed partner wallet (balance held by a bank/PSB/MMO) | Real balance, top-ups, instant P2P                      | Partner contract and KYC tiers; larger integration               |
| B. Pay from saved methods, no stored balance (chosen)       | Works on Paystack today; no new licence; nothing pooled | No balance to top up; each payment is a card or bank charge      |
| C. Safezone-held balance                                    | Simplest ledger                                         | Breaks §2.8 in spirit and needs an e-money licence before launch |

**Resident listings**

| Option                      | Pros                                  | Cons                                     |
| --------------------------- | ------------------------------------- | ---------------------------------------- |
| Estate classifieds only     | Light, neighbour to neighbour         | No path to sell across estates           |
| Individual vendor tier only | One marketplace, one rule set         | Verification friction for a one-off sale |
| Both (chosen)               | Classifieds now, upgrade when serious | Two listing kinds to moderate            |

## Decision

1. **Safezone Pay has no stored balance.** "Wallet" in the apps means saved payment methods plus one-tap pay and a unified history. Saved cards are Paystack reusable authorizations: Safezone keeps the `authorization_code` wrapped by KeyVault and only brand, last four digits, expiry and bank for display. Card numbers never reach Safezone. Every payment is a fresh, server-verified provider charge.
2. **Where money settles (never pooled with Safezone):**
   - **Marketplace order** → split charge: the vendor's provider subaccount receives the vendor share; Safezone's commission is the provider `transaction_charge` (route kind `marketplace_order`).
   - **Send money to a resident** → the recipient must have a payout account; the charge settles fully to the recipient's subaccount (route kind `transfer`). Recipients are resolved by estate membership only (same estate in v1), never by searching phone numbers.
   - **Community dues and charges** → the existing estate payment intents (ADR-0013), paid with a saved method; settlement to the estate subaccount is unchanged.
   - **Advertising** → advertising invoices settle to Safezone's own account (all ad revenue is Safezone's, §2.4).
   - **Utilities** → platform charges on Safezone's account (ADR-0018), extended from electricity to the categories below.
3. **Bills aggregator.** `BillsProvider` gains categories (`electricity`, `airtime`, `data`, `tv`, `internet`, `gas`, `water`, `streaming`). **VTpass** is the real adapter for **airtime and data**; every other category uses the fake locally and refuses (`UTILITY_UNAVAILABLE`, 503) elsewhere until an aggregator is chosen.
4. **Resident listings, both kinds.**
   - **Estate classifieds** (`tenant.classified_listings`): any active resident posts an item or service visible only inside their estate; estate staff with `marketplace.moderate` can hide it; buyers contact the seller in-app; no commission. Optional "pay seller" uses the transfer route above.
   - **Individual vendors**: `vendors.type = individual` with a lighter verification tier (`verification_tier`: `individual` needs phone + NIN check, `business` adds CAC and documents). Anyone selling across estates or taking bookings becomes a vendor.
5. **Vendors are platform-level, orders are tenant-level.** `vendors`, `vendor_members`, `vendor_documents`, `vendor_service_areas`, `service_categories`, `listings` and `commission_rules` live in the `platform` schema behind a new `marketplace` database context. `estate_vendor_approvals`, `orders`, `order_events`, `order_messages`, `reviews` and `order_disputes` are tenant tables with RLS on `estate_id`; vendors read their own orders through the `marketplace` context filtered by `vendor_id`.
6. **Vendor access.** Vendor routes (`/v1/vendors/:vendorId/...`) declare `@Can('vendor.<resource>.<action>')`; the authorization guard evaluates them against the caller's active `vendor_members` role in that vendor (404 for non-members, like estates). Vendor permissions are added to `packages/permissions` and to the four vendor roles.
7. **Delivery order:** marketplace (backend, Vendor Portal, resident Marketplace and Vendor mode), then advertising (backend, advertiser pages, Advertiser mode, sponsored content), then Safezone Pay (saved methods, transfers, utilities categories with VTpass). Each part is its own commit with tests.

## Open points needing the product owner

- Paystack's terms for subaccounts owned by individuals (resident payout accounts for transfers and classifieds); legal review of P2P transfers through split charges.
- VTpass account, API keys, and who funds its wallet float.
- Default marketplace commission per category (seeded at 0% until set).
- Whether transfers between residents of different estates are allowed later.

## Consequences

- No e-money licence is needed and Safezone never pools resident or estate money; the trade-off is no top-up balance.
- `PaymentGateway.initialize` gains an optional `transactionChargeKobo`, plus `chargeAuthorization` for saved methods; the fake implements both.
- New `marketplace` module and migration; new DB context; guard change for vendor routes; isolation suite cases for orders, approvals and classifieds.
- marketplace.md, payments.md and utilities.md are updated with these rules.
