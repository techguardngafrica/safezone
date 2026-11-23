-- Data Protection Impact Assessment (DPIA) register (super-admin.md §6.8).

-- CreateTable
CREATE TABLE "platform"."dpia_records" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "estate_id" UUID,
    "processing_activity" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mitigations" TEXT NOT NULL,
    "document_file_id" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "next_review_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpia_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dpia_records_status_risk_level_created_at_idx" ON "platform"."dpia_records"("status", "risk_level", "created_at");

-- Grants, row-level security and checks (platform_config context).
GRANT SELECT, INSERT, UPDATE ON "platform"."dpia_records" TO safezone_app;
ALTER TABLE "platform"."dpia_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."dpia_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY dpia_records_platform ON "platform"."dpia_records" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'platform_config')
  WITH CHECK (current_setting('app.context', true) = 'platform_config');

ALTER TABLE "platform"."dpia_records" ADD CONSTRAINT dpia_records_risk_level_check
  CHECK (risk_level IN ('low', 'medium', 'high'));
ALTER TABLE "platform"."dpia_records" ADD CONSTRAINT dpia_records_status_check
  CHECK (status IN ('draft', 'in_review', 'approved', 'requires_update'));
