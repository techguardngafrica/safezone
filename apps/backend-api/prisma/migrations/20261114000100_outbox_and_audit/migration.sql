-- Transactional outbox and append-only audit events (Phase 0 task 2).

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "estate_id" UUID,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estate_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "acting_role" TEXT,
    "support_session_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "device_id" TEXT,
    "app" TEXT,
    "request_id" TEXT,
    "source_event_id" UUID,
    "hash" TEXT NOT NULL,
    "prev_hash" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_pending_idx" ON "platform"."outbox_events"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_source_event_id_key" ON "audit"."audit_events"("source_event_id");

-- CreateIndex
CREATE INDEX "audit_events_estate_id_occurred_at_idx" ON "audit"."audit_events"("estate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_resource_type_resource_id_idx" ON "audit"."audit_events"("resource_type", "resource_id");

-- ---------------------------------------------------------------------------
-- Hand-written: grants, row-level security, append-only enforcement.
-- ---------------------------------------------------------------------------

-- Outbox: the request path only inserts (via createMany, which uses no RETURNING);
-- the relay reads and marks rows dispatched inside withOutboxRelay(). No DELETE: cleanup is a retention job.
GRANT INSERT, SELECT, UPDATE ON "platform"."outbox_events" TO safezone_app;
ALTER TABLE "platform"."outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."outbox_events" FORCE ROW LEVEL SECURITY;

-- An event is either platform-level (no estate) or belongs to the estate of the current transaction.
CREATE POLICY outbox_events_insert ON "platform"."outbox_events"
  FOR INSERT TO safezone_app
  WITH CHECK (
    estate_id IS NULL
    OR estate_id = nullif(current_setting('app.estate_id', true), '')::uuid
  );

-- Only the outbox relay context may read or update events.
CREATE POLICY outbox_events_relay_select ON "platform"."outbox_events"
  FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'outbox_relay');

CREATE POLICY outbox_events_relay_update ON "platform"."outbox_events"
  FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'outbox_relay')
  WITH CHECK (current_setting('app.context', true) = 'outbox_relay');

-- Audit: append-only. The app role may insert and read rows of the current estate only.
-- Platform-level rows (estate_id IS NULL) are reachable only through the platform role (Phase 0 task 7).
GRANT INSERT, SELECT ON "audit"."audit_events" TO safezone_app;
ALTER TABLE "audit"."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit"."audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_select ON "audit"."audit_events"
  FOR SELECT TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

CREATE POLICY audit_events_tenant_insert ON "audit"."audit_events"
  FOR INSERT TO safezone_app
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

-- Defence in depth: block UPDATE and DELETE for every role, including the owner.
-- Retention removes whole partitions (follow-up ADR), which does not fire row triggers.
CREATE FUNCTION "audit"."reject_mutation"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."reject_mutation"();
