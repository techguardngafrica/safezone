-- Safezone Pay (ADR-0025): saved cards, resident payout accounts, transfers, airtime and data.
-- CreateTable
CREATE TABLE "platform"."payment_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "authorization_wrapped" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" TEXT NOT NULL,
    "exp_year" TEXT NOT NULL,
    "bank" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."user_payout_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subaccount_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "accept_transfers" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."transfers" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "recipient_subaccount_code" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "classified_id" UUID,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "authorization_url" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."topup_purchases" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "variation_code" TEXT,
    "plan_name" TEXT,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "payment_reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "authorization_url" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topup_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_methods_user_id_removed_at_idx" ON "platform"."payment_methods"("user_id", "removed_at");

-- CreateIndex
CREATE INDEX "user_payout_accounts_user_id_status_idx" ON "platform"."user_payout_accounts"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reference_key" ON "tenant"."transfers"("reference");

-- CreateIndex
CREATE INDEX "transfers_estate_id_sender_user_id_created_at_idx" ON "tenant"."transfers"("estate_id", "sender_user_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_estate_id_recipient_user_id_created_at_idx" ON "tenant"."transfers"("estate_id", "recipient_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_estate_id_sender_user_id_idempotency_key_key" ON "tenant"."transfers"("estate_id", "sender_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "topup_purchases_payment_reference_key" ON "tenant"."topup_purchases"("payment_reference");

-- CreateIndex
CREATE INDEX "topup_purchases_estate_id_user_id_created_at_idx" ON "tenant"."topup_purchases"("estate_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "topup_purchases_status_paid_at_idx" ON "tenant"."topup_purchases"("status", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "topup_purchases_estate_id_user_id_idempotency_key_key" ON "tenant"."topup_purchases"("estate_id", "user_id", "idempotency_key");


-- Hand-written: grants, row-level security and checks (ADR-0025).
-- Personal platform tables: the owner (app.user_id) or the payments context (webhooks, verification).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_methods','user_payout_accounts'] LOOP
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid
             OR current_setting('app.context', true) = 'payments')
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid
             OR current_setting('app.context', true) = 'payments')$p$, t || '_owner', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['transfers','topup_purchases'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON "platform"."payment_methods", "platform"."user_payout_accounts",
  "tenant"."transfers", "tenant"."topup_purchases" TO safezone_app;

CREATE UNIQUE INDEX payment_methods_card_key ON "platform"."payment_methods" (user_id, provider, signature) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX user_payout_accounts_active_key ON "platform"."user_payout_accounts" (user_id) WHERE status = 'active';
ALTER TABLE "platform"."user_payout_accounts" ADD CONSTRAINT user_payout_accounts_status_check CHECK (status IN ('active','disabled'));
ALTER TABLE "tenant"."transfers" ADD CONSTRAINT transfers_check
  CHECK (status IN ('created','paid','failed') AND amount > 0 AND sender_user_id <> recipient_user_id);
ALTER TABLE "tenant"."topup_purchases" ADD CONSTRAINT topup_purchases_check
  CHECK (kind IN ('airtime','data') AND network IN ('mtn','glo','airtel','9mobile')
         AND status IN ('created','paid','delivering','delivered','failed','refund_pending','refunded')
         AND amount > 0 AND fee >= 0 AND total = amount + fee
         AND (kind = 'airtime' OR variation_code IS NOT NULL));
