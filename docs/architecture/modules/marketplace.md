# Module: Marketplace and Vendor Management

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 4 · Owner: Backend · Apps: resident-mobile (marketplace + Vendor mode), public-web (Vendor Portal), management-web, super-admin

## 1. Responsibility

Marketplace connects residents with **verified service providers**: vendor registration and verification, service categories and listings, pricing and availability, service areas, estate-level vendor approval, bookings and orders, payments with commission split, vendor settlements, reviews and ratings, disputes, suspensions and performance reports.

**There is no dedicated vendor app.** Vendors manage their business on the web (Vendor Portal in public-web) and/or through Vendor mode in the Resident App.

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

## 3. Order states

`requested → quoted (optional) → accepted → scheduled → in_progress → completed → reviewed`; also `declined`, `cancelled_by_resident`, `cancelled_by_vendor`, `disputed`, `refunded`.

Payment timing: at acceptance (fixed price) or after quote acceptance; held until completion where the provider supports delayed settlement, otherwise paid at acceptance with refund on cancellation.

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
| POST           | `/v1/public/vendor-applications`                                                                         | Apply            |
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
