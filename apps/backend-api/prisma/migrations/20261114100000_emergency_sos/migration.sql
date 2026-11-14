-- CreateTable
CREATE TABLE "tenant"."sos_alerts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "triggered_by" UUID NOT NULL,
    "trigger_role" TEXT NOT NULL,
    "household_id" UUID,
    "space_id" UUID,
    "category" TEXT NOT NULL,
    "is_drill" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'app',
    "status" TEXT NOT NULL DEFAULT 'triggered',
    "triggered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by" UUID,
    "assigned_to" UUID,
    "responding_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "resolution" TEXT,
    "false_alarm" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "client_uuid" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sos_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."sos_locations" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."sos_events" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "channel" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."emergency_broadcasts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sent_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sos_alerts_estate_id_status_triggered_at_idx" ON "tenant"."sos_alerts"("estate_id", "status", "triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "sos_alerts_estate_id_client_uuid_key" ON "tenant"."sos_alerts"("estate_id", "client_uuid");

-- CreateIndex
CREATE INDEX "sos_locations_alert_id_captured_at_idx" ON "tenant"."sos_locations"("alert_id", "captured_at");

-- CreateIndex
CREATE INDEX "sos_events_alert_id_occurred_at_idx" ON "tenant"."sos_events"("alert_id", "occurred_at");

-- CreateIndex
CREATE INDEX "emergency_broadcasts_estate_id_sent_at_idx" ON "tenant"."emergency_broadcasts"("estate_id", "sent_at");


-- Hand-written: integrity, grants and row-level security.
-- One active real alert per household (emergency.md §8.2); repeats attach to it.
CREATE UNIQUE INDEX sos_alerts_one_active_per_household ON "tenant"."sos_alerts" (estate_id, household_id)
  WHERE household_id IS NOT NULL AND is_drill = false
    AND status IN ('triggered', 'acknowledged', 'assigned', 'responding');

GRANT SELECT, INSERT, UPDATE ON "tenant"."sos_alerts" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."sos_locations", "tenant"."sos_events", "tenant"."emergency_broadcasts" TO safezone_app;
GRANT UPDATE ON "tenant"."emergency_broadcasts" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sos_alerts','sos_locations','sos_events','emergency_broadcasts'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

-- Safety records: timeline and locations are append-only (emergency.md §8.7).
CREATE TRIGGER sos_events_append_only BEFORE UPDATE OR DELETE ON "tenant"."sos_events"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER sos_locations_append_only BEFORE UPDATE OR DELETE ON "tenant"."sos_locations"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
