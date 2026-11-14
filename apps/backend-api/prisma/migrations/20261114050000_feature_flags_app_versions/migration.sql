-- Feature flags and app versions (Phase 0 task 11).
-- CreateTable
CREATE TABLE "platform"."feature_flags" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "default_enabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."app_versions" (
    "app" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "min_version" TEXT NOT NULL,
    "recommended_version" TEXT NOT NULL,
    "message" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_versions_pkey" PRIMARY KEY ("app","platform")
);


-- ---------------------------------------------------------------------------
-- Hand-written: grants and row-level security.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."feature_flags" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."app_versions" TO safezone_app;

ALTER TABLE "platform"."feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."feature_flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_read ON "platform"."feature_flags" FOR SELECT TO safezone_app USING (true);
CREATE POLICY feature_flags_insert ON "platform"."feature_flags" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'platform_config');
CREATE POLICY feature_flags_update ON "platform"."feature_flags" FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'platform_config')
  WITH CHECK (current_setting('app.context', true) = 'platform_config');

ALTER TABLE "platform"."app_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."app_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY app_versions_read ON "platform"."app_versions" FOR SELECT TO safezone_app USING (true);
CREATE POLICY app_versions_insert ON "platform"."app_versions" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'platform_config');
CREATE POLICY app_versions_update ON "platform"."app_versions" FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'platform_config')
  WITH CHECK (current_setting('app.context', true) = 'platform_config');
