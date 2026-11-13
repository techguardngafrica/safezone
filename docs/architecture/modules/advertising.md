# Module: Advertising and Sponsored Placements

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 4 (managed advertising), 6 (advertiser self-service, cost-per-impression) · Owner: Backend · Apps: super-admin, resident-mobile (placements + Advertiser mode), public-web (enquiries, advertiser area), management-web (estate opt-outs)

## 1. Responsibility

Advertising is a **separate commercial service run by Techguard**. It manages advertising enquiries, advertisers, verification, proposals, campaigns, creatives, review and moderation, placements inventory, targeting, ad decisioning and delivery, frequency capping, invoices and payments, tracking (impressions, clicks, conversions), reporting and estate opt-outs.

**Confirmed:** all advertising revenue belongs to Safezone/Techguard; estates receive **no revenue share**.

Advertisers can be individuals, residents, businesses, marketplace vendors, estates, property developers, real estate agencies, schools, financial service providers, agencies and other organisations. They do not need to be residents or vendors. They can use the **web and/or the Resident App** (Advertiser mode).

## 2. Capabilities

1. Enquiries from public-web and the Resident App; enquiry tracking.
2. Advertiser registration (individual or organisation), verification, contacts, multiple account managers, agreements, suspension.
3. Proposals (placements, schedule, audience, price set by Techguard, terms) and negotiation records.
4. Campaigns with objectives, advertiser, placements, schedule, budget, targeting, status lifecycle.
5. Creatives: static image, banner, sponsored text, sponsored post, promotional card, video (where the placement supports it); previews; dimension/size validation; versions.
6. Review and moderation: advertiser verification, creative and destination URL review, policy checks, **ARCON vetting approval reference required**, approve/reject/revision, campaign and advertiser suspension.
7. Placements inventory with specs, eligible advertiser categories, targeting options, availability, pricing model, frequency limits, approval requirements.
8. Targeting: all participating estates, selected estates, estate locations, approved areas, contexts, categories — aggregate and privacy-safe.
9. Ad decision service: chooses an ad per placement request respecting schedule, budget/flight, targeting, estate opt-outs, user consent, frequency caps, blocked screens.
10. Tracking: impressions (viewable), clicks (redirect), conversions where supported; invalid traffic filtering.
11. Pricing models (configurable): fixed placement, daily/weekly/monthly rates, sponsored content fee, negotiated packages; cost-per-impression/click later.
12. Quotations, invoices, payments (server-verified), receipts, refunds, billing history.
13. Reports for advertisers (own campaigns only) and cross-campaign reports for Techguard.
14. Estate opt-outs by category.

## 3. Placements (initial)

| Key                            | Surface                  | Format                           | Notes                                      |
| ------------------------------ | ------------------------ | -------------------------------- | ------------------------------------------ |
| `resident.home.banner`         | Resident App home        | Image 1200×400, promotional card | Max 1 per screen view                      |
| `resident.feed.sponsored`      | Community feed           | Sponsored post (text + image)    | Max 1 per 15 feed items                    |
| `resident.marketplace.banner`  | Marketplace home         | Image 1200×400                   |                                            |
| `resident.discovery.sponsored` | Service discovery        | Promotional card                 |                                            |
| `management.dashboard.info`    | Management web dashboard | Informational card               | Only if Techguard and the estate enable it |

**Blocked everywhere:** SOS screens, visitor pass/approval screens, gate workflows, payment confirmation, onboarding, private messages, and the entire Security App. Enforced in the API (decision service never returns ads for blocked contexts) and in the client components.

## 4. Statuses

Enquiry: `submitted → under_review → awaiting_information → proposal_sent → negotiation → approved | rejected → converted_to_campaign`.

Campaign: `draft → submitted → under_review → awaiting_payment → approved → scheduled → active → paused → completed`; also `rejected`, `cancelled`.

## 5. Data model

| Table                | Key columns                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ad_enquiries`       | `id`, `source` (web, resident_app), `contact_name`, `phone`, `email`, `advertiser_type`, `org_name`, `objectives`, `description`, `budget_range`, `duration`, `audience_pref`, `placements_pref`, `documents`, `status`, `assignee_id`, `advertiser_id` |
| `advertisers`        | `id`, `type` (individual, organisation), `name`, `category`, `verification_status`, `verified_at`, `status` (active, suspended)                                                                                                                         |
| `advertiser_members` | `advertiser_id`, `user_id`, `role`                                                                                                                                                                                                                      |
| `ad_agreements`      | `id`, `advertiser_id`, `file_id`, `signed_at`                                                                                                                                                                                                           |
| `ad_proposals`       | `id`, `enquiry_id`, `advertiser_id`, `items` (placements, dates, audience, price), `total`, `status`, `sent_at`, `accepted_at`                                                                                                                          |
| `ad_placements`      | `key`, `surface`, `formats`, `dimensions`, `max_file_kb`, `eligible_categories`, `targeting_options`, `frequency_cap`, `requires_approval`, `active`                                                                                                    |
| `ad_campaigns`       | `id`, `advertiser_id`, `proposal_id`, `title`, `objective`, `starts_at`, `ends_at`, `budget`, `pricing_model`, `status`, `arcon_approval_ref`, `arcon_approval_file_id`, `approved_by`                                                                  |
| `ad_line_items`      | `id`, `campaign_id`, `placement_key`, `targeting` (jsonb), `weight`, `frequency_cap`, `impression_goal`                                                                                                                                                 |
| `ad_creatives`       | `id`, `campaign_id`, `type`, `file_id`, `headline`, `body`, `cta`, `destination_url`, `version`, `review_status`, `review_notes`, `reviewed_by`                                                                                                         |
| `estate_ad_settings` | `estate_id`, `blocked_categories`, `dashboard_info_enabled`                                                                                                                                                                                             |
| `ad_impressions`     | `id`, `campaign_id`, `line_item_id`, `creative_id`, `placement_key`, `estate_id`, `user_hash` (salted, rotating), `app`, `at` — partitioned by day                                                                                                      |
| `ad_clicks`          | same + `click_id`                                                                                                                                                                                                                                       |
| `ad_conversions`     | `click_id`, `type`, `at`                                                                                                                                                                                                                                |
| `ad_stats_hourly`    | `campaign_id`, `line_item_id`, `estate_id`, `hour`, `impressions`, `clicks`, `unique_estimate`                                                                                                                                                          |
| `ad_invoices`        | `id`, `advertiser_id`, `campaign_id`, `number`, `amount`, `vat`, `status`, `payment_intent_id`, `paid_at`                                                                                                                                               |

## 6. Decision service

`GET /v1/ads/decision?placement=resident.home.banner&estateId=&context=home` (authenticated user):

1. Reject if context is blocked → `204 No Content`.
2. Candidate line items: placement match, campaign `active`, now within flight.
3. Filter: targeting includes estate (or area), estate has not blocked the advertiser category, user consent for personalised targeting (else contextual/estate-level only).
4. Frequency cap check per user hash (Redis counters).
5. Pace by weight and goal; pick creative.
6. Return creative payload + signed impression and click tracking URLs.
7. Cache candidate sets per (placement, estate) for 60 s.

Target p95 < 80 ms.

## 7. Business rules

1. Advertising is optional and separately purchasable; it never affects estate access to core features.
2. All campaigns need approval before publication; creatives too.
3. Every ad is visibly labelled **Sponsored** (rendered by client; payload includes the label; review checks it).
4. A campaign cannot go `active` without a verified payment (server-side) or an approved credit arrangement, and without an ARCON approval reference.
5. Advertisers never receive resident personal data, contact lists or private estate records; reports are aggregate with minimum audience thresholds (e.g. no estate-level breakdown below 200 users).
6. Estate-specific targeting respects estate restrictions and blocked categories.
7. Ads never interfere with SOS, security operations, visitor verification, payment confirmation or other critical workflows.
8. Delivery respects schedule and budget; campaigns auto-complete at end date.
9. Authorised administrators can suspend campaigns and advertisers instantly (decision cache purged).
10. All advertising actions are audited.
11. No ads to users who are minors (household members flagged minors have no ad placements).
12. Prohibited/restricted categories configurable (e.g. tobacco banned; alcohol, gambling, political ads restricted per law and policy).
13. Click redirects only to reviewed destination URLs; URL changes need re-review.

## 8. API

| Method         | Path                                                                                   | Purpose                            |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| POST           | `/v1/public/ad-enquiries`                                                              | Submit enquiry (web)               |
| POST           | `/v1/me/ad-enquiries`                                                                  | Submit enquiry (Resident App)      |
| GET            | `/v1/me/ad-enquiries`                                                                  | Track                              |
| GET/PATCH      | `/v1/platform/ad-enquiries[/:id]`                                                      | Manage                             |
| GET/POST/PATCH | `/v1/platform/advertisers[/:id]`                                                       | Advertisers                        |
| POST           | `/v1/platform/ad-proposals` · `/:id/send`                                              | Proposals                          |
| GET/POST/PATCH | `/v1/platform/ad-campaigns[/:id]`                                                      | Campaigns                          |
| POST           | `/v1/platform/ad-campaigns/:id/approve` · `/reject` · `/pause` · `/resume` · `/cancel` | Transitions                        |
| POST           | `/v1/platform/ad-creatives/:id/review`                                                 | Review                             |
| GET/PUT        | `/v1/platform/ad-placements[/:key]`                                                    | Inventory                          |
| POST           | `/v1/platform/ad-invoices`                                                             | Invoice                            |
| GET            | `/v1/advertisers/:advertiserId/campaigns` · `/:id/report`                              | Advertiser view                    |
| POST           | `/v1/advertisers/:advertiserId/creatives`                                              | Upload creatives (when invited to) |
| GET            | `/v1/ads/decision`                                                                     | Serve ad                           |
| GET            | `/v1/ads/i/:token` · `/v1/ads/c/:token`                                                | Impression beacon / click redirect |
| GET/PUT        | `/v1/estates/:estateId/ad-settings`                                                    | Estate opt-outs                    |

## 9. Events and jobs

Events: `advertising.enquiry.submitted`, `advertising.campaign.approved`, `advertising.campaign.activated`, `advertising.campaign.paused`, `advertising.campaign.completed`, `advertising.campaign.suspended`, `advertising.creative.rejected`, `advertising.invoice.paid`.

Jobs: `ads.schedule.transition` (every minute), `ads.rollup.hourly`, `ads.ivt.filter` (invalid traffic), `ads.reports.generate` (PDF), `ads.cache.purge`.

## 10. Acceptance criteria

- The decision endpoint returns no ad for any blocked context, verified by automated UI and API tests.
- A campaign without an ARCON approval reference cannot be approved.
- An estate that blocks a category never shows ads from advertisers in that category.
- Advertiser reports never include personal data or breakdowns below the audience threshold.
