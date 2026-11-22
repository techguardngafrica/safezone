-- Managed advertising (advertising.md, Phase 4; ADR-0024).
-- CreateTable
CREATE TABLE "platform"."ad_enquiries" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "user_id" UUID,
    "advertiser_type" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "org_name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget_range" TEXT NOT NULL,
    "duration_weeks" INTEGER,
    "audience" TEXT,
    "placements" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "notes" TEXT,
    "assignee_id" UUID,
    "advertiser_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."advertisers" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspended_reason" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."advertiser_members" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "added_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "advertiser_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_placements" (
    "key" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "formats" TEXT[],
    "width" INTEGER,
    "height" INTEGER,
    "max_file_kb" INTEGER NOT NULL,
    "frequency_cap_per_day" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."ad_campaigns" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "enquiry_id" UUID,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "budget" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "arcon_approval_ref" TEXT,
    "arcon_approval_file_id" UUID,
    "restricted_note" TEXT,
    "rejection_reason" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "credit_approved_by" UUID,
    "credit_approved_at" TIMESTAMPTZ(3),
    "credit_note" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_campaign_events" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_campaign_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_line_items" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "placement_key" TEXT NOT NULL,
    "targeting" JSONB NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "frequency_cap_per_day" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_creatives" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "image_file_id" UUID,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "cta" TEXT NOT NULL,
    "destination_url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "review_notes" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supersedes_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_invoices" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "vat" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "payment_reference" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_impressions" (
    "id" UUID NOT NULL,
    "token_id" TEXT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "creative_id" UUID NOT NULL,
    "placement_key" TEXT NOT NULL,
    "estate_id" UUID NOT NULL,
    "user_hash" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."ad_clicks" (
    "id" UUID NOT NULL,
    "token_id" TEXT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "creative_id" UUID NOT NULL,
    "placement_key" TEXT NOT NULL,
    "estate_id" UUID NOT NULL,
    "user_hash" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_enquiries_status_created_at_idx" ON "platform"."ad_enquiries"("status", "created_at");

-- CreateIndex
CREATE INDEX "ad_enquiries_user_id_created_at_idx" ON "platform"."ad_enquiries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "advertisers_status_created_at_idx" ON "platform"."advertisers"("status", "created_at");

-- CreateIndex
CREATE INDEX "advertiser_members_user_id_removed_at_idx" ON "platform"."advertiser_members"("user_id", "removed_at");

-- CreateIndex
CREATE INDEX "advertiser_members_advertiser_id_removed_at_idx" ON "platform"."advertiser_members"("advertiser_id", "removed_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_status_starts_at_idx" ON "platform"."ad_campaigns"("status", "starts_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_advertiser_id_created_at_idx" ON "platform"."ad_campaigns"("advertiser_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_campaign_events_campaign_id_created_at_idx" ON "platform"."ad_campaign_events"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_line_items_placement_key_idx" ON "platform"."ad_line_items"("placement_key");

-- CreateIndex
CREATE INDEX "ad_line_items_campaign_id_idx" ON "platform"."ad_line_items"("campaign_id");

-- CreateIndex
CREATE INDEX "ad_creatives_campaign_id_active_idx" ON "platform"."ad_creatives"("campaign_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ad_invoices_number_key" ON "platform"."ad_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ad_invoices_payment_reference_key" ON "platform"."ad_invoices"("payment_reference");

-- CreateIndex
CREATE INDEX "ad_invoices_campaign_id_idx" ON "platform"."ad_invoices"("campaign_id");

-- CreateIndex
CREATE INDEX "ad_invoices_advertiser_id_created_at_idx" ON "platform"."ad_invoices"("advertiser_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ad_impressions_token_id_key" ON "platform"."ad_impressions"("token_id");

-- CreateIndex
CREATE INDEX "ad_impressions_campaign_id_at_idx" ON "platform"."ad_impressions"("campaign_id", "at");

-- CreateIndex
CREATE INDEX "ad_clicks_campaign_id_at_idx" ON "platform"."ad_clicks"("campaign_id", "at");

-- CreateIndex
CREATE INDEX "ad_clicks_token_id_idx" ON "platform"."ad_clicks"("token_id");


-- Hand-written: grants, row-level security, checks, sequence and seed data (ADR-0024).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_enquiries','advertisers','advertiser_members','ad_placements','ad_campaigns','ad_campaign_events','ad_line_items','ad_creatives','ad_invoices','ad_impressions','ad_clicks'] LOOP
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'advertising')
      WITH CHECK (current_setting('app.context', true) = 'advertising')$p$, t || '_advertising', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON "platform"."ad_enquiries", "platform"."advertisers", "platform"."advertiser_members",
  "platform"."ad_placements", "platform"."ad_campaigns", "platform"."ad_creatives", "platform"."ad_invoices" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "platform"."ad_line_items" TO safezone_app;
-- Append-only.
GRANT SELECT, INSERT ON "platform"."ad_campaign_events", "platform"."ad_impressions", "platform"."ad_clicks" TO safezone_app;

CREATE SEQUENCE "platform"."ad_invoice_number_seq";
GRANT USAGE ON SEQUENCE "platform"."ad_invoice_number_seq" TO safezone_app;

CREATE UNIQUE INDEX advertiser_members_active_key ON "platform"."advertiser_members" (advertiser_id, user_id) WHERE removed_at IS NULL;

ALTER TABLE "platform"."ad_enquiries" ADD CONSTRAINT ad_enquiries_check
  CHECK (source IN ('web','resident_app') AND advertiser_type IN ('individual','organisation')
         AND status IN ('submitted','under_review','awaiting_information','proposal_sent','negotiation','approved','rejected','converted_to_campaign'));
ALTER TABLE "platform"."advertisers" ADD CONSTRAINT advertisers_check
  CHECK (type IN ('individual','organisation') AND verification_status IN ('unverified','verified','rejected')
         AND status IN ('active','suspended'));
ALTER TABLE "platform"."advertiser_members" ADD CONSTRAINT advertiser_members_role_check
  CHECK (role IN ('advertiser','advertiser_organisation_owner','advertiser_account_manager','advertising_agency_representative'));
ALTER TABLE "platform"."ad_campaigns" ADD CONSTRAINT ad_campaigns_check
  CHECK (status IN ('draft','submitted','under_review','awaiting_payment','approved','scheduled','active','paused','completed','rejected','cancelled')
         AND ends_at > starts_at AND budget > 0);
-- advertising.md rule 4: nothing goes live without an ARCON approval reference.
ALTER TABLE "platform"."ad_campaigns" ADD CONSTRAINT ad_campaigns_arcon_check
  CHECK (status NOT IN ('approved','scheduled','active','paused','completed') OR arcon_approval_ref IS NOT NULL);
ALTER TABLE "platform"."ad_line_items" ADD CONSTRAINT ad_line_items_check
  CHECK (weight BETWEEN 1 AND 100 AND (frequency_cap_per_day IS NULL OR frequency_cap_per_day BETWEEN 1 AND 50));
ALTER TABLE "platform"."ad_creatives" ADD CONSTRAINT ad_creatives_check
  CHECK (type IN ('image_banner','sponsored_text','sponsored_post','promo_card')
         AND review_status IN ('pending','approved','rejected','revision_requested')
         AND destination_url LIKE 'https://%');
ALTER TABLE "platform"."ad_invoices" ADD CONSTRAINT ad_invoices_check
  CHECK (status IN ('issued','paid','void') AND amount > 0 AND vat >= 0 AND total = amount + vat);

-- Placements inventory (advertising.md §3). The management dashboard card stays off unless an estate enables it.
INSERT INTO "platform"."ad_placements" ("key", "surface", "formats", "width", "height", "max_file_kb", "frequency_cap_per_day", "active") VALUES
  ('resident.home.banner', 'Resident App home', ARRAY['image_banner','promo_card'], 1200, 400, 300, 3, true),
  ('resident.feed.sponsored', 'Community feed', ARRAY['sponsored_post','sponsored_text'], 1200, 630, 300, 2, true),
  ('resident.marketplace.banner', 'Marketplace home', ARRAY['image_banner'], 1200, 400, 300, 3, true),
  ('resident.discovery.sponsored', 'Service discovery', ARRAY['promo_card','sponsored_text'], 600, 600, 200, 3, true),
  ('management.dashboard.info', 'Management web dashboard', ARRAY['sponsored_text','promo_card'], 600, 300, 200, 2, true);

-- Ad invoices are paid on Safezone's own account and belong to no estate (ADR-0024).
ALTER TABLE "platform"."payment_routes" ALTER COLUMN "estate_id" DROP NOT NULL;
ALTER TABLE "platform"."payment_routes" ADD CONSTRAINT payment_routes_estate_check
  CHECK (estate_id IS NOT NULL OR kind = 'ad_invoice');
