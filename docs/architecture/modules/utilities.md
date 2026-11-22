# Module: Utilities

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 2 · Owner: Backend · Apps: resident-mobile, management-web, management-mobile

## 1. Responsibility

Utilities handles **electricity, water, waste, gas, internet and other utility services** in an estate: meter registration, prepaid electricity token purchases, utility bill payments, estate-run shared utility billing, consumption records, utility providers and outage announcements.

Two supply models are supported:

- **Public utility (DisCo / provider)**: residents buy tokens or pay bills through a bills aggregator.
- **Estate-run**: the estate operates sub-meters, generators or water supply and bills residents (through [billing](billing.md)) or sells tokens through its sub-meter vendor system.

## 2. Capabilities

1. Meter registration per unit (DisCo prepaid/postpaid, estate sub-meter, water meter) with validation via provider lookup.
2. Prepaid electricity token purchase via aggregator; token delivered in-app and by SMS; token history.
3. Postpaid electricity and other bill payments (water, waste, internet, cable where offered).
4. Estate-run electricity: integration adapter for sub-meter vendor systems (token vending) or consumption-based billing.
5. Shared utility billing: generator diesel levy, water supply levy, split by unit or consumption.
6. Consumption records (manual readings, imports, or from sub-meter systems).
7. Utility providers list per estate.
8. Outage and maintenance announcements (via notifications/announcements).
9. Utility payment history and reports.

## 3. Data model

| Table                    | Key columns                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utility_providers`      | `id`, `estate_id` (null = platform catalogue), `type` (electricity, water, waste, gas, internet), `name`, `integration` (aggregator, estate_vendor, manual), `config`                             |
| `meters`                 | `id`, `estate_id`, `space_id`, `provider_id`, `type`, `meter_number`, `account_name` (from lookup), `prepaid` (bool), `status`, `verified_at`                                                     |
| `utility_purchases`      | `id`, `estate_id`, `meter_id`, `user_id`, `amount`, `fee`, `payment_intent_id`, `provider_ref`, `token` (encrypted), `units_kwh`, `status` (pending, paid, vended, failed, refunded), `vended_at` |
| `meter_readings`         | `id`, `estate_id`, `meter_id`, `reading`, `read_at`, `source` (manual, import, device), `recorded_by`                                                                                             |
| `shared_utility_charges` | `id`, `estate_id`, `name`, `basis` (per_unit, consumption, bedrooms), `period`, `total_cost`, `billing_run_id`                                                                                    |
| `utility_outages`        | `id`, `estate_id`, `type`, `title`, `starts_at`, `expected_end_at`, `affected_spaces`, `status`                                                                                                   |

## 4. Flows

### 4.1 Buy prepaid electricity

1. Resident selects a saved meter (or adds one → lookup returns account name for confirmation).
2. Enters amount (min/max per provider).
3. Payment intent → checkout (or wallet balance in future).
4. On verified payment, worker calls aggregator `vend`.
5. Token stored encrypted, shown in app, sent by SMS.
6. If vend fails after payment: automatic retries (3 over 10 min), then refund workflow and support ticket.

### 4.2 Estate-run consumption billing

1. Readings recorded (manual, import or sub-meter system).
2. At period end, consumption × tariff (+ fixed charge) creates invoice lines via billing.

## 5. Business rules

1. A token is shown only after successful vending; never before payment verification.
2. Failed vend after successful payment must end in either a vended token or a full refund — never left pending (alert after 15 minutes).
3. Meter numbers are validated with the provider before first purchase.
4. Tokens are personal data-like secrets: encrypted at rest, visible to the purchaser and household members with `bills.view`.
5. Estate-run tariffs require manager approval and are announced to residents before taking effect.

## 6. API

| Method          | Path                                                | Purpose        |
| --------------- | --------------------------------------------------- | -------------- |
| GET/POST/DELETE | `/v1/estates/:estateId/meters[/:id]`                | Meters         |
| POST            | `/v1/estates/:estateId/meters/lookup`               | Validate meter |
| POST            | `/v1/estates/:estateId/utility-purchases`           | Start purchase |
| GET             | `/v1/estates/:estateId/utility-purchases?mine=true` | History        |
| GET             | `/v1/estates/:estateId/utility-purchases/:id`       | Detail + token |
| POST            | `/v1/estates/:estateId/meter-readings` (bulk)       | Readings       |
| GET/POST        | `/v1/estates/:estateId/utility-providers`           | Providers      |
| GET/POST/PATCH  | `/v1/estates/:estateId/utility-outages[/:id]`       | Outages        |
| GET             | `/v1/estates/:estateId/reports/utilities`           | Reports        |

## 7. Events

`utilities.purchase.paid`, `utilities.purchase.vended`, `utilities.purchase.failed`, `utilities.outage.announced`, `utilities.reading.recorded`.

## 8. Acceptance criteria

- A prepaid purchase delivers a token in-app and by SMS within 60 seconds of payment in normal conditions.
- A vend failure after payment is retried and, if still failing, refunded without manual chasing.
- An outage announcement reaches affected residents only.

## 9. Open questions

1. Which aggregator(s), and which DisCos are covered for pilot estates?
2. Which sub-meter vendor systems do pilot estates use?

## 10. Phase 2 implementation notes

Built in `src/modules/utilities` ([ADR-0014](../adr/0014-phase-2-operations-modules.md)):

- Provider catalogue (Nigerian DisCos and estate supply), meter lookup through `BillsProvider`, meter registration (residents for their units, management for sub-meters), bulk readings, outages to affected residents only.
- Estate-run supply is billed by `metered` charges in billing runs (consumption × rate + fixed).
- **Prepaid token purchases (20 Nov 2026, [ADR-0018](../adr/0018-prepaid-token-purchases.md)):** Safezone sells tokens on its own payment provider account. `UtilityPurchasesModule` (in `utilities/purchases`, its own Nest module because it needs payments) owns `tenant.utility_purchases` and the append-only `utility_purchase_events`. Endpoints under `/v1/estates/:estateId/utility-purchases`: `GET /limits`, `POST /` (`payment.make`, Idempotency-Key, the buyer's own household's verified prepaid DisCo meter, ₦1,000 to ₦200,000, no fee yet), `GET /`, `GET /:id` (token only for the buyer and their household, after vending), `POST /:id/verify`. Payments starts a **platform charge** (no subaccount; route kind `platform_purchase`) and, on verification, emits `payments.platform_charge.succeeded|failed` instead of touching estate ledgers. The `utilities` queue marks the purchase paid, vends through `BillsProvider.vend` (3 attempts at 1, 3 and 6 minutes), refunds the full total if vending fails or the payment was short, and sweeps every 5 minutes, alerting once on anything paid but not vended or refunded within 15 minutes. Tokens are wrapped with the KeyVault and never put in notifications or the outbox; the `utilities.token_ready` notification only says the token is in the app.
- **Still blocked for launch:** no bills aggregator is integrated (`UnconfiguredBillsProvider` refuses, so `POST` answers 503 `TOKENS_UNAVAILABLE` in staging and production); the fee, legal sign-off and Flutterwave are open (ADR-0018). Bill payment for postpaid meters, SMS delivery of the token itself, the daily provider reconciliation and the Super Admin view of stuck purchases are not built.

## 10. Airtime and data (ADR-0025)

- `tenant.topup_purchases`; `GET /v1/estates/:estateId/topups/limits|data-plans?network=`, `POST/GET …/topups`, `GET …/topups/:id`, `POST …/topups/:id/verify`.
- Airtime ₦50 to ₦50,000 (whole naira); data at the plan's price from the aggregator. No fee to start.
- After a verified payment the `utilities` queue delivers (`topups.deliver`); pending answers are requeried after 1, 3, 10 and 30 minutes (`topups.requery`); failures are refunded in full (`topups.refund`); the 5-minute sweep alerts on anything paid and unsettled for 30 minutes.
- VTpass is the real provider (airtime and data only); other bill categories are not built yet.
