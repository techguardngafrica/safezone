-- Utilities (utilities.md, Phase 2; ADR-0014): meters, readings, outages.
-- CreateTable
CREATE TABLE "tenant"."meters" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "supply" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "meter_number" TEXT NOT NULL,
    "account_name" TEXT,
    "prepaid" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verified_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."meter_readings" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "meter_id" UUID NOT NULL,
    "reading" DOUBLE PRECISION NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."utility_outages" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "expected_end_at" TIMESTAMPTZ(3),
    "space_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'announced',
    "notified" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "utility_outages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meters_estate_id_space_id_status_idx" ON "tenant"."meters"("estate_id", "space_id", "status");

-- CreateIndex
CREATE INDEX "meter_readings_meter_id_read_at_idx" ON "tenant"."meter_readings"("meter_id", "read_at");

-- CreateIndex
CREATE INDEX "utility_outages_estate_id_status_starts_at_idx" ON "tenant"."utility_outages"("estate_id", "status", "starts_at");

-- AddForeignKey
ALTER TABLE "tenant"."meter_readings" ADD CONSTRAINT "meter_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "tenant"."meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: grants, row-level security, checks; readings are append-only.
GRANT SELECT, INSERT, UPDATE ON "tenant"."meters" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."meter_readings" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."utility_outages" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meters','meter_readings','utility_outages'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
CREATE UNIQUE INDEX meters_one_active ON "tenant"."meters" (estate_id, provider_code, meter_number) WHERE status = 'active';
ALTER TABLE "tenant"."meter_readings" ADD CONSTRAINT meter_readings_reading_check CHECK (reading >= 0);
CREATE TRIGGER meter_readings_append_only BEFORE UPDATE OR DELETE ON "tenant"."meter_readings"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
