-- Bulk import jobs and support-access consent sessions (management-web.md §6.4, §6.13; ADR-0019).
-- CreateTable
CREATE TABLE "tenant"."bulk_import_jobs" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dry_run',
    "filename" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "errors_json" JSONB NOT NULL DEFAULT '[]',
    "payload_json" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID NOT NULL,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."support_sessions" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "platform_user_name" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_import_jobs_estate_id_created_at_idx" ON "tenant"."bulk_import_jobs"("estate_id", "created_at");

-- CreateIndex
CREATE INDEX "support_sessions_estate_id_status_requested_at_idx" ON "tenant"."support_sessions"("estate_id", "status", "requested_at");

-- Hand-written: grants, row-level security and checks.
GRANT SELECT, INSERT, UPDATE ON "tenant"."bulk_import_jobs" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."support_sessions" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bulk_import_jobs','support_sessions'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

ALTER TABLE "tenant"."bulk_import_jobs" ADD CONSTRAINT bulk_import_jobs_kind_check
  CHECK (kind IN ('units','owners','residents','households','vehicles','opening_balances'));
ALTER TABLE "tenant"."bulk_import_jobs" ADD CONSTRAINT bulk_import_jobs_status_check
  CHECK (status IN ('dry_run','queued','running','completed','failed'));
ALTER TABLE "tenant"."support_sessions" ADD CONSTRAINT support_sessions_status_check
  CHECK (status IN ('pending','approved','denied','revoked','expired'));
