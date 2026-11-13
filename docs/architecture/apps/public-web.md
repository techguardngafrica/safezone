# Public Web (`apps/public-web`)

> Safezone by Techguard · App documentation · v0.1 (13 Nov 2026)
> Status: Draft for product and engineering review · Owner: Web lead

## 1. Purpose

Public Web is the open, unauthenticated (or lightly authenticated) face of Safezone. It serves people who do not use the apps, or who arrive from a link:

- **Visitors** opening their pass link (visitors have no app and no account).
- **Estates** discovering Safezone and starting **self-service registration**.
- **Advertisers** submitting enquiries.
- **Vendors** applying and, from Phase 4, managing their business in the **Vendor Portal** (vendors can also use Vendor mode in the Resident App; there is no dedicated vendor app).
- **Advertisers** viewing reports on the web (Phase 4) and, from Phase 6, self-service.
- Everyone needing legal pages, help and the status page.

## 2. Tech

- Next.js (App Router) with static generation for marketing pages and server rendering for pass pages.
- `packages/web-ui`, `design-tokens`, `i18n`.
- Lightweight: pass page under 100 KB of JavaScript, loads on 3G in under 3 seconds.
- Analytics: privacy-friendly page analytics; no third-party ad trackers.

## 3. Sections and routes

| Route                                                                  | Phase | Purpose                                                                                      |
| ---------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `/`                                                                    | 1     | Marketing home: what Safezone does, for estates, for residents, free onboarding, contact     |
| `/estates`                                                             | 1     | For estate managers: features, how onboarding works, "Register your estate" and "Talk to us" |
| `/register`                                                            | 1     | Self-service estate registration                                                             |
| `/contact`                                                             | 1     | Assisted onboarding request (Techguard contacts the estate)                                  |
| `/p/:token`                                                            | 1     | Visitor pass page                                                                            |
| `/help`                                                                | 1     | Help centre articles for residents, managers, guards                                         |
| `/status`                                                              | 1     | Platform status page                                                                         |
| `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/ad-policy` | 1     | Legal pages                                                                                  |
| `/advertise`                                                           | 4     | Advertising information and enquiry form                                                     |
| `/vendors`                                                             | 4     | Vendor information and application                                                           |
| `/vendor/*`                                                            | 4     | Vendor Portal (signed in)                                                                    |
| `/advertiser/*`                                                        | 4     | Advertiser reports (signed in); self-service from Phase 6                                    |
| `/download`                                                            | 1     | App store links for Resident, Estate Management and Security apps                            |

## 4. Visitor pass page (`/p/:token`)

The pass link is sent by SMS or WhatsApp when a resident creates an invite.

Shows:

- Estate name and logo, host's first name (not full name or unit unless the resident chooses to share), visitor name.
- **QR code** and **6-digit PIN**, large.
- Valid from/to, gate(s), number of entries allowed.
- Status: scheduled, active, used, expired, revoked (live from the API).
- Directions: estate address with a map link; gate instructions set by the estate.
- "Add to wallet" (Phase 3+: Apple/Google Wallet pass).

Rules:

- The token in the URL is a random, unguessable id (not the signed pass token itself); the page fetches the signed QR payload from `GET /v1/public/passes/:token`.
- Rate-limited per IP; no indexing (`noindex`); no personal data beyond what is listed above.
- Revoked or expired passes show a clear message and no QR.
- Works offline once loaded (QR stays on screen).

## 5. Self-service estate registration (`/register`)

Steps:

1. Representative's phone number + OTP (creates or signs into a Safezone account).
2. Representative details: name, email, role at the estate (owner, developer, manager, residents' association officer).
3. Estate details: name, address, state/LGA, location pin, type (gated houses, apartment complex, mixed), approximate number of units and gates.
4. Supporting documents: proof of authority (appointment letter, association resolution, management agreement) and estate proof (e.g. utility bill, survey or C of O reference) — accepted types PDF/JPG/PNG up to 10 MB each.
5. Consent: terms, privacy policy, data processing agreement summary.
6. Submit → status page: "Under review", with expected review time and contact options.

After submission, the application appears in the Super Admin Portal. The representative is notified (SMS, email via Zoho SMTP, push if they have the app) when it is approved, rejected or needs more information. On approval, they get a link to the Estate Management App setup wizard.

Onboarding is **free**: no plan selection or payment step.

## 6. Assisted onboarding request (`/contact`)

Short form: name, phone, email, estate name, location, size, preferred contact time, message. Creates a lead in the Super Admin onboarding pipeline. Techguard then creates the estate record and invites the representative as administrator.

## 7. Advertising (`/advertise`, Phase 4)

- Information: audiences (aggregate, no personal data), placements, policies, ARCON vetting requirement.
- **Enquiry form**: individual or organisation, contact details, business information, objectives, campaign description, budget range, duration, preferred audience (estates/areas), preferred placements, supporting documents.
- Enquiry status tracking by link sent to the advertiser's email/phone.
- Signed-in advertiser area (`/advertiser/*`): campaigns, status, reports (own campaigns only), invoices and receipts.
- Advertisers can do the same in Advertiser mode inside the Resident App.

## 8. Vendor Portal (`/vendor/*`, Phase 4)

Mobile-responsive, signed in with phone + OTP, vendor roles from [authz.md](../modules/authz.md).

| Area     | Features                                                                 |
| -------- | ------------------------------------------------------------------------ |
| Profile  | Business details, documents, verification status, service areas          |
| Listings | Services, prices, availability, photos                                   |
| Estates  | Which estates have approved the vendor                                   |
| Orders   | Inbox, accept/decline, schedule, status updates, chat with resident      |
| Staff    | Invite employees, assign to orders                                       |
| Payouts  | Earnings, commission deducted, payout history (from provider settlement) |
| Reviews  | Ratings and reviews, responses                                           |
| Disputes | Open disputes and outcomes                                               |

Vendor application (`/vendors`): business details, owner identity, documents, categories, areas, bank details (captured by the payment provider for subaccount creation, never stored raw by Safezone).

## 9. SEO and content

- Marketing pages server-rendered with metadata, Open Graph, sitemap and schema markup (Organization, SoftwareApplication, FAQ).
- Pass pages, portals and status detail pages are `noindex`.
- Content managed as MDX in the repo initially; CMS later if needed.

## 10. Security and privacy

- Strict Content Security Policy; no third-party scripts on pass and portal pages.
- Bot protection (Turnstile or similar) on registration, contact and enquiry forms.
- Cookie banner only for non-essential cookies; essential-only by default.
- Uploads go directly to object storage via signed URLs and are virus-scanned before review.

## 11. Folder structure

```text
apps/public-web/
├── app/
│   ├── (marketing)/          # /, /estates, /advertise, /vendors, /download
│   ├── register/
│   ├── contact/
│   ├── p/[token]/            # visitor pass
│   ├── help/
│   ├── status/
│   ├── legal/
│   ├── vendor/               # Vendor Portal (Phase 4)
│   └── advertiser/           # advertiser area (Phase 4)
├── content/                  # MDX
└── next.config.ts
```

## 12. Testing

- Playwright: open pass (active, expired, revoked), complete estate registration with documents, submit contact form, submit ad enquiry, vendor sign-in and order update.
- Lighthouse budget in CI for `/` and `/p/:token` (performance ≥ 90 on mobile).

## 13. Acceptance highlights

- A visitor can open their pass and show the QR at the gate on a basic smartphone over 3G.
- An estate representative can submit a complete registration in under 10 minutes.
- A revoked pass page stops showing the QR within 1 minute of revocation.
