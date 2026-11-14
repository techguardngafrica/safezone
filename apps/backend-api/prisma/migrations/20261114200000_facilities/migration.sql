-- Facilities and bookings (facilities.md, Phase 3; ADR-0015).
-- CreateTable
CREATE TABLE "tenant"."facilities" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" INTEGER,
    "description" TEXT,
    "rules" TEXT,
    "photo_file_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "opening_hours" JSONB NOT NULL,
    "policy" JSONB NOT NULL,
    "pricing" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."facility_blackouts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."bookings" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "booked_by" UUID NOT NULL,
    "household_id" UUID,
    "space_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "purpose" TEXT,
    "status" TEXT NOT NULL,
    "price" BIGINT NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "hold_expires_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "rejection_reason" TEXT,
    "override_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "refund_amount" BIGINT NOT NULL DEFAULT 0,
    "checked_in_at" TIMESTAMPTZ(3),
    "reminded_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."damage_reports" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "photo_file_ids" UUID[],
    "charge_amount" BIGINT NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "reported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facilities_estate_id_status_idx" ON "tenant"."facilities"("estate_id", "status");

-- CreateIndex
CREATE INDEX "facility_blackouts_facility_id_starts_at_idx" ON "tenant"."facility_blackouts"("facility_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_invoice_id_key" ON "tenant"."bookings"("invoice_id");

-- CreateIndex
CREATE INDEX "bookings_facility_id_starts_at_idx" ON "tenant"."bookings"("facility_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_estate_id_booked_by_starts_at_idx" ON "tenant"."bookings"("estate_id", "booked_by", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_estate_id_status_idx" ON "tenant"."bookings"("estate_id", "status");

-- CreateIndex
CREATE INDEX "damage_reports_booking_id_idx" ON "tenant"."damage_reports"("booking_id");


-- Hand-written: grants, row-level security, checks and the no-overlap rule.
GRANT SELECT, INSERT, UPDATE ON "tenant"."facilities" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."facility_blackouts" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."bookings" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."damage_reports" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities','facility_blackouts','bookings','damage_reports'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "tenant"."bookings" ADD CONSTRAINT bookings_times_check
  CHECK (ends_at > starts_at AND blocked_until >= ends_at AND price >= 0 AND refund_amount >= 0 AND refund_amount <= price);
ALTER TABLE "tenant"."facility_blackouts" ADD CONSTRAINT facility_blackouts_times_check CHECK (ends_at > starts_at);

-- facilities.md rule 1: no two live bookings of a facility overlap (including the buffer). The facility
-- row is locked first, so two concurrent bookings for the same slot are serialised: one wins, one fails.
CREATE FUNCTION tenant.bookings_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('pending_approval', 'pending_payment', 'confirmed') THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "tenant"."facilities" WHERE id = NEW.facility_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "tenant"."bookings" b
     WHERE b.facility_id = NEW.facility_id
       AND b.id <> NEW.id
       AND b.status IN ('pending_approval', 'pending_payment', 'confirmed')
       AND tstzrange(b.starts_at, b.blocked_until) && tstzrange(NEW.starts_at, NEW.blocked_until)
  ) THEN
    RAISE EXCEPTION 'booking overlaps another booking' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_no_overlap BEFORE INSERT OR UPDATE OF starts_at, blocked_until, status ON "tenant"."bookings"
  FOR EACH ROW EXECUTE FUNCTION tenant.bookings_no_overlap();
