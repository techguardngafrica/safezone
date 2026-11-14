-- Document management (documents.md, Phase 3; ADR-0015).
-- CreateTable
CREATE TABLE "tenant"."document_folders" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."documents" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "folder_id" UUID,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" JSONB NOT NULL,
    "expires_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."document_versions" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "notes" TEXT,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."document_access_log" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_folders_estate_id_parent_id_name_key" ON "tenant"."document_folders"("estate_id", "parent_id", "name");

-- CreateIndex
CREATE INDEX "documents_estate_id_status_category_idx" ON "tenant"."documents"("estate_id", "status", "category");

-- CreateIndex
CREATE INDEX "documents_estate_id_expires_on_idx" ON "tenant"."documents"("estate_id", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "tenant"."document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "document_access_log_document_id_at_idx" ON "tenant"."document_access_log"("document_id", "at");

-- AddForeignKey
ALTER TABLE "tenant"."document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tenant"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: grants, row-level security; versions and the access log are append-only.
GRANT SELECT, INSERT ON "tenant"."document_folders" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."documents" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."document_versions" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."document_access_log" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_folders','documents','document_versions','document_access_log'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
CREATE TRIGGER document_versions_append_only BEFORE UPDATE OR DELETE ON "tenant"."document_versions"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER document_access_log_append_only BEFORE UPDATE OR DELETE ON "tenant"."document_access_log"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
