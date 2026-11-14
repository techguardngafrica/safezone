-- Ownerships and transfers (property.md, Phase 2; ADR-0014); owner-billed charges in billing runs.
-- DropIndex
DROP INDEX "tenant"."invoices_billing_run_id_space_id_key";

-- AlterTable
ALTER TABLE "tenant"."billing_run_items" ADD COLUMN     "payer_type" TEXT NOT NULL DEFAULT 'occupant';

-- CreateTable
CREATE TABLE "tenant"."ownerships" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "owner_name" TEXT NOT NULL,
    "owner_company_name" TEXT,
    "share_bp" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "evidence_file_ids" UUID[],
    "transfer_id" UUID,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,

    CONSTRAINT "ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."ownership_transfers" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "effective_on" DATE NOT NULL,
    "from_ownership_ids" UUID[],
    "to_owners" JSONB NOT NULL,
    "document_file_ids" UUID[],
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requested_by" UUID NOT NULL,
    "seller_confirmed_by" UUID,
    "manager_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "decided_by" UUID,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownerships_estate_id_space_id_status_idx" ON "tenant"."ownerships"("estate_id", "space_id", "status");

-- CreateIndex
CREATE INDEX "ownerships_estate_id_owner_user_id_status_idx" ON "tenant"."ownerships"("estate_id", "owner_user_id", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_estate_id_status_idx" ON "tenant"."ownership_transfers"("estate_id", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_estate_id_space_id_idx" ON "tenant"."ownership_transfers"("estate_id", "space_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_billing_run_id_space_id_payer_type_key" ON "tenant"."invoices"("billing_run_id", "space_id", "payer_type");


-- Hand-written: grants, row-level security and share rules.
GRANT SELECT, INSERT, UPDATE ON "tenant"."ownerships" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."ownership_transfers" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ownerships','ownership_transfers'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "tenant"."ownerships" ADD CONSTRAINT ownerships_share_check CHECK (share_bp BETWEEN 1 AND 10000);
ALTER TABLE "tenant"."ownerships" ADD CONSTRAINT ownerships_type_check CHECK (
  (owner_type = 'person' AND owner_company_name IS NULL) OR (owner_type = 'company' AND owner_company_name IS NOT NULL));
CREATE UNIQUE INDEX ownerships_one_active_per_owner ON "tenant"."ownerships" (space_id, owner_user_id)
  WHERE status = 'active';

-- Active shares of a unit never exceed 100% (property.md rule 3), checked at commit so a transfer can
-- end old ownerships and create new ones in any order.
CREATE FUNCTION tenant.ownership_shares_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total int;
BEGIN
  SELECT coalesce(sum(share_bp), 0) INTO total FROM "tenant"."ownerships"
   WHERE space_id = NEW.space_id AND status = 'active';
  IF total > 10000 THEN
    RAISE EXCEPTION 'active ownership shares exceed 100%% for unit %', NEW.space_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ownerships_shares_valid AFTER INSERT OR UPDATE ON "tenant"."ownerships"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tenant.ownership_shares_valid();
CREATE TRIGGER ownerships_no_delete BEFORE DELETE ON "tenant"."ownerships"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
