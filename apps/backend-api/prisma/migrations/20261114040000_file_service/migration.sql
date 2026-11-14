-- File service (Phase 0 task 10).
-- CreateTable
CREATE TABLE "platform"."files" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "purpose" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "scan_status" TEXT NOT NULL DEFAULT 'awaiting_upload',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(3),
    "scanned_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "platform"."files"("storage_key");

-- CreateIndex
CREATE INDEX "files_estate_id_purpose_idx" ON "platform"."files"("estate_id", "purpose");

-- CreateIndex
CREATE INDEX "files_uploaded_by_idx" ON "platform"."files"("uploaded_by");


-- ---------------------------------------------------------------------------
-- Hand-written: grants and row-level security. No DELETE: purging is a retention job.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."files" TO safezone_app;
ALTER TABLE "platform"."files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."files" FORCE ROW LEVEL SECURITY;

-- Estate files: the current estate.
CREATE POLICY files_tenant ON "platform"."files" FOR ALL TO safezone_app
  USING (estate_id IS NOT NULL AND estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id IS NOT NULL AND estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);
-- Personal files: the uploader.
CREATE POLICY files_own ON "platform"."files" FOR ALL TO safezone_app
  USING (estate_id IS NULL AND uploaded_by = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (estate_id IS NULL AND uploaded_by = nullif(current_setting('app.user_id', true), '')::uuid);
-- Scanner in the worker.
CREATE POLICY files_module ON "platform"."files" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'files')
  WITH CHECK (current_setting('app.context', true) = 'files');
