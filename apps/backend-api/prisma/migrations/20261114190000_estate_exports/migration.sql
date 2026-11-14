-- Estate data exports (platform.md §6, Phase 2; ADR-0014).
-- CreateTable
CREATE TABLE "tenant"."estate_exports" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "object_key" TEXT,
    "size_bytes" INTEGER,
    "datasets" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "estate_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estate_exports_estate_id_created_at_idx" ON "tenant"."estate_exports"("estate_id", "created_at");


-- Hand-written: grants and row-level security.
GRANT SELECT, INSERT, UPDATE ON "tenant"."estate_exports" TO safezone_app;
ALTER TABLE "tenant"."estate_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."estate_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_exports_tenant ON "tenant"."estate_exports" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);
