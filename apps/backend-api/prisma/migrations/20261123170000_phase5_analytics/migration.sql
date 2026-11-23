-- Phase 5: Deeper Analytics & Reporting (analytics.md, ADR-0026).

CREATE SCHEMA IF NOT EXISTS "analytics";
GRANT USAGE ON SCHEMA "analytics" TO safezone_app;

CREATE TABLE "analytics"."rm_gate_daily" (
    "estate_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,
    "digital_entries" INTEGER NOT NULL DEFAULT 0,
    "manual_entries" INTEGER NOT NULL DEFAULT 0,
    "denies" INTEGER NOT NULL DEFAULT 0,
    "overrides" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rm_gate_daily_pkey" PRIMARY KEY ("estate_id", "day")
);

CREATE TABLE "analytics"."rm_sos_metrics" (
    "estate_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "real_alerts" INTEGER NOT NULL DEFAULT 0,
    "drill_alerts" INTEGER NOT NULL DEFAULT 0,
    "ack_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "ack_count" INTEGER NOT NULL DEFAULT 0,
    "resolve_seconds_sum" INTEGER NOT NULL DEFAULT 0,
    "resolve_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rm_sos_metrics_pkey" PRIMARY KEY ("estate_id", "day")
);

CREATE TABLE "analytics"."rm_collections_monthly" (
    "estate_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "billed_kobo" BIGINT NOT NULL DEFAULT 0,
    "collected_kobo" BIGINT NOT NULL DEFAULT 0,
    "digital_collected_kobo" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "rm_collections_monthly_pkey" PRIMARY KEY ("estate_id", "month")
);

CREATE TABLE "analytics"."rm_maintenance_sla" (
    "estate_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "resolved" INTEGER NOT NULL DEFAULT 0,
    "breached" INTEGER NOT NULL DEFAULT 0,
    "resolve_minutes_sum" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rm_maintenance_sla_pkey" PRIMARY KEY ("estate_id", "day")
);

CREATE TABLE "analytics"."rm_community_daily" (
    "estate_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "active_users" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rm_community_daily_pkey" PRIMARY KEY ("estate_id", "day")
);

CREATE TABLE "analytics"."rm_platform_daily" (
    "day" DATE NOT NULL,
    "active_estates" INTEGER NOT NULL DEFAULT 0,
    "total_users" INTEGER NOT NULL DEFAULT 0,
    "mau" INTEGER NOT NULL DEFAULT 0,
    "tx_volume_kobo" BIGINT NOT NULL DEFAULT 0,
    "ad_revenue_kobo" BIGINT NOT NULL DEFAULT 0,
    "marketplace_commission_kobo" BIGINT NOT NULL DEFAULT 0,
    "ad_impressions" INTEGER NOT NULL DEFAULT 0,
    "ad_clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rm_platform_daily_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "analytics"."product_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estate_id" UUID,
    "user_id" UUID,
    "app" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."report_schedules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "report_key" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT[] NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_events_occurred_at_idx" ON "analytics"."product_events"("occurred_at");
CREATE INDEX "product_events_estate_id_occurred_at_idx" ON "analytics"."product_events"("estate_id", "occurred_at");
CREATE INDEX "report_schedules_estate_id_active_idx" ON "tenant"."report_schedules"("estate_id", "active");

-- RLS for estate-scoped analytics projections (readable by tenant or analytics worker)
GRANT SELECT, INSERT, UPDATE ON "analytics"."rm_gate_daily", "analytics"."rm_sos_metrics",
  "analytics"."rm_collections_monthly", "analytics"."rm_maintenance_sla", "analytics"."rm_community_daily" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "analytics"."rm_platform_daily" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "analytics"."product_events" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."report_schedules" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rm_gate_daily','rm_sos_metrics','rm_collections_monthly','rm_maintenance_sla','rm_community_daily'] LOOP
    EXECUTE format('ALTER TABLE "analytics".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "analytics".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "analytics".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid OR current_setting('app.context', true) = 'analytics')
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid OR current_setting('app.context', true) = 'analytics')$p$, t || '_rls', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['rm_platform_daily','product_events'] LOOP
    EXECUTE format('ALTER TABLE "analytics".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "analytics".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "analytics".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'analytics')
      WITH CHECK (current_setting('app.context', true) = 'analytics')$p$, t || '_ctx', t);
  END LOOP;
END $$;

ALTER TABLE "tenant"."report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."report_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "report_schedules_tenant" ON "tenant"."report_schedules" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

ALTER TABLE "tenant"."report_schedules" ADD CONSTRAINT report_schedules_check
  CHECK (frequency IN ('weekly','monthly') AND format IN ('csv'));
