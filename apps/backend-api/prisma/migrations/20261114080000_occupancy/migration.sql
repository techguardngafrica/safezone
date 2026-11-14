-- CreateTable
CREATE TABLE "tenant"."households" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "head_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."household_members" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "is_minor" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."occupancies" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" UUID,

    CONSTRAINT "occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."join_requests" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "household_id" UUID,
    "full_name" TEXT NOT NULL,
    "message" TEXT,
    "evidence_file_ids" UUID[],
    "status" TEXT NOT NULL,
    "decided_by" UUID,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."vehicles" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "plate_normalised" TEXT NOT NULL,
    "plate_display" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "colour" TEXT,
    "tag_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."domestic_staff" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "approved_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "domestic_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."emergency_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "consent_confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "households_estate_id_space_id_status_idx" ON "tenant"."households"("estate_id", "space_id", "status");

-- CreateIndex
CREATE INDEX "household_members_estate_id_user_id_status_idx" ON "tenant"."household_members"("estate_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "household_members_household_id_idx" ON "tenant"."household_members"("household_id");

-- CreateIndex
CREATE INDEX "occupancies_estate_id_space_id_status_idx" ON "tenant"."occupancies"("estate_id", "space_id", "status");

-- CreateIndex
CREATE INDEX "join_requests_estate_id_status_created_at_idx" ON "tenant"."join_requests"("estate_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "join_requests_user_id_idx" ON "tenant"."join_requests"("user_id");

-- CreateIndex
CREATE INDEX "vehicles_estate_id_household_id_idx" ON "tenant"."vehicles"("estate_id", "household_id");

-- CreateIndex
CREATE INDEX "domestic_staff_estate_id_household_id_idx" ON "tenant"."domestic_staff"("estate_id", "household_id");

-- CreateIndex
CREATE INDEX "domestic_staff_estate_id_status_idx" ON "tenant"."domestic_staff"("estate_id", "status");

-- CreateIndex
CREATE INDEX "emergency_contacts_user_id_idx" ON "platform"."emergency_contacts"("user_id");

-- AddForeignKey
ALTER TABLE "tenant"."household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "tenant"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."occupancies" ADD CONSTRAINT "occupancies_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "tenant"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: integrity, grants and row-level security.
-- One live household per unit (occupancy.md §6.1; shared occupancy is not configurable yet).
CREATE UNIQUE INDEX households_one_active_per_unit ON "tenant"."households" (estate_id, space_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX household_members_one_active ON "tenant"."household_members" (household_id, user_id)
  WHERE status = 'active' AND user_id IS NOT NULL;
-- One open join request per user and unit.
CREATE UNIQUE INDEX join_requests_one_open ON "tenant"."join_requests" (estate_id, user_id, space_id)
  WHERE status IN ('awaiting_household_head', 'awaiting_owner', 'awaiting_manager');
-- Plates are unique per estate among active vehicles (occupancy.md §6.6).
CREATE UNIQUE INDEX vehicles_active_plate ON "tenant"."vehicles" (estate_id, plate_normalised)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON "tenant"."households", "tenant"."household_members", "tenant"."occupancies",
  "tenant"."join_requests", "tenant"."vehicles", "tenant"."domestic_staff" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "platform"."emergency_contacts" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['households','household_members','occupancies','join_requests','vehicles','domestic_staff'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
-- A signed-in user sees their own join requests across estates (GET /v1/me/join-requests).
CREATE POLICY join_requests_own ON "tenant"."join_requests" FOR SELECT TO safezone_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE "platform"."emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."emergency_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_contacts_own ON "platform"."emergency_contacts" FOR ALL TO safezone_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
-- SOS responders read them through the emergency module only (emergency.md).
CREATE POLICY emergency_contacts_emergency ON "platform"."emergency_contacts" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'emergency');
