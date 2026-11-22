-- Marketplace, vendors and estate classifieds (marketplace.md, Phase 4; ADR-0023).
-- CreateTable
CREATE TABLE "platform"."service_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verification_tier" TEXT NOT NULL,
    "cac_number" TEXT,
    "description" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "logo_file_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "category_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'applied',
    "rejection_reason" TEXT,
    "suspended_reason" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "payout_provider" TEXT,
    "payout_subaccount_code" TEXT,
    "payout_bank_name" TEXT,
    "payout_account_last4" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."vendor_members" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "added_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by" UUID,

    CONSTRAINT "vendor_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."vendor_documents" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "expires_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."vendor_service_areas" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "state" TEXT,
    "lga" TEXT,
    "estate_id" UUID,

    CONSTRAINT "vendor_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."listings" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photo_file_ids" UUID[],
    "price_type" TEXT NOT NULL,
    "price" BIGINT,
    "duration_minutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."commission_rules" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" UUID,
    "bps" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."estate_vendor_approvals" (
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_vendor_approvals_pkey" PRIMARY KEY ("estate_id","vendor_id")
);

-- CreateTable
CREATE TABLE "tenant"."marketplace_orders" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "resident_user_id" UUID NOT NULL,
    "space_id" UUID,
    "details" TEXT NOT NULL,
    "preferred_at" TIMESTAMPTZ(3),
    "scheduled_at" TIMESTAMPTZ(3),
    "quote_amount" BIGINT,
    "amount" BIGINT,
    "commission_bps" INTEGER,
    "commission_amount" BIGINT,
    "vendor_amount" BIGINT,
    "payment_reference" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "assigned_member_id" UUID,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."marketplace_order_events" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."marketplace_order_messages" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "author_kind" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_order_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."marketplace_reviews" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "vendor_response" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'visible',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."marketplace_disputes" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "opened_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_file_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "refund_amount" BIGINT,
    "note" TEXT,
    "handled_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "marketplace_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."classified_listings" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "seller_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" BIGINT,
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "photo_file_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "hidden_reason" TEXT,
    "hidden_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."classified_messages" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "platform"."service_categories"("slug");

-- CreateIndex
CREATE INDEX "vendors_status_created_at_idx" ON "platform"."vendors"("status", "created_at");

-- CreateIndex
CREATE INDEX "vendors_owner_user_id_idx" ON "platform"."vendors"("owner_user_id");

-- CreateIndex
CREATE INDEX "vendor_members_user_id_removed_at_idx" ON "platform"."vendor_members"("user_id", "removed_at");

-- CreateIndex
CREATE INDEX "vendor_members_vendor_id_removed_at_idx" ON "platform"."vendor_members"("vendor_id", "removed_at");

-- CreateIndex
CREATE INDEX "vendor_documents_vendor_id_idx" ON "platform"."vendor_documents"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_service_areas_vendor_id_idx" ON "platform"."vendor_service_areas"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_service_areas_estate_id_idx" ON "platform"."vendor_service_areas"("estate_id");

-- CreateIndex
CREATE INDEX "vendor_service_areas_state_idx" ON "platform"."vendor_service_areas"("state");

-- CreateIndex
CREATE INDEX "listings_vendor_id_status_idx" ON "platform"."listings"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "listings_category_id_status_idx" ON "platform"."listings"("category_id", "status");

-- CreateIndex
CREATE INDEX "commission_rules_scope_scope_id_valid_from_idx" ON "platform"."commission_rules"("scope", "scope_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_payment_reference_key" ON "tenant"."marketplace_orders"("payment_reference");

-- CreateIndex
CREATE INDEX "marketplace_orders_estate_id_resident_user_id_created_at_idx" ON "tenant"."marketplace_orders"("estate_id", "resident_user_id", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_orders_vendor_id_status_created_at_idx" ON "tenant"."marketplace_orders"("vendor_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_order_events_order_id_created_at_idx" ON "tenant"."marketplace_order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_order_messages_order_id_created_at_idx" ON "tenant"."marketplace_order_messages"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reviews_order_id_key" ON "tenant"."marketplace_reviews"("order_id");

-- CreateIndex
CREATE INDEX "marketplace_reviews_vendor_id_created_at_idx" ON "tenant"."marketplace_reviews"("vendor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_disputes_order_id_key" ON "tenant"."marketplace_disputes"("order_id");

-- CreateIndex
CREATE INDEX "marketplace_disputes_status_created_at_idx" ON "tenant"."marketplace_disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "classified_listings_estate_id_status_created_at_idx" ON "tenant"."classified_listings"("estate_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "classified_listings_estate_id_seller_user_id_status_idx" ON "tenant"."classified_listings"("estate_id", "seller_user_id", "status");

-- CreateIndex
CREATE INDEX "classified_messages_listing_id_buyer_user_id_created_at_idx" ON "tenant"."classified_messages"("listing_id", "buyer_user_id", "created_at");


-- Hand-written: grants, row-level security, checks and seed data (ADR-0023).

-- Platform tables: the marketplace context only (vendors, catalogue, commission). marketplace_admin is
-- the Techguard dispute desk, which also reads vendors.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_categories','vendors','vendor_members','vendor_documents','vendor_service_areas','listings','commission_rules'] LOOP
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) IN ('marketplace', 'marketplace_admin'))
      WITH CHECK (current_setting('app.context', true) IN ('marketplace', 'marketplace_admin'))$p$, t || '_marketplace', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON "platform"."service_categories", "platform"."vendors", "platform"."vendor_members",
  "platform"."vendor_documents", "platform"."listings" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "platform"."vendor_service_areas" TO safezone_app;
-- Append-only: a new rule supersedes the old one from its valid_from.
GRANT SELECT, INSERT ON "platform"."commission_rules" TO safezone_app;

-- Tenant tables: the estate's own rows (RLS on estate_id).
GRANT SELECT, INSERT, UPDATE ON "tenant"."estate_vendor_approvals" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."marketplace_orders" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."marketplace_order_events" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."marketplace_order_messages" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."marketplace_reviews" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."marketplace_disputes" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."classified_listings" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."classified_messages" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estate_vendor_approvals','marketplace_orders','marketplace_order_events','marketplace_order_messages','marketplace_reviews','marketplace_disputes','classified_listings','classified_messages'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
  -- A vendor works on its own orders across estates: marketplace context with app.vendor_id set.
  FOREACH t IN ARRAY ARRAY['marketplace_orders','marketplace_order_events','marketplace_order_messages','marketplace_reviews','marketplace_disputes'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'marketplace'
             AND vendor_id = nullif(current_setting('app.vendor_id', true), '')::uuid)
      WITH CHECK (current_setting('app.context', true) = 'marketplace'
             AND vendor_id = nullif(current_setting('app.vendor_id', true), '')::uuid)$p$, t || '_vendor', t);
  END LOOP;
  -- The Techguard dispute desk (/v1/platform, vendor.approve) resolves disputes across estates.
  FOREACH t IN ARRAY ARRAY['marketplace_orders','marketplace_order_events','marketplace_disputes'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'marketplace_admin')
      WITH CHECK (current_setting('app.context', true) = 'marketplace_admin')$p$, t || '_dispute_desk', t);
  END LOOP;
END $$;

ALTER TABLE "platform"."service_categories" ADD CONSTRAINT service_categories_kind_check CHECK (kind IN ('service','goods'));
ALTER TABLE "platform"."vendors" ADD CONSTRAINT vendors_type_check CHECK (type IN ('individual','company'));
ALTER TABLE "platform"."vendors" ADD CONSTRAINT vendors_tier_check CHECK (verification_tier IN ('individual','business'));
ALTER TABLE "platform"."vendors" ADD CONSTRAINT vendors_status_check
  CHECK (status IN ('applied','under_review','approved','rejected','suspended'));
ALTER TABLE "platform"."vendors" ADD CONSTRAINT vendors_rating_check CHECK (rating_sum >= 0 AND rating_count >= 0);
ALTER TABLE "platform"."vendor_members" ADD CONSTRAINT vendor_members_role_check
  CHECK (role IN ('vendor_owner','vendor_administrator','vendor_employee','vendor_service_personnel'));
CREATE UNIQUE INDEX vendor_members_active_key ON "platform"."vendor_members" (vendor_id, user_id) WHERE removed_at IS NULL;
ALTER TABLE "platform"."listings" ADD CONSTRAINT listings_check
  CHECK (price_type IN ('fixed','from','quote') AND status IN ('draft','active','paused','archived')
         AND (price IS NULL OR price > 0) AND (price_type = 'quote' OR price IS NOT NULL));
ALTER TABLE "platform"."commission_rules" ADD CONSTRAINT commission_rules_check
  CHECK (scope IN ('default','category','vendor') AND bps BETWEEN 0 AND 3000
         AND ((scope = 'default') = (scope_id IS NULL)));
ALTER TABLE "tenant"."estate_vendor_approvals" ADD CONSTRAINT estate_vendor_approvals_status_check
  CHECK (status IN ('approved','blocked'));
ALTER TABLE "tenant"."marketplace_orders" ADD CONSTRAINT marketplace_orders_status_check
  CHECK (status IN ('requested','quoted','accepted','scheduled','in_progress','completed','reviewed',
                    'declined','cancelled_by_resident','cancelled_by_vendor','disputed','refunded'));
ALTER TABLE "tenant"."marketplace_orders" ADD CONSTRAINT marketplace_orders_money_check
  CHECK ((quote_amount IS NULL OR quote_amount > 0) AND (amount IS NULL OR amount > 0)
         AND (commission_amount IS NULL OR (commission_amount >= 0 AND vendor_amount >= 0
              AND commission_amount + vendor_amount = amount))
         AND refunded_amount >= 0 AND refunded_amount <= coalesce(amount, 0));
ALTER TABLE "tenant"."marketplace_order_events" ADD CONSTRAINT marketplace_order_events_actor_check
  CHECK (actor_kind IN ('resident','vendor','platform','system'));
ALTER TABLE "tenant"."marketplace_order_messages" ADD CONSTRAINT marketplace_order_messages_author_check
  CHECK (author_kind IN ('resident','vendor'));
ALTER TABLE "tenant"."marketplace_reviews" ADD CONSTRAINT marketplace_reviews_check
  CHECK (rating BETWEEN 1 AND 5 AND status IN ('visible','hidden_by_moderation'));
ALTER TABLE "tenant"."marketplace_disputes" ADD CONSTRAINT marketplace_disputes_check
  CHECK (status IN ('open','resolved') AND (resolution IS NULL OR resolution IN ('refund','partial_refund','no_action'))
         AND (refund_amount IS NULL OR refund_amount > 0));
ALTER TABLE "tenant"."classified_listings" ADD CONSTRAINT classified_listings_check
  CHECK (kind IN ('item','service') AND status IN ('active','sold','withdrawn','hidden','expired')
         AND (price IS NULL OR price > 0)
         AND (condition IS NULL OR condition IN ('new','like_new','good','fair')));

-- Every estate gets the marketplace on the free core plan.
UPDATE "platform"."plans" SET features = array_append(features, 'marketplace')
 WHERE key = 'core' AND NOT ('marketplace' = ANY(features));

-- Platform taxonomy (Techguard can add more) and a 0% default commission until the product owner sets one.
INSERT INTO "platform"."service_categories" ("id", "slug", "name", "kind", "sort_order") VALUES
  ('01a202e9-b380-7345-bc68-f0a24d3e5721', 'plumbing', 'Plumbing', 'service', 0),
  ('01a202e9-b381-78ba-a798-a2305178f59c', 'electrical', 'Electrical repairs', 'service', 10),
  ('01a202e9-b382-77ee-b0e2-298349a7808e', 'generator-repair', 'Generator repair and servicing', 'service', 20),
  ('01a202e9-b383-7347-a8fa-8f12867d57c6', 'ac-repair', 'Air conditioner repair', 'service', 30),
  ('01a202e9-b384-7f1c-8ff7-bf18e634d6ea', 'cleaning', 'Home cleaning', 'service', 40),
  ('01a202e9-b385-7938-b476-c6d7029c4a30', 'laundry', 'Laundry and dry cleaning', 'service', 50),
  ('01a202e9-b386-726d-8070-c641fb6a125a', 'painting', 'Painting', 'service', 60),
  ('01a202e9-b387-74fe-ab06-b1002aeeda11', 'carpentry', 'Carpentry and furniture repair', 'service', 70),
  ('01a202e9-b388-7d19-a9eb-ca17513145ec', 'pest-control', 'Pest control', 'service', 80),
  ('01a202e9-b389-7ffe-bebd-3fed7d29fc50', 'appliance-repair', 'Appliance repair', 'service', 90),
  ('01a202e9-b38a-7a05-b896-0d9f6352a150', 'solar-inverter', 'Solar and inverter installation', 'service', 100),
  ('01a202e9-b38b-75fd-95c9-31ad4c0c5f1e', 'beauty-grooming', 'Beauty and grooming', 'service', 110),
  ('01a202e9-b38c-7824-af36-ea4fa18b48e5', 'tutoring', 'Home tutoring', 'service', 120),
  ('01a202e9-b38d-77a4-8f6c-9a92a22a9b9b', 'moving', 'Moving and haulage', 'service', 130),
  ('01a202e9-b38e-7c7c-9ace-6089acae3a5d', 'cooking-gas', 'Cooking gas refill', 'goods', 140),
  ('01a202e9-b38f-7685-8984-bff5ea2d3b04', 'drinking-water', 'Drinking water delivery', 'goods', 150),
  ('01a202e9-b390-7d10-951f-1fc82ab4b0c4', 'groceries', 'Groceries', 'goods', 160),
  ('01a202e9-b391-70e2-933f-9573ec1c1aa6', 'food', 'Food and catering', 'goods', 170);
INSERT INTO "platform"."commission_rules" ("id", "scope", "scope_id", "bps", "valid_from")
VALUES ('01a202e9-b3e4-7197-b8f2-b566432e1a95', 'default', NULL, 0, '2026-11-22T00:00:00Z');
