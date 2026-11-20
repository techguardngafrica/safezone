-- Import execution results and cross-job idempotency keys; support sessions default to 2 hours
-- (management-web.md §6.4, tenancy.md §7.8, platform.md §4; ADR-0019 amendment). Additive only.

ALTER TABLE "tenant"."bulk_import_jobs"
  ADD COLUMN "unchanged_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tenant"."bulk_import_keys" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "row_key" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "resource_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_import_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulk_import_keys_estate_id_kind_row_key_key" ON "tenant"."bulk_import_keys"("estate_id", "kind", "row_key");

-- Hand-written: grants, row-level security and checks.
GRANT SELECT, INSERT ON "tenant"."bulk_import_keys" TO safezone_app;
ALTER TABLE "tenant"."bulk_import_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."bulk_import_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY bulk_import_keys_tenant ON "tenant"."bulk_import_keys" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

ALTER TABLE "tenant"."support_sessions" ALTER COLUMN "duration_minutes" SET DEFAULT 120;
