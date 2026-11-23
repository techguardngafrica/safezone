-- Phase 5: Workforce & HR (workforce.md, ADR-0026).

CREATE TABLE "tenant"."departments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "head_staff_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."staff_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "staff_number" TEXT NOT NULL,
    "department_id" UUID,
    "job_title" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL DEFAULT 'full_time',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."duty_assignments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "space_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."staff_rosters" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_rosters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."attendance_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "clock_in" TIMESTAMPTZ(3) NOT NULL,
    "clock_out" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL DEFAULT 'app',
    "geo_ok" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" UUID,
    "edited_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."leave_types" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "annual_allowance_days" SMALLINT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."leave_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "days" SMALLINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."salary_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "payload_encrypted" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."payroll_exports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "staff_count" INTEGER NOT NULL,
    "total_net_kobo" BIGINT NOT NULL,
    "csv_content" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_exports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_estate_id_name_key" ON "tenant"."departments"("estate_id", "name");
CREATE UNIQUE INDEX "staff_profiles_estate_id_user_id_key" ON "tenant"."staff_profiles"("estate_id", "user_id");
CREATE UNIQUE INDEX "staff_profiles_estate_id_staff_number_key" ON "tenant"."staff_profiles"("estate_id", "staff_number");
CREATE INDEX "staff_rosters_estate_id_date_idx" ON "tenant"."staff_rosters"("estate_id", "date");
CREATE INDEX "attendance_records_estate_id_staff_id_clock_in_idx" ON "tenant"."attendance_records"("estate_id", "staff_id", "clock_in");
CREATE UNIQUE INDEX "leave_types_estate_id_name_key" ON "tenant"."leave_types"("estate_id", "name");
CREATE INDEX "leave_requests_estate_id_status_created_at_idx" ON "tenant"."leave_requests"("estate_id", "status", "created_at");
CREATE INDEX "salary_records_estate_id_staff_id_effective_from_idx" ON "tenant"."salary_records"("estate_id", "staff_id", "effective_from");
CREATE INDEX "payroll_exports_estate_id_period_idx" ON "tenant"."payroll_exports"("estate_id", "period");

ALTER TABLE "tenant"."staff_profiles" ADD CONSTRAINT "staff_profiles_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "tenant"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant"."duty_assignments" ADD CONSTRAINT "duty_assignments_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "tenant"."staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."staff_rosters" ADD CONSTRAINT "staff_rosters_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "tenant"."staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."attendance_records" ADD CONSTRAINT "attendance_records_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "tenant"."staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."leave_requests" ADD CONSTRAINT "leave_requests_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "tenant"."staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey"
  FOREIGN KEY ("leave_type_id") REFERENCES "tenant"."leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."salary_records" ADD CONSTRAINT "salary_records_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "tenant"."staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "tenant"."departments", "tenant"."staff_profiles", "tenant"."duty_assignments",
  "tenant"."staff_rosters", "tenant"."attendance_records", "tenant"."leave_types", "tenant"."leave_requests" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."salary_records", "tenant"."payroll_exports" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','staff_profiles','duty_assignments','staff_rosters',
                           'attendance_records','leave_types','leave_requests','salary_records','payroll_exports'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

ALTER TABLE "tenant"."staff_profiles" ADD CONSTRAINT staff_profiles_check
  CHECK (employment_type IN ('full_time','part_time','contract') AND status IN ('active','on_leave','suspended','offboarded'));
ALTER TABLE "tenant"."attendance_records" ADD CONSTRAINT attendance_records_source_check
  CHECK (source IN ('app','security_shift','manual'));
ALTER TABLE "tenant"."leave_requests" ADD CONSTRAINT leave_requests_check
  CHECK (days > 0 AND ends_on >= starts_on AND status IN ('pending','approved','rejected','cancelled'));
