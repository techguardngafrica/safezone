-- Payments (payments.md, Phase 2; ADR-0013): payout subaccounts, virtual accounts, intents, verified
-- transactions, manual payments, refunds, webhook log and provider routing.
-- CreateTable
CREATE TABLE "tenant"."payout_accounts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subaccount_code" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."virtual_accounts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."payment_intents" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "purpose_ids" UUID[],
    "payer_user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "authorization_url" TEXT,
    "subaccount_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "idempotency_key" TEXT NOT NULL,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."payment_transactions" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "intent_id" UUID,
    "virtual_account_id" UUID,
    "payer_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fees" BIGINT NOT NULL DEFAULT 0,
    "amount_refunded" BIGINT NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."manual_payments" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "space_id" UUID,
    "amount" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" TEXT,
    "evidence_file_id" UUID,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recorded_by" UUID NOT NULL,
    "decided_by" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."refunds" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decision_reason" TEXT,
    "provider_ref" TEXT,
    "journal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."payment_routes" (
    "provider" TEXT NOT NULL,
    "route_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "estate_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_routes_pkey" PRIMARY KEY ("provider","route_key")
);

-- CreateTable
CREATE TABLE "platform"."payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT,
    "customer_code" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "result" TEXT,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_accounts_estate_id_provider_status_idx" ON "tenant"."payout_accounts"("estate_id", "provider", "status");

-- CreateIndex
CREATE INDEX "virtual_accounts_estate_id_payer_user_id_status_idx" ON "tenant"."virtual_accounts"("estate_id", "payer_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_provider_customer_code_key" ON "tenant"."virtual_accounts"("provider", "customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "tenant"."payment_intents"("reference");

-- CreateIndex
CREATE INDEX "payment_intents_estate_id_payer_user_id_created_at_idx" ON "tenant"."payment_intents"("estate_id", "payer_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_estate_id_payer_user_id_idempotency_key_key" ON "tenant"."payment_intents"("estate_id", "payer_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_transactions_estate_id_payer_user_id_paid_at_idx" ON "tenant"."payment_transactions"("estate_id", "payer_user_id", "paid_at");

-- CreateIndex
CREATE INDEX "payment_transactions_estate_id_paid_at_idx" ON "tenant"."payment_transactions"("estate_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_provider_transaction_id_key" ON "tenant"."payment_transactions"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "manual_payments_estate_id_status_idx" ON "tenant"."manual_payments"("estate_id", "status");

-- CreateIndex
CREATE INDEX "refunds_estate_id_status_idx" ON "tenant"."refunds"("estate_id", "status");

-- CreateIndex
CREATE INDEX "refunds_transaction_id_idx" ON "tenant"."refunds"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "platform"."payment_webhook_events"("provider", "event_id");



-- Hand-written: grants, row-level security, checks and append-only rules.
GRANT SELECT, INSERT, UPDATE ON "tenant"."payout_accounts" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."virtual_accounts" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."payment_intents" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."payment_transactions" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."manual_payments" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."refunds" TO safezone_app;
GRANT SELECT, INSERT ON "platform"."payment_routes" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."payment_webhook_events" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payout_accounts','virtual_accounts','payment_intents','payment_transactions',
                           'manual_payments','refunds'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['payment_routes','payment_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'payments')
      WITH CHECK (current_setting('app.context', true) = 'payments')$p$, t || '_module', t);
  END LOOP;
END $$;

ALTER TABLE "tenant"."payout_accounts" ADD CONSTRAINT payout_accounts_last4_check
  CHECK (account_last4 ~ '^[0-9]{4}$');
CREATE UNIQUE INDEX payout_accounts_one_active ON "tenant"."payout_accounts" (estate_id, provider)
  WHERE status = 'active';
CREATE UNIQUE INDEX virtual_accounts_one_active ON "tenant"."virtual_accounts" (estate_id, space_id, payer_user_id, provider)
  WHERE status = 'active';
ALTER TABLE "tenant"."payment_intents" ADD CONSTRAINT payment_intents_amount_check
  CHECK (amount > 0 AND currency = 'NGN');
ALTER TABLE "tenant"."payment_transactions" ADD CONSTRAINT payment_transactions_amount_check
  CHECK (amount > 0 AND fees >= 0 AND amount_refunded >= 0 AND amount_refunded <= amount);
ALTER TABLE "tenant"."manual_payments" ADD CONSTRAINT manual_payments_amount_check CHECK (amount > 0);
ALTER TABLE "tenant"."refunds" ADD CONSTRAINT refunds_amount_check CHECK (amount > 0);

-- Verified transactions are evidence: only the refunded total may change, and only upwards.
CREATE FUNCTION tenant.payment_transactions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment transactions are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.estate_id, NEW.intent_id, NEW.virtual_account_id, NEW.payer_user_id, NEW.provider,
      NEW.provider_transaction_id, NEW.reference, NEW.channel, NEW.amount, NEW.fees, NEW.paid_at)
     IS DISTINCT FROM
     (OLD.estate_id, OLD.intent_id, OLD.virtual_account_id, OLD.payer_user_id, OLD.provider,
      OLD.provider_transaction_id, OLD.reference, OLD.channel, OLD.amount, OLD.fees, OLD.paid_at)
     OR NEW.amount_refunded < OLD.amount_refunded THEN
    RAISE EXCEPTION 'payment transactions are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_transactions_guard BEFORE UPDATE OR DELETE ON "tenant"."payment_transactions"
  FOR EACH ROW EXECUTE FUNCTION tenant.payment_transactions_guard();
