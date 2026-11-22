# ADR-0024: Managed advertising (Phase 4)

- **Status:** Accepted (22 Nov 2026)
- **Date:** 2026-11-22
- **Deciders:** Sunday Etom Eni
- **Affects:** advertising (new), payments, authz, permissions, schemas, tenancy settings, super-admin, public-web, resident-mobile

## Context

advertising.md describes Techguard-managed advertising: enquiries, advertisers, campaigns, creatives, review with ARCON vetting, an ad decision service, tracking, reports and estate opt-outs. All ad revenue is Safezone's (AGENTS.md §2.4). Ads are banned on SOS, visitor pass and approval, gate workflows, payment confirmation, onboarding, private messages and the whole Security App (§6.2). Advertisers never see resident personal data (§6.5).

## Decision

1. **Scope of Phase 4.** Enquiries (web and app), advertisers and their members, placements inventory (seeded), campaigns with line items and creatives, review and approval, invoices paid on Safezone's account, the decision service, impression and click tracking, aggregate reports, estate category opt-outs, and the schedule job. Advertiser self-service and cost-per-impression pricing stay in Phase 6.
2. **No proposals table yet.** Techguard agrees price and placements with the advertiser outside the system (tracked on the enquiry with status and notes) and records the agreed price as the campaign budget. `ad_proposals` comes when negotiation needs its own records.
3. **Estate opt-outs reuse estate settings.** `ads.blocked_categories` already exists in tenancy settings; `ads.dashboard_info_enabled` (default off) is added. `GET/PUT /v1/estates/:estateId/ad-settings` reads and writes those keys through tenancy, so there is no `estate_ad_settings` table.
4. **Payment.** An ad invoice (amount plus 7.5% VAT, integer kobo) is paid through a platform charge on Safezone's own account with route kind `ad_invoice`; verification emits `payments.ad_charge.*` for the `ads` queue. A campaign becomes active only when its invoice is paid or Techguard records an approved credit arrangement (who, when, note).
5. **Approval gates.** A campaign cannot be approved without an ARCON approval reference, an advertiser that is verified and active, and every creative approved. A creative change makes a new version that needs review again (rule 13). Banned categories (tobacco) cannot be approved; restricted categories (alcohol, gambling, political) need an explicit platform note.
6. **Decision service.** `GET /v1/ads/decision` (signed in, estate member) answers 204 for blocked contexts and for users flagged as minors in any household of the estate. Candidates are active line items for the placement whose flight covers now, targeting the estate (all, listed estates or the estate's state) and not in a category the estate blocked. Targeting is estate-level only, so no personal-data consent is needed. Frequency caps use Redis counters per rotating user hash per line item per day. Weighted random choice; the candidate set is cached per placement and estate for 60 s and purged on suspend.
7. **Tracking.** Impression and click URLs carry HMAC-signed tokens (`ADS_TRACKING_SECRET`, dev default). Rows store a daily-rotating salted user hash, never the user id. Impressions are de-duplicated per token. Clicks redirect only to the creative's reviewed destination URL. Tables are not partitioned yet; partitioning and hourly rollups come with real volume.
8. **Reports.** Advertiser members see totals and daily series for their own campaigns; per-estate rows appear only for estates with at least 200 unique users in the period, the rest grouped as "Other estates".
9. **Access.** New advertiser-level permissions (`advertiser.campaign.read`, `advertiser.creative.manage`, `advertiser.invoice.pay`) are checked against `advertiser_members` on `/v1/advertisers/:advertiserId/...`, like vendor routes (ADR-0023). Platform routes use the existing `ad.*` permissions.

## Consequences

- New `advertising` module, migration, `advertising` and `advertising_admin` database contexts, an `ads` consumer for the schedule job and invoice payments.
- The authorization guard generalises vendor scoping to advertiser scoping.
- Super Admin gets advertising screens; public-web gets `/advertise` and `/advertiser/*`; the Resident App gets sponsored slots and Advertiser mode.
- Open with the product owner: rate card, whether VAT is charged on all invoices, and the restricted-category policy text.
