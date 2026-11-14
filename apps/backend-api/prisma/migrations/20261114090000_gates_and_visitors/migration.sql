-- CreateTable
CREATE TABLE "tenant"."gates" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."estate_signing_keys" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "key_index" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key_wrapped" TEXT NOT NULL,
    "active_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_to" TIMESTAMPTZ(3),

    CONSTRAINT "estate_signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."visitor_invitations" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "host_user_id" UUID NOT NULL,
    "host_household_id" UUID,
    "space_id" UUID,
    "type" TEXT NOT NULL,
    "purpose" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."visitor_passes" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "visitor_phone" TEXT,
    "vehicle_plate" TEXT,
    "pin_lookup" TEXT NOT NULL,
    "pin_wrapped" TEXT NOT NULL,
    "public_token_hash" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_to" TIMESTAMPTZ(3) NOT NULL,
    "recurrence" JSONB,
    "gate_ids" UUID[],
    "max_uses" INTEGER,
    "uses_count" INTEGER NOT NULL DEFAULT 0,
    "domestic_staff_id" UUID,
    "key_index" INTEGER NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visitor_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."gate_events" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "pass_id" UUID,
    "walkin_id" UUID,
    "direction" TEXT NOT NULL,
    "visitor_name" TEXT,
    "vehicle_plate" TEXT,
    "decision" TEXT NOT NULL,
    "decision_reason" TEXT,
    "guard_user_id" UUID NOT NULL,
    "device_id" TEXT,
    "client_uuid" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_skewed" BOOLEAN NOT NULL DEFAULT false,
    "offline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."walkin_requests" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "visitor_phone" TEXT,
    "purpose" TEXT,
    "vehicle_plate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responded_by" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "guard_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "walkin_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."restricted_visitors" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "plate_normalised" TEXT,
    "reason" TEXT NOT NULL,
    "added_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restricted_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gates_estate_id_status_idx" ON "tenant"."gates"("estate_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "estate_signing_keys_estate_id_key_index_key" ON "tenant"."estate_signing_keys"("estate_id", "key_index");

-- CreateIndex
CREATE INDEX "visitor_invitations_estate_id_host_household_id_idx" ON "tenant"."visitor_invitations"("estate_id", "host_household_id");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_passes_public_token_hash_key" ON "tenant"."visitor_passes"("public_token_hash");

-- CreateIndex
CREATE INDEX "visitor_passes_estate_id_valid_from_valid_to_idx" ON "tenant"."visitor_passes"("estate_id", "valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "visitor_passes_estate_id_revoked_at_idx" ON "tenant"."visitor_passes"("estate_id", "revoked_at");

-- CreateIndex
CREATE INDEX "visitor_passes_invitation_id_idx" ON "tenant"."visitor_passes"("invitation_id");

-- CreateIndex
CREATE INDEX "gate_events_estate_id_occurred_at_idx" ON "tenant"."gate_events"("estate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "gate_events_estate_id_pass_id_idx" ON "tenant"."gate_events"("estate_id", "pass_id");

-- CreateIndex
CREATE UNIQUE INDEX "gate_events_estate_id_client_uuid_key" ON "tenant"."gate_events"("estate_id", "client_uuid");

-- CreateIndex
CREATE INDEX "walkin_requests_estate_id_status_expires_at_idx" ON "tenant"."walkin_requests"("estate_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "walkin_requests_estate_id_household_id_idx" ON "tenant"."walkin_requests"("estate_id", "household_id");

-- CreateIndex
CREATE INDEX "restricted_visitors_estate_id_idx" ON "tenant"."restricted_visitors"("estate_id");

-- AddForeignKey
ALTER TABLE "tenant"."visitor_passes" ADD CONSTRAINT "visitor_passes_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "tenant"."visitor_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: integrity, grants and row-level security.
CREATE UNIQUE INDEX gates_live_name ON "tenant"."gates" (estate_id, lower(name)) WHERE status = 'active';
-- PIN lookups. Uniqueness among live passes is checked when issuing (a live pass depends on the clock,
-- which an index predicate cannot use); verification treats a duplicate as CHECK (ADR-0010).
CREATE INDEX visitor_passes_pin_lookup ON "tenant"."visitor_passes" (estate_id, pin_lookup)
  WHERE revoked_at IS NULL;
ALTER TABLE "tenant"."gate_events"
  ADD CONSTRAINT gate_events_direction_check CHECK (direction IN ('in', 'out')),
  ADD CONSTRAINT gate_events_decision_check CHECK (decision IN ('allow', 'check', 'deny', 'override'));

GRANT SELECT, INSERT, UPDATE ON "tenant"."gates", "tenant"."estate_signing_keys", "tenant"."visitor_invitations",
  "tenant"."visitor_passes", "tenant"."walkin_requests", "tenant"."restricted_visitors" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."gate_events" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gates','estate_signing_keys','visitor_invitations','visitor_passes','gate_events',
                           'walkin_requests','restricted_visitors'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

-- Gate events are evidence: append-only (AGENTS.md §5.4). Corrections are new events.
CREATE TRIGGER gate_events_append_only
  BEFORE UPDATE OR DELETE ON "tenant"."gate_events"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
