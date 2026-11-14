-- Move-in and move-out (occupancy.md §5, Phase 2; ADR-0014).
-- CreateTable
CREATE TABLE "tenant"."move_events" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "occupancy_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "scheduled_on" DATE NOT NULL,
    "gate_notice" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "outstanding_balance" BIGINT NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "move_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "move_events_estate_id_scheduled_on_status_idx" ON "tenant"."move_events"("estate_id", "scheduled_on", "status");

-- CreateIndex
CREATE INDEX "move_events_occupancy_id_idx" ON "tenant"."move_events"("occupancy_id");


-- Hand-written: grants and row-level security. One open move of each type per occupancy.
GRANT SELECT, INSERT, UPDATE ON "tenant"."move_events" TO safezone_app;
ALTER TABLE "tenant"."move_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."move_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY move_events_tenant ON "tenant"."move_events" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);
CREATE UNIQUE INDEX move_events_one_open ON "tenant"."move_events" (occupancy_id, type) WHERE status = 'scheduled';
