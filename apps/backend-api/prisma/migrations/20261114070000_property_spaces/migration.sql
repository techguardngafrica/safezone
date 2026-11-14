-- CreateTable
CREATE TABLE "tenant"."spaces" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "unit_type" TEXT,
    "bedrooms" INTEGER,
    "size_sqm" DOUBLE PRECISION,
    "status" TEXT,
    "external_ref" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spaces_estate_id_parent_id_idx" ON "tenant"."spaces"("estate_id", "parent_id");

-- CreateIndex
CREATE INDEX "spaces_estate_id_type_status_idx" ON "tenant"."spaces"("estate_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_estate_id_path_key" ON "tenant"."spaces"("estate_id", "path");


-- Hand-written: integrity rules Prisma cannot express, grants and row-level security.
ALTER TABLE "tenant"."spaces"
  ADD CONSTRAINT spaces_type_check CHECK (type IN ('phase','zone','street','block','building','floor','unit','common_area')),
  ADD CONSTRAINT spaces_unit_fields_check CHECK (
    (type = 'unit' AND status IN ('vacant','occupied','under_construction','reserved'))
    OR (type <> 'unit' AND status IS NULL AND unit_type IS NULL AND bedrooms IS NULL)),
  ADD CONSTRAINT spaces_parent_fkey FOREIGN KEY (parent_id) REFERENCES "tenant"."spaces"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prefix search on the materialised path ("all units in Block C"), live spaces only. text_pattern_ops makes
-- LIKE 'prefix%' indexable under any collation.
CREATE INDEX spaces_path_prefix_idx ON "tenant"."spaces" (estate_id, path text_pattern_ops)
  WHERE archived_at IS NULL;
-- Unit codes are unique within an estate (property.md §4.2); other codes are unique among live siblings.
CREATE UNIQUE INDEX spaces_unit_code_key ON "tenant"."spaces" (estate_id, lower(code))
  WHERE type = 'unit' AND archived_at IS NULL;
CREATE UNIQUE INDEX spaces_sibling_code_key ON "tenant"."spaces" (estate_id, parent_id, lower(code))
  NULLS NOT DISTINCT WHERE type <> 'unit' AND archived_at IS NULL;
CREATE UNIQUE INDEX spaces_external_ref_key ON "tenant"."spaces" (estate_id, external_ref)
  WHERE external_ref IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON "tenant"."spaces" TO safezone_app;
ALTER TABLE "tenant"."spaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."spaces" FORCE ROW LEVEL SECURITY;
CREATE POLICY spaces_tenant ON "tenant"."spaces" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);
