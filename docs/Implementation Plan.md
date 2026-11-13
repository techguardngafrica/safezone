# Safezone — Full Implementation Plan

Nov 13, 2026 · @Etom Sunday

## Summary and planning assumptions

Build Safezone as a modular monolith on one shared backend and ship it in six phases over about 18 months, starting with gate security and SOS, then money, then community, then commerce. Security and SOS go first because they are the reason an estate adopts, they gather the data everything else needs (units, residents, households), and they work without payment licensing. The full PRD vision stays intact; this plan only sets the order and fills the gaps.

**Assumptions this plan rests on (change any of them and the dates move):**

- Build starts in December 2026 with a Phase 0 of about six weeks.
- A core team of about 10 people (see Team), growing to about 16 by Phase 3.
- Stack: NestJS, PostgreSQL, Redis and BullMQ on the backend; Next.js for web; React Native with Expo for mobile; one monorepo.
- Nigeria only until Phase 6, with Naira, English, WAT and Nigerian providers. Multi-country support is designed in but not switched on.
- Two or three pilot estates are signed before Phase 1 ends: at least one gated estate of houses and one apartment complex.
- Safezone never holds estate money. Payments settle straight into each estate's account through the payment provider's split or subaccount feature.
- Android is the priority platform for residents and guards; iOS ships at the same time but is tested on fewer devices.

### Confirmed business decisions

- **Free estate onboarding.** Estates join without paying a subscription at launch, and every estate gets all core features free. The aim is to lower the barrier to adoption and build the user base first. Premium features or paid plans may come later.
- **Advertising revenue.** All ad revenue goes to Safezone/Techguard. Estates get no share.
- **Two ways to onboard an estate.** Both must be supported from Phase 1.

**Self-service onboarding**

1. An estate representative creates an account.
2. They submit estate details and supporting documents.
3. Techguard reviews the application.
4. The estate is approved or rejected.
5. An approved estate gets its management workspace.
6. The estate manager sets up properties, staff and residents.

**Techguard-assisted onboarding**

1. The estate contacts Techguard.
2. Techguard creates the estate record.
3. Techguard enters the initial estate information.
4. An estate representative is invited as administrator.
5. The representative verifies access and completes setup.

## Gaps in the brief and PRD, and what to add

The PRD is strong on features but thin on the people and processes that sit outside the four apps, on offline gate operations, and on Nigerian regulation. These 28 additions should go into PRD v0.3. The Phase column says when each one is needed.

### Missing users and interfaces

| Gap | What to add | Phase |
| --- | --- | --- |
| Visitors have no interface | A visitor pass page on the web (no account, no app), with the pass sent by SMS or WhatsApp. It shows the QR code, PIN, validity, gate and directions. | 1 |
| Vendors have no app or portal | A Vendor Portal (web, mobile-responsive) for listings, orders, schedules, payouts and staff. Vendors can also manage their business from a Vendor mode inside the Resident App. No dedicated vendor app (PRD open question 27). | 4 |
| Advertisers have no interface | Advertisers use the web and/or the Resident App. Phase 4: an enquiry form on both, and an emailed PDF report. Phase 6: an Advertiser Portal for self-service on the web, plus an Advertiser mode in the Resident App. | 4, 6 |
| Non-resident landlords | An "Owner" mode in the resident app: their units, tenants, approvals and the charges billed to the owner. | 2 |
| Public website | A marketing site with estate sign-up, the advertising enquiry form, a status page and the legal pages. | 1 |
| Shared guard phones at gates | A kiosk-style security app: the device is registered to a gate, guards sign in by PIN per shift, and any guard can be logged out remotely. | 1 |
| Domestic staff and artisans | Long-term worker passes (cleaner, driver, nanny) with schedules, a photo and per-household approval. | 1 |

### Operations the PRD assumes but does not specify

| Gap | What to add | Phase |
| --- | --- | --- |
| Getting estate data in | Bulk import from Excel or CSV for units, residents, vehicles and opening balances, with validation, a dry run and an error report. Onboarding stalls without it. | 1 |
| Offline gate operations | Signed QR passes the guard app can verify offline, a local cache of today's passes, a queue of entries to sync, and an SMS fallback. Answers PRD open question 9. | 1 |
| Customer support | Help desk and ticketing for estates and residents, support access to an estate ("view as") with consent and an audit trail, SLAs and escalation. | 1 |
| Estate offboarding and data export | Export of all estate data on request or at termination, a retention period, then deletion. Answers PRD open question 28. | 2 |
| Safezone's own billing | Not needed at launch: core features are free. Build plan and entitlement switches now, so premium features or paid plans can be added later without rework. | Later |
| Feature flags and module entitlements | Per-estate switches for modules and plans, so packaging can change without code changes. | 0 |
| Move-out and lease expiry | When a tenancy ends: access is revoked, recurring passes are cancelled, members leave the community channels, and balances are settled. | 1–2 |
| Field onboarding and training | An onboarding playbook, guard training materials, and resident sign-up drives through flyers with QR codes. | 1 |
| Forced app updates | A minimum supported version per app, with soft and hard update prompts. Guard phones must not run stale builds. | 1 |

### Payments, money and providers

| Gap | What to add | Phase |
| --- | --- | --- |
| Who holds the money | Use the payment provider's split payments or subaccounts so funds settle straight to the estate. Safezone takes its fee by split. This avoids needing a payments licence. Get legal sign-off. | 0 |
| Bank-transfer reconciliation | Dedicated virtual accounts per resident or per unit, so transfers match automatically. This is how most Nigerians pay dues. | 2 |
| Electricity token supply | A bill-payment aggregator for DisCo tokens, plus an adapter for estate-run sub-meter vendors. The PRD names neither. | 2 |
| Messaging cost and delivery | Sender ID registration, DND-route SMS, WhatsApp as a cheaper channel, cost tracking per estate, and a rule for who pays for SMS. | 1 |
| Identity checks | Phone number plus OTP sign-in, optional NIN checks for owners and staff through a KYC provider, and SIM-swap and OTP-abuse protection. | 1 |

### Legal and compliance

| Gap | What to add | Phase |
| --- | --- | --- |
| Data protection roles | The estate is the data controller and Techguard the processor for estate data; Techguard is the controller for ads and accounts. A data processing agreement goes into every estate contract. | 0 |
| NDPC registration and DPO | Every controller and processor must appoint a DPO, and those of major importance must register with the NDPC ([GAID 2025](https://legalbytes.substack.com/p/gaid-2025-what-nigerian-businesses)). Do a DPIA before pilot because of location, ID and visitor data. | 0 |
| Ad vetting | ARCON requires online ads to be vetted before they run ([ARCON guidelines review](https://webiis10.mondaq.com/nigeria/social-media/1693212/a-review-of-the-advertising-regulatory-council-of-nigerias-arcon-2023-vetting-guidelines)). Capture the advertiser's vetting approval as a required field in the campaign workflow, and confirm the details with counsel. | 4 |
| Residents' ad consent | Ads that are not personalised by default, a consent setting for targeted ads, and no ads for users who are minors. | 4 |
| Incident evidence | Retention rules and a chain of custody for SOS and incident photos, videos and logs that may go to the police. | 1 |
| Cross-estate blacklists | Sharing "banned visitor" lists across estates is legally risky. Keep blacklists per estate until counsel approves sharing. | 1 |

### SOS reliability

SOS needs more than the PRD gives it. Add: a test mode, so estates can run drills without real alerts; false-alarm and abuse handling; SOS over SMS for phones without data; guard escalation if no one acknowledges within N seconds; synthetic monitoring that fires a test SOS every 15 minutes on a canary estate; and a documented list of public emergency numbers per state (112 nationally, 767 in Lagos), to be confirmed per state.

## Open decisions, with recommended defaults

All 30 open questions in PRD section 36 have a recommended default below, so building can start. Only the ones marked Phase 0 block the build. The rest can be confirmed by the phase shown, and changing a default before then costs little.

| # | Decision | Recommended default | Decide by |
| --- | --- | --- | --- |
| 1 | Estate self-registration | Confirmed: both. Self-service sign-up with documents, then Techguard review and approval or rejection; or Techguard-assisted, where Techguard creates the estate and invites an administrator. | Phase 0 |
| 2 | Verifying and transferring ownership | The estate manager attests ownership using uploaded documents. A transfer is a two-sided request (current owner and manager), with history kept. | Phase 1 |
| 3 | Residents requesting access on their own | Yes. A resident requests to join an estate and unit; the owner or manager approves. | Phase 1 |
| 4 | Tenants needing homeowner approval | Configurable per estate. Default: the owner approves, and the manager can override. | Phase 1 |
| 5 | Representing multi-tenant buildings | Unit hierarchy: estate → zone → street or block → building → unit. Occupancy attaches to the unit. | Phase 0 |
| 6 | Owner portal or resident app | Resident app with an Owner mode. No separate portal. | Phase 1 |
| 7 | Security contractors across estates | Phase 1: guards belong to one estate. Phase 5: a "Security Company" organisation that assigns guards across estates. | Phase 1 |
| 8 | Automatic gate opening | Not in Phase 1–5. Design the gate-event API now; add hardware in Phase 6. | Phase 1 |
| 9 | Offline functions | Pass verification, entry and exit logging, and SOS by SMS. Everything else needs a connection. | Phase 0 |
| 10 | SOS escalation intervals | Configurable. Default: 60 seconds to the next guard, 120 seconds to the supervisor and manager, 180 seconds to emergency contacts by voice call. | Phase 1 |
| 11 | External emergency organisations | None integrated at launch. Show the state emergency numbers in the app. Explore private response firms after pilot. | Phase 2 |
| 12 | Full accounting or integration | Build billing and receivables in Phase 2. Export to accounting tools first; build a full general ledger in Phase 5 only if estates ask for it. | Phase 2 |
| 13 | Settlement into estate accounts | Direct to the estate through provider subaccounts and split payments. Safezone never holds funds. | Phase 0 |
| 14 | Financial approval workflows | Two levels: the creator, then an approver (accountant or manager). Thresholds configurable per estate. | Phase 2 |
| 15 | Private messaging on by default | Off by default; the estate turns it on. | Phase 3 |
| 16 | Building channels created automatically | Yes, one per building, membership synced from occupancy. | Phase 3 |
| 17 | Channels needing approval | Resident-created channels need approval by default; the estate can switch this off. | Phase 3 |
| 18 | Estates disabling community features | Yes. Every community feature is an estate-level switch. | Phase 3 |
| 19 | Techguard-managed ads or self-service | Managed only until Phase 6. | Phase 4 |
| 20 | Ad pricing model | Fixed-duration packages (weekly or monthly per placement) at launch. Add cost per impression once delivery data is trusted. | Phase 4 |
| 21 | Estates opting out of ad categories | Yes, per category. | Phase 4 |
| 22 | Targeting specific estates | Yes, but only estates that have opted in, and only for audiences of 200 or more residents. | Phase 4 |
| 23 | Revenue share for estates | Confirmed: no. All ad revenue goes to Safezone/Techguard. | Phase 4 |
| 24 | Ad enquiries via website and app | Yes, both, through one shared enquiry form. | Phase 4 |
| 25 | Vendors across multiple estates | Yes. A vendor is a platform-level account; each estate approves which vendors appear to its residents. | Phase 4 |
| 26 | Vendor commission and settlement | A percentage commission taken by split payment at checkout, with weekly payouts handled by the provider. | Phase 4 |
| 27 | Dedicated vendor mobile app | Decided: no. Vendors use the web Vendor Portal and/or a Vendor mode inside the Resident App. | Phase 4 |
| 28 | Estate records when a subscription ends | Read-only for 90 days, safety records kept under the retention policy, then export and deletion. | Phase 2 |
| 29 | Additional languages | Build i18n in from the start. English at launch; Pidgin, Yoruba, Hausa and Igbo after pilot feedback. | Phase 0 |
| 30 | Which smart hardware first | QR gate scanners and barrier controllers first, then CCTV event links. | Phase 5 |
| 31 | **New:** separate or merged resident and manager mobile apps? | Decided: keep four primary application surfaces — Resident App (Android, iOS), Estate Management App (web, Android, iOS), Security App (Android, iOS) and Super Admin Portal (web). A manager who lives in the estate uses the Resident App and the Estate Management App with one account. | Phase 0 |

## Architecture and tech stack

One NestJS modular monolith, deployed as three processes (API, worker, realtime gateway) over one PostgreSQL database with row-level security. Microservices would slow a team of about 10 down. Strict module boundaries keep the option of splitting out ads or messaging later, if load demands it.

&#91;embedded content: Safezone runtime architecture · 5 apps, 3 processes, 2 data stores\]

Every app calls the same API and realtime gateway; slow work (notifications, SOS fan-out, billing) goes through Redis queues to the worker, which makes most calls to outside providers.

### Codebase

One monorepo (Turborepo or Nx) with pnpm workspaces:

```text
safezone/
├── apps/
│   ├── api/                  # NestJS backend: API, worker and realtime entry points
│   ├── resident-mobile/      # Expo
│   ├── management-web/       # Next.js
│   ├── management-mobile/    # Expo
│   ├── security-mobile/      # Expo
│   ├── super-admin/          # Next.js
│   └── public-web/           # Next.js (added): site, visitor passes, ad enquiries
│
├── packages/
│   ├── contracts/            # Shared API contracts
│   ├── schemas/              # Shared validation schemas
│   ├── types/                # Shared TypeScript types
│   ├── api-client/           # Generated/typed API client
│   ├── auth/                 # Shared auth utilities
│   ├── permissions/          # Permission definitions
│   ├── design-tokens/        # Shared design system tokens
│   ├── mobile-ui/            # Shared mobile components
│   ├── web-ui/               # Shared web components (added)
│   ├── i18n/                 # Translated strings (added)
│   └── config/               # Shared lint/TS configs
│
├── infrastructure/
│   ├── docker/
│   ├── ci/
│   └── deployment/
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   └── operations/
│
└── package.json
```

- **apps/api** builds three processes from one codebase: the REST API, the BullMQ worker and the Socket.IO realtime gateway. They share modules but deploy and scale separately.
- **public-web** hosts the visitor pass page (visitors have no app), the marketing site, the ad enquiry form and, in Phase 4, the Vendor Portal.
- **web-ui** holds components shared by management-web, super-admin and public-web; **i18n** holds translated strings for all apps (decision 29).
- Super Admin runs on its own domain behind its own SSO; security-mobile runs in kiosk mode with offline support.

### Backend modules

Each PRD domain is a NestJS module that owns its tables and exposes services only through its public interface; nothing reads another module's tables. Modules: identity, authz, tenancy, property, occupancy, visitor, security, emergency, billing, payments, utilities, maintenance, facilities, community, notifications, documents, governance, marketplace, procurement, workforce, devices, advertising, platform, audit, analytics.

### Key technical choices

- **Tenant isolation:** an `estate_id` on every tenant table, PostgreSQL row-level security policies, and the tenant set per request inside the transaction (`SET LOCAL app.estate_id`). A CI test suite tries to read across tenants on every endpoint.
- **Authorisation:** a policy engine (CASL or similar) over scoped role assignments: user + role + estate + optional scope (building, gate). The same rules run in the API and are mirrored in the apps to hide what users cannot do.
- **Events:** a transactional outbox table, relayed to BullMQ. Audit logs, notifications, analytics and webhooks all consume events, so none of them slow down the request.
- **SOS path:** its own high-priority queue, its own worker pool, and a fan-out that sends push, SMS and voice in parallel rather than one after another. The target is under 5 seconds from trigger to the first guard notified.
- **Offline visitor passes:** each pass is a short token signed with the estate's Ed25519 key. The guard app holds the estate's public key and a revocation list synced every few minutes, so it can verify a QR code with no network.
- **Messaging:** messages in PostgreSQL, partitioned by month, with cursor pagination. Media in object storage behind signed URLs.
- **Ads:** a decision endpoint picks the ad for a placement from active campaigns, targeting, frequency caps and estate opt-outs, cached in Redis. Impressions and clicks go into partitioned event tables and roll up hourly.
- **Auth:** phone number and OTP as the main sign-in, an optional password, short-lived access tokens with rotating refresh tokens, a session per device, and TOTP-based MFA required for all estate staff and platform admins.
- **Search:** PostgreSQL full-text search to start; a separate search engine only if it becomes a bottleneck.
- **Hosting:** a managed cloud with managed PostgreSQL (with a read replica), managed Redis, S3-compatible storage and a CDN. Pick the region on latency from Lagos and on NDPA transfer rules. Infrastructure as code (Terraform) from day one.

### Integrations (all behind adapters, candidates to evaluate in Phase 0)

| Category | Candidates | Needed in |
| --- | --- | --- |
| Payments | Paystack, Flutterwave (split payments, subaccounts, virtual accounts) | Phase 2 |
| SMS | Termii, Africa's Talking (DND route, registered sender ID) | Phase 1 |
| WhatsApp | Meta WhatsApp Cloud API | Phase 1 |
| Voice calls for SOS | Africa's Talking Voice, Twilio | Phase 1 |
| Push | Expo Notifications, fully managed (Expo's push service delivers to FCM and APNs; delivery checked through push receipts) | Phase 1 |
| Email | Zoho SMTP | Phase 1 |
| Identity checks (NIN) | Dojah, Prembly, Smile ID | Phase 1 |
| Bills and electricity tokens | VTpass, Baxi, BuyPower | Phase 2 |
| Maps and location | Google Maps Platform | Phase 1 |
| Monitoring | Sentry, Grafana stack with OpenTelemetry | Phase 0 |

## Data model and tenancy design

Six modelling decisions shape almost every table. They are expensive to change once data exists, so they must be settled and reviewed in Phase 0, before any feature work.

1. **A person is global; a membership is per estate.** `users` is platform-wide: one phone number, one account. `estate_memberships` links a user to an estate, and `role_assignments` (user, role, estate, optional scope, valid from and to, granted by) gives them powers there. This is how one account can be a manager in Estate A and a tenant in Estate B.
2. **Ownership and occupancy are separate tables.** `ownerships` (unit, owner, share %, from, to, evidence) and `occupancies` (unit, household, type: owner-occupier, tenant or staff, from, to). Households hold `household_members`, each with permissions (may invite visitors, may pay, may trigger SOS). Building channel membership and gate access are derived from active occupancies, so a move-out updates them automatically.
3. **The property hierarchy is one self-referencing tree.** `spaces` (id, estate\_id, parent\_id, type: phase, zone, street, block, building, floor or unit, code, path). Estates use as many levels as they need, and "all units in Block C" is one indexed query on `path`.
4. **Money is double-entry and append-only.** Charges, invoices, payments, waivers and refunds post to a ledger of entries that are never edited; corrections are reversing entries. A unit's balance is the sum of its entries. Phase 2 needs only receivables, but the same ledger grows into the Phase 5 general ledger without migration.
5. **Platform data and estate data live in different schemas.** Tenant tables (with `estate_id` and row-level security) sit in one schema; platform tables (plans, subscriptions, vendors, advertisers, campaigns, placements) sit in another and are reachable only through platform roles. Campaign targeting links to estates by ID only, so advertisers never touch tenant rows.
6. **Everything important is audited and soft-deleted.** An append-only `audit_events` table (actor, acting-as role, estate, action, resource, before and after, IP, device, time), filled from the outbox. Safety records (SOS, incidents, gate logs) are never hard-deleted inside their retention period, even if the estate stops paying.

**Also fix in Phase 0:** UUIDv7 primary keys (sortable, safe to expose); money stored as integer kobo; all times as UTC `timestamptz`, displayed in WAT; partitioning by month for gate logs, messages, notifications and ad events; and a retention schedule per table, agreed with the DPO.

## Phased roadmap

Seven phases, each ending in a gate the product must pass before the next starts. Pilot estates go live at the end of Phase 1 (May 2027), and every module in the PRD ships by the end of Phase 5 (May 2028). Each phase is releasable on its own, and the modules are switched on per estate through entitlements.

&#91;embedded content: Safezone roadmap · 7 phases, 6 gates\]

Each diamond is a gate: the next phase starts only when its criteria are met. Phase 1 is highlighted because pilot go-live is the date everything else hangs on.

### Phase 0 — Foundations (Dec 2026 – Jan 2027, about 8 weeks including holidays)

**Goal:** close the blocking decisions and build the skeleton every module stands on.

- PRD v0.3 with the gaps and decisions above; signed pilot letters of intent from 2–3 estates.
- Design system, information architecture, and clickable prototypes of the gate, SOS and visitor flows, tested with real guards and residents.
- Monorepo, CI/CD, Terraform, dev, staging and production environments, and observability.
- Identity (phone OTP, sessions, MFA), tenancy and row-level security, the authorisation engine, the audit outbox, feature flags and entitlements, notifications core, file storage.
- Legal: DPIA started, DPO appointed, data processing agreement template, terms and privacy policy drafts, payment-flow sign-off.

**Gate:** an architecture review is passed; the cross-tenant test suite is green; the prototypes are validated with at least 5 guards and 10 residents.

### Phase 1 — Secure Estate MVP (Feb – May 2027, 16 weeks)

**Goal:** an estate can run its gate and SOS on Safezone with no paper visitor book.

- **Super Admin:** self-service and Techguard-assisted estate onboarding, document review, approval or rejection, administrator invitations, estate activation and suspension, user lookup, support access with audit trail.
- **Estate Management App (web in full; Android and iOS for approvals, visitor monitoring, SOS alerts and announcements):** configuration, the spaces tree, bulk import, residents and households, staff and guards, gates, visitor logs, SOS console, announcements, basic reports.
- **Resident App:** sign-up and join requests, household, visitor invites (one-time, recurring, multi-visitor), domestic staff passes, SOS, announcements, notifications.
- **Security app:** kiosk sign-in, expected visitor list for the shift, QR and PIN verification online and offline, walk-in requests with resident approval, entry and exit logging, vehicle check, SOS receive, acknowledge and respond, incident reports, shift start and end.
- **Public:** visitor pass page, marketing site, legal pages.
- **Platform:** SMS, WhatsApp, push and voice adapters; SOS escalation; forced updates; help desk.

**Gate:** penetration test passed with no open high-severity findings; load test of 3x pilot peak passed; pilot go-live with at least 80% of visitors processed digitally in week 4; SOS median time to first acknowledgement under 60 seconds in drills.

### Phase 2 — Money and Maintenance (Jun – Aug 2027, 12 weeks)

**Goal:** estates collect dues digitally and residents report issues in the app.

- Charges, bulk and per-unit billing, invoices, partial payments, penalties, waivers, statements and receipts, all on the double-entry ledger.
- Paystack and Flutterwave with split settlement to the estate, virtual accounts for bank transfers, automatic reconciliation, refunds and disputes.
- Electricity tokens and bill payments through an aggregator; meter registration; utility payment history.
- Maintenance and complaints with work orders, staff assignment, photo and video attachments, resident feedback and SLAs.
- Owner mode for landlords; move-in and move-out workflows; financial approvals.
- Plans and entitlements framework, with every estate on the free core plan. Billing estates waits until premium features or paid plans are introduced.
- Estate data export and offboarding.

**Gate:** reconciliation matches 99% of pilot payments automatically; no ledger discrepancies in a month-end audit; at least 50% of pilot dues paid digitally.

### Phase 3 — Community and Facilities (Sep – Nov 2027, 12 weeks)

**Goal:** replace estate WhatsApp groups with structured, moderated channels.

- Building channels synced from occupancy, estate-wide channels, resident-created channels with approval, private messaging (off by default), reactions, attachments.
- Moderation: reporting, muting, removal, suspension, moderator roles, audit log, community guidelines, appeals.
- Official estate communications, kept visually distinct; polls.
- Facilities: registration, availability, booking rules, pricing, approvals, payments, cancellation, damage reports.
- Documents: uploads, categories, permissions, versions, expiry reminders, access history.

**Gate:** at least 40% of active residents post or react monthly in pilot estates; reported content reviewed within 24 hours.

### Phase 4 — Commerce: Marketplace and Managed Ads (Dec 2027 – Feb 2028, 12 weeks)

**Goal:** open the two new revenue streams without touching safety workflows.

- Vendor onboarding and verification, Vendor Portal on the web and Vendor mode in the Resident App, service listings, bookings and orders, split-payment commissions, payouts, reviews and ratings, disputes; estate approval of vendors.
- Ad enquiries from the web and the Resident App, advertiser records and verification, ARCON approval capture, placements inventory, campaigns, creatives and review, invoices and payments, the ad decision service, frequency caps, estate opt-outs, impression and click tracking, PDF reports.
- Ad slots exist only in the resident app's home, community feed, marketplace and discovery screens. They are blocked at the component level from SOS, visitor verification, payment confirmation and the whole Security app.

**Gate:** first 10 paying advertisers; first 20 vendors live; no ad shown on a blocked screen in automated UI tests.

### Phase 5 — Operations Depth (Mar – May 2028, 12 weeks)

**Goal:** serve large estates and property management companies.

- Full accounting: chart of accounts, general ledger, payables, bank reconciliation, budgets, financial periods and statements; exports to accounting tools.
- Procurement and inventory: suppliers, purchase requests and orders, approvals, goods received, stock and assets.
- Staff and HR: departments, attendance, leave, duty rosters, payroll export.
- Governance: policies, AGMs, minutes, resident voting, resolutions, acknowledgements.
- Security companies across estates; patrol checkpoints by QR or NFC; deeper analytics dashboards.

**Gate:** at least one property management company running five or more estates on Safezone.

### Phase 6 — Smart Estate and Scale (Jun 2028 onward)

- IoT: gate barriers and scanners, number-plate recognition, CCTV event links, sensors, generator and water monitoring, device health.
- Advertiser self-service on the web and in the Resident App, cost-per-impression pricing.
- Public partner API and webhooks; white-label options for large estate groups.
- More languages; expansion to a second country (likely Ghana or Kenya) once multi-currency and local providers are added.

## Team, process and delivery cadence

The timeline assumes about 10 people in product and engineering from Phase 0, growing to about 16 (customer success included) by Phase 3 as finance, community and commerce work run in parallel. With fewer engineers, keep the phase order and stretch each phase in proportion; do not cut the testing and security work at the gates.

| Role | Phase 0–2 | Phase 3–5 | Main focus |
| --- | --- | --- | --- |
| Product owner | 1 | 1 | PRD, priorities, pilot relationships, acceptance |
| Tech lead / architect | 1 | 1 | Architecture, reviews, tenancy, security design |
| Backend engineers (NestJS) | 3 | 4 | Modules, integrations, workers |
| Mobile engineers (Expo) | 2 | 3 | Resident and manager app, Security app |
| Web engineers (Next.js) | 1 | 2 | Estate web, Super Admin, public site |
| Product designer | 1 | 1 | Design system, flows, field research |
| QA engineer | 1 | 1 | Test automation, device lab, release checks |
| DevOps / SRE (part-time to start) | 0.5 | 1 | Infrastructure, CI/CD, monitoring, on-call |
| Customer success and onboarding | from Phase 1: 1 | 2 | Estate setup, training, support |
| Legal and DPO (external) | as needed | as needed | NDPA, contracts, payments, ARCON |

**How work runs:**

- Two-week sprints, with a demo to a pilot estate representative every sprint from Phase 1 onward.
- A phase gate review at the end of each phase against the exit criteria above; the next phase starts only when the gate is passed or an exception is recorded.
- Each module gets acceptance criteria and test scenarios written before its sprint starts (PRD section 37).
- Architecture decision records for every significant choice, kept in the repo.
- Trunk-based development with feature flags, pull request reviews, and preview environments for web.
- Releases: backend continuously to staging, to production weekly; mobile through store builds every two weeks plus over-the-air updates for fixes, with staged rollouts.
- On-call rota from pilot go-live, with SOS-path alerts paging immediately.

## Cross-cutting work: security, compliance, testing, DevOps, monitoring

These run through every phase and carry their own share of each sprint (roughly 20%). They are what the phase gates check.

### Security

- Target OWASP ASVS Level 2 for the API and web apps; MASVS for the mobile apps.
- MFA for every staff and admin role; the Super Admin Portal on a separate domain behind an IP allowlist and SSO.
- Support or admin access to an estate needs a recorded reason, is time-limited, and is visible to the estate in its audit log.
- Secrets in a managed vault, never in the repo; dependency and container scanning in CI.
- Rate limits on OTP, sign-in, pass verification and SOS; device binding and SIM-swap checks on sensitive actions.
- Payment webhooks verified by signature and checked against the provider's API before any ledger entry.
- Independent penetration test before pilot go-live and before each money or commerce phase goes live.

### NDPA compliance

- DPO appointed in Phase 0; NDPC registration if Safezone is classed as a data controller or processor of major importance.
- DPIA covering location, visitor, identity and community data before pilot; updated each phase.
- Records of processing, a retention schedule per data type, a consent register (marketing, targeted ads, location sharing).
- Data subject requests (access, correction, deletion, export) handled in Super Admin, with a 30-day clock.
- Breach response runbook with a 72-hour notification path; data processing agreements with every estate and provider.
- Privacy by design: phone numbers and addresses masked by default in guard and community views; location shared only during an active SOS.

### Testing

- Unit and integration tests for every module, with real PostgreSQL in containers (row-level security cannot be tested on mocks).
- A tenant-isolation suite that runs every endpoint as a user of another estate and expects a denial.
- End-to-end tests: Playwright for web, Maestro for mobile, covering the gate, SOS, payment and onboarding flows.
- Load tests (k6) on morning gate peaks, SOS fan-out across a whole estate, billing runs and ad delivery.
- A device lab of 8–10 low and mid-range Android phones common in Nigeria, plus two iPhones; tests on poor 3G and offline.
- Field tests at a real gate before every Security app release in Phase 1.

### DevOps

- Terraform for all infrastructure; separate dev, staging and production accounts.
- GitHub Actions for build, test, scan and deploy; database migrations that are backward compatible and run before deploy.
- EAS builds and over-the-air updates for mobile, with a minimum-version check enforced by the API.
- Daily backups with point-in-time recovery, a restore test every month, and a written disaster recovery plan (recovery point under 15 minutes, recovery time under 4 hours).

### Monitoring

- OpenTelemetry traces, logs and metrics; Sentry for errors and crashes on all apps.
- Service levels to alert on: API 95th-percentile under 500 ms; 99.9% availability; SOS trigger to first guard notified under 5 seconds; SMS delivery rate per provider; payment webhook lag.
- A synthetic SOS every 15 minutes on a canary estate, paging on-call if it fails.
- A public status page; per-estate health dashboards in Super Admin.
- Product analytics with a defined event list, so the success indicators in the brief can be reported from day one.

## Launch, pilot and operational readiness

Pilot with 2–3 estates of different shapes for 8 weeks after Phase 1, then open free sign-up to estates in Lagos and Abuja once the Phase 1 gate is passed. Adoption depends as much on the onboarding work at each estate as on the software.

**Pilot selection:** one gated estate of houses with one or two gates; one apartment complex with several buildings; ideally one with an active residents' association. Each needs a committed manager, a security supervisor willing to drop the paper book, and a written agreement covering data, support and feedback.

**Onboarding an estate (target: 10 working days):**

1. Kick-off with management: configuration, gates, charges, roles.
2. Data import from their spreadsheets; Safezone checks and fixes errors with them.
3. Guard training on site, on the actual gate devices, across every shift.
4. Resident launch: notice from management, flyers with QR codes at the gates, a help desk at the gate for the first week.
5. Two-week parallel run (paper book and app), then the paper book is retired.
6. Week-4 review against the pilot metrics.

**Go-live checklist for each estate:** gate devices registered and charged, with a backup power plan; guard PINs issued; emergency contacts and escalation set and tested in a drill; at least 60% of units with a registered resident; support contacts shared.

**Support model:** in-app help and a WhatsApp support line; first response within 1 hour for gate or SOS issues, 1 working day for everything else; a weekly call with each pilot estate.

**Pilot success metrics** (from the brief): share of visitors processed digitally; median gate verification time (target under 20 seconds); SOS acknowledgement time; resident onboarding completion; weekly active residents; crash-free sessions above 99.5%.

## Risks and mitigations

The biggest risk is scope: the PRD describes about five products' worth of work. The phase gates are the main protection; the other risks are below, most serious first.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope grows inside phases | Pilot slips past mid-2027 | Phase scope frozen at sprint 1; new asks go to the next phase unless they block a gate |
| SOS fails or is slow when it matters | Loss of life; loss of trust in the product | Parallel multi-channel fan-out, escalation, synthetic SOS every 15 minutes, drills at every estate, on-call paging |
| Guards fall back to the paper book | Visitor data incomplete; product seen as optional | Kiosk app designed with guards, offline mode, on-site training, management sets the date the book is retired |
| Poor connectivity and power at gates | Gate queues; offline gaps | Offline signed passes, SMS fallback, device power banks, sync queue |
| Cross-tenant data leak | Legal exposure; lost estates | Row-level security plus app-level checks, isolation test suite in CI, pen tests |
| Payment flow seen as holding funds | Regulatory problem | Split settlement to estates only; legal sign-off in Phase 0 |
| Low resident sign-up | Weak network effects; no ad audience | Visitor invites and dues payment as the first reasons to install; on-site launch drives |
| SMS and voice costs grow with use | Margins shrink | WhatsApp and push first, SMS for SOS and OTP; cost tracking per estate |
| Ads annoy residents or breach rules | Churn; regulatory fines | Managed ads only, ARCON approval captured, strict blocked screens, frequency caps, estate opt-outs |
| Key-person dependency on the tech lead | Delays | Architecture records, pairing, a second senior backend engineer by Phase 2 |
| No subscription revenue at launch | Hosting, SMS and support costs grow with every free estate before ads and transactions pay | Track cost per estate from day one; cap free SMS use; bring marketplace and ads forward if costs outpace revenue; keep entitlements ready for premium plans |

## Next 30 days

By mid-December 2026, the decisions marked Phase 0 should be closed and the foundation work started.

- [ ] Review this plan with stakeholders; confirm or change the defaults for decisions 1, 5, 9, 13 and 29.
- [ ] Update the PRD to v0.3 with the gaps section.
- [ ] Confirm the team and hiring plan; start hiring for any open roles.
- [ ] Approach 4–5 candidate pilot estates; aim for 2–3 letters of intent.
- [ ] Brief counsel on payments (split settlement), NDPA (DPO, DPIA, data processing agreements) and ARCON.
- [ ] Run gate and SOS field research: observe two estate gates across a morning peak, interview guards and residents.
- [ ] Write architecture decision records for tenancy, authorisation, events, offline passes and hosting region.
- [ ] Set up the monorepo, CI/CD, Terraform and environments.
- [ ] Open sandbox accounts with the shortlisted payment, SMS, WhatsApp, voice and identity-check providers.
- [ ] Start the design system and the prototypes of the visitor, gate and SOS flows.

## Sources

- Safezone Product Brief v0.2 and PRD v0.2 (Techguard, 13 Nov 2026)
- [GAID 2025: what Nigerian businesses need to know](https://legalbytes.substack.com/p/gaid-2025-what-nigerian-businesses) — DPO and NDPC registration duties
- [Review of ARCON's 2023 Vetting Guidelines](https://webiis10.mondaq.com/nigeria/social-media/1693212/a-review-of-the-advertising-regulatory-council-of-nigerias-arcon-2023-vetting-guidelines) — pre-approval of online and offline ads
