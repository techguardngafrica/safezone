-- Phase 5: Security Operations Depth (security.md Phase 5, ADR-0026).
-- Cross-estate security companies (platform) and QR/NFC patrol routes & logs (tenant).

CREATE TABLE "platform"."security_companies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "registration_number" TEXT,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform"."security_company_guards" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "badge_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_company_guards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform"."estate_security_contracts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_security_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."patrol_routes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patrol_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."patrol_checkpoints" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "space_id" UUID,
    "tag_type" TEXT NOT NULL DEFAULT 'qr',
    "tag_code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "patrol_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."patrol_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "guard_user_id" UUID NOT NULL,
    "device_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'in_progress',

    CONSTRAINT "patrol_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."patrol_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "checkpoint_id" UUID NOT NULL,
    "guard_user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offline_recorded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "photo_file_id" UUID,

    CONSTRAINT "patrol_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "security_company_guards_company_id_user_id_key" ON "platform"."security_company_guards"("company_id", "user_id");
CREATE INDEX "estate_security_contracts_estate_id_status_idx" ON "platform"."estate_security_contracts"("estate_id", "status");
CREATE UNIQUE INDEX "patrol_checkpoints_estate_id_tag_code_key" ON "tenant"."patrol_checkpoints"("estate_id", "tag_code");
CREATE INDEX "patrol_runs_estate_id_started_at_idx" ON "tenant"."patrol_runs"("estate_id", "started_at");
CREATE UNIQUE INDEX "patrol_logs_run_id_checkpoint_id_key" ON "tenant"."patrol_logs"("run_id", "checkpoint_id");

ALTER TABLE "platform"."security_company_guards" ADD CONSTRAINT "security_company_guards_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "platform"."security_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform"."estate_security_contracts" ADD CONSTRAINT "estate_security_contracts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "platform"."security_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."patrol_checkpoints" ADD CONSTRAINT "patrol_checkpoints_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "tenant"."patrol_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."patrol_runs" ADD CONSTRAINT "patrol_runs_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "tenant"."patrol_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."patrol_logs" ADD CONSTRAINT "patrol_logs_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "tenant"."patrol_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."patrol_logs" ADD CONSTRAINT "patrol_logs_checkpoint_id_fkey"
  FOREIGN KEY ("checkpoint_id") REFERENCES "tenant"."patrol_checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Platform tables behind security_companies context
GRANT SELECT, INSERT, UPDATE ON "platform"."security_companies", "platform"."security_company_guards",
  "platform"."estate_security_contracts" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['security_companies','security_company_guards','estate_security_contracts'] LOOP
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'security_companies')
      WITH CHECK (current_setting('app.context', true) = 'security_companies')$p$, t || '_ctx', t);
  END LOOP;
END $$;

-- Tenant patrol tables with RLS
GRANT SELECT, INSERT, UPDATE ON "tenant"."patrol_routes", "tenant"."patrol_checkpoints", "tenant"."patrol_runs" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."patrol_logs" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patrol_routes','patrol_checkpoints','patrol_runs','patrol_logs'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

CREATE TRIGGER patrol_logs_append_only BEFORE UPDATE OR DELETE ON "tenant"."patrol_logs"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

ALTER TABLE "platform"."security_companies" ADD CONSTRAINT security_companies_status_check
  CHECK (status IN ('active','suspended'));
ALTER TABLE "platform"."security_company_guards" ADD CONSTRAINT security_company_guards_status_check
  CHECK (status IN ('active','inactive'));
ALTER TABLE "platform"."estate_security_contracts" ADD CONSTRAINT estate_security_contracts_status_check
  CHECK (status IN ('pending','active','terminated'));
ALTER TABLE "tenant"."patrol_checkpoints" ADD CONSTRAINT patrol_checkpoints_tag_check
  CHECK (tag_type IN ('qr','nfc'));
ALTER TABLE "tenant"."patrol_runs" ADD CONSTRAINT patrol_runs_status_check
  CHECK (status IN ('in_progress','completed','incomplete'));
