# Module: Marketplace and Vendor Management

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 4 · Owner: Backend · Apps: resident-mobile (marketplace + Vendor mode), public-web (Vendor Portal), management-web, super-admin

## 1. Responsibility

Marketplace connects residents with **verified service providers**: vendor registration and verification, service categories and listings, pricing and availability, service areas, estate-level vendor approval, bookings and orders, payments with commission split, vendor settlements, reviews and ratings, disputes, suspensions and performance reports.

**There is no dedicated vendor app.** Vendors manage their business on the web (Vendor Portal in public-web) and/or through Vendor mode in the Resident App.

Residents can also sell: **estate classifieds** for neighbour-to-neighbour items and services, and an **individual vendor** tier for anyone selling across estates or taking bookings ([ADR-0023](../adr/0023-phase-4-marketplace-and-safezone-pay.md)).

## 2. Capabilities

1. Vendor application (business details, owner identity, documents, categories, service areas).
2. Verification by Techguard (documents, NIN/CAC where applicable, phone call); approval, rejection, suspension.
3. Vendor organisation with roles: Vendor Owner, Administrator, Employee, Service Personnel.
4. Payout account via provider subaccount (bank details held by provider).
5. Service categories (platform taxonomy) and listings: title, description, photos, price type (fixed, from, quote), price, duration, availability.
6. Service areas: states/LGAs or specific estates.
7. Estate approval: each estate approves which vendors appear to its residents (or blocks).
8. Resident discovery: browse, search, filter by category, rating, price; vendor profile and reviews.
9. Bookings (services at a time) and orders (goods, e.g. gas refill, water).
10. Quotes for quote-based services.
11. Payment through [payments](payments.md) with split: vendor share to vendor subaccount, Safezone commission.
12. Order lifecycle with status updates and chat between resident and vendor.
13. Contractor/vendor visitor pass created for in-estate jobs.
14. Reviews and ratings after completion (one per order).
15. Disputes: open, evidence, resolution (refund/partial refund/no action).
16. Vendor performance reports (completion rate, response time, rating, disputes).

### 2.1 Estate classifieds (ADR-0023)

1. Any active resident with `marketplace.sell` posts an item or service (title, description, optional price in kobo or "negotiable", condition for items, up to 6 photos). Listings expire after 30 days unless renewed.
2. Visible only to members of the same estate. Statuses: `active`, `sold`, `withdrawn`, `hidden` (by staff with `marketplace.moderate`, with a reason), `expired`.
3. Buyers contact the seller through in-app enquiry messages on the listing; phone numbers are never shown.
4. No commission. Paying a seller uses the Safezone Pay transfer route (no stored balance).
5. A resident may have at most 20 active classifieds.

### 2.2 Vendor tiers

`vendors.type` is `individual` or `company`; `verification_tier` is `individual` (phone and NIN check) or `business` (adds CAC number and documents). Both reach the same marketplace once approved by Techguard.

### 2.3 Where the data lives and who reads it

- Platform schema (`marketplace` database context): `vendors`, `vendor_members`, `vendor_documents`, `vendor_service_areas`, `service_categories`, `listings`, `commission_rules`.
- Tenant schema (RLS on `estate_id`): `estate_vendor_approvals`, `marketplace_orders`, `marketplace_order_events` (append-only), `marketplace_order_messages`, `marketplace_reviews`, `marketplace_disputes`, `classified_listings`, `classified_messages`.
- A vendor reads its own orders through the `marketplace` context with `app.vendor_id` set; the RLS policy on order tables admits exactly that vendor's rows.
- Vendor routes (`/v1/vendors/:vendorId/...`) declare vendor permissions (`vendor.profile.manage`, `vendor.team.manage`, `vendor.listing.manage`, `vendor.order.manage`, `vendor.order.work`, `vendor.payout.read`), checked against the caller's active vendor membership; non-members get 404.

## 3. Order states

`requested → quoted (optional) → accepted → scheduled → in_progress → completed → reviewed`; also `declined`, `cancelled_by_resident`, `cancelled_by_vendor`, `disputed`, `refunded`.

Payment timing: at acceptance (fixed price) or after quote acceptance; held until completion where the provider supports delayed settlement, otherwise paid at acceptance with refund on cancellation.

Implementation (ADR-0023): `accepted` means the price is agreed and payment is due; `schedule` and `start` require a verified payment (`paid_at`). The charge is a split: the vendor's provider subaccount receives the vendor share and Safezone's commission is the provider transaction charge. Every transition is appended to `marketplace_order_events`.

## 4. Data model

| Table                     | Key columns                                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendors`                 | `id`, `name`, `type` (individual, company), `cac_number`, `owner_user_id`, `status` (applied, under_review, approved, suspended, rejected), `verified_at`, `rating_avg`, `rating_count` (platform-level)                                                    |
| `vendor_members`          | `vendor_id`, `user_id`, `role`                                                                                                                                                                                                                              |
| `vendor_documents`        | `vendor_id`, `file_id`, `doc_type`, `expires_on`                                                                                                                                                                                                            |
| `vendor_service_areas`    | `vendor_id`, `state`, `lga`, `estate_id`                                                                                                                                                                                                                    |
| `service_categories`      | `id`, `parent_id`, `name`, `commission_pct` (default)                                                                                                                                                                                                       |
| `listings`                | `id`, `vendor_id`, `category_id`, `title`, `description`, `photos`, `price_type`, `price`, `duration_minutes`, `availability` (jsonb), `status`                                                                                                             |
| `estate_vendor_approvals` | `estate_id`, `vendor_id`, `status` (approved, blocked), `decided_by`, `decided_at`                                                                                                                                                                          |
| `orders`                  | `id`, `estate_id`, `vendor_id`, `listing_id`, `resident_user_id`, `space_id`, `scheduled_at`, `details`, `quote_amount`, `amount`, `commission_amount`, `vendor_amount`, `payment_intent_id`, `visitor_pass_id`, `status`, `assigned_member_id`, timestamps |
| `order_messages`          | `order_id`, `author_id`, `body`, `attachments`                                                                                                                                                                                                              |
| `reviews`                 | `id`, `order_id`, `vendor_id`, `rating` (1–5), `comment`, `vendor_response`, `status` (visible, hidden_by_moderation)                                                                                                                                       |
| `order_disputes`          | `id`, `order_id`, `reason`, `evidence`, `status`, `resolution`, `refund_amount`, `handled_by`                                                                                                                                                               |
| `commission_rules`        | `scope` (category, vendor), `scope_id`, `pct`, `valid_from`                                                                                                                                                                                                 |

## 5. Business rules

1. Only approved vendors with an active payout account can receive orders.
2. A vendor appears to residents of an estate only if the estate has approved them (or the estate setting allows all verified vendors serving its area).
3. Commission is computed server-side at payment time from `commission_rules` (vendor rule > category rule > default).
4. Reviews only from residents with a completed order; one review per order; vendors can respond once.
5. Vendors never see resident phone numbers unless the resident shares them in the order; chat is in-app.
6. Disputes freeze vendor payout for that order where the provider supports it.
7. Vendor documents with expiry trigger reminders; expired mandatory documents suspend listings.
8. Suspended vendors' open orders are flagged to residents with cancellation/refund options.

## 6. API

| Method         | Path                                                                                                     | Purpose          |
| -------------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| GET            | `/v1/marketplace/categories` (public)                                                                    | Categories       |
| POST           | `/v1/vendor-applications` (signed in; the applicant becomes Vendor Owner)                                | Apply            |
| GET            | `/v1/me/vendors`                                                                                         | My vendors       |
| PUT            | `/v1/vendors/:vendorId/payout-account`                                                                   | Payout account   |
| GET/PATCH      | `/v1/vendors/:vendorId`                                                                                  | Vendor profile   |
| GET/POST/PATCH | `/v1/vendors/:vendorId/listings[/:id]`                                                                   | Listings         |
| GET/POST       | `/v1/vendors/:vendorId/members`                                                                          | Team             |
| GET            | `/v1/vendors/:vendorId/orders?status=`                                                                   | Vendor orders    |
| POST           | `/v1/vendors/:vendorId/orders/:id/accept` · `/decline` · `/quote` · `/schedule` · `/start` · `/complete` | Transitions      |
| GET            | `/v1/vendors/:vendorId/payouts`                                                                          | Earnings         |
| GET            | `/v1/estates/:estateId/marketplace/listings?category=&q=`                                                | Resident browse  |
| POST           | `/v1/estates/:estateId/marketplace/orders`                                                               | Place order      |
| POST           | `/v1/estates/:estateId/marketplace/orders/:id/accept-quote` · `/cancel` · `/review` · `/dispute`         | Resident actions |
| GET/PUT        | `/v1/estates/:estateId/vendor-approvals`                                                                 | Estate approval  |
| POST           | `/v1/platform/vendors/:id/approve` · `/reject` · `/suspend`                                              | Platform         |
| GET/PUT        | `/v1/platform/commission-rules`                                                                          | Commission       |
| GET/PATCH      | `/v1/platform/order-disputes[/:id]`                                                                      | Disputes         |

## 7. Events

`marketplace.vendor.approved`, `marketplace.vendor.suspended`, `marketplace.order.placed`, `marketplace.order.accepted`, `marketplace.order.completed`, `marketplace.order.cancelled`, `marketplace.review.posted`, `marketplace.dispute.opened`, `marketplace.dispute.resolved`.

## 8. Acceptance criteria

- A resident in Estate A cannot see a vendor that Estate A has blocked.
- Commission and vendor share are split by the provider at payment, matching the rule in force.
- A vendor can run their full order flow from either the Vendor Portal or Vendor mode in the Resident App.

## 9. Implementation notes (Phase 4, ADR-0023)

- Resident order actions also include `POST …/marketplace/orders/:id/pay`, `/verify-payment` and `GET/POST …/orders/:id/messages`; vendors have `/assign`, `/messages`, `/review-response`, `GET /reviews` and `GET /payouts` (earnings).
- Platform routes as built: `GET /v1/platform/vendors`, `POST /v1/platform/vendors/:id/approve|reject|suspend|reinstate`, `GET/POST /v1/platform/commission-rules` (append-only), `GET /v1/platform/order-disputes[/:id]`, `POST /v1/platform/order-disputes/:id/resolve`.
- Classifieds: `GET/POST /v1/estates/:estateId/classifieds`, `GET/PATCH …/:id`, `POST …/:id/hide|restore` (moderators), `GET/POST …/:id/messages`.
- Estate settings: `marketplace.allow_all_verified_vendors` (default off) and `marketplace.classifieds_enabled` (default on). Feature key `marketplace` is on the free core plan.
- Estate management oversight: `GET /v1/estates/:estateId/marketplace/overview` (aggregate order counts and per-vendor order/dispute volume, no financials) and `GET /v1/estates/:estateId/marketplace/disputes` (estate-scoped disputes, no financials or resident PII), both gated by `marketplace.moderate`.
- Commission is 0% until Techguard sets a rule; rules are append-only and the rule in force at checkout is fixed on the order.
- Not built yet: contractor visitor pass for in-estate jobs (capability 13), document expiry reminders (rule 7), and notifying residents with open orders when a vendor is suspended (rule 8; they can already cancel).
