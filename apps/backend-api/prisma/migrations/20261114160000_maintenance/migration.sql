-- Maintenance and complaints (maintenance.md, Phase 2; ADR-0014).
-- CreateTable
CREATE TABLE "tenant"."maintenance_categories" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'maintenance',
    "default_priority" TEXT NOT NULL DEFAULT 'normal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."maintenance_counters" (
    "estate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "maintenance_counters_pkey" PRIMARY KEY ("estate_id","kind")
);

-- CreateTable
CREATE TABLE "tenant"."maintenance_requests" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "space_id" UUID,
    "household_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "preferred_times" TEXT,
    "about_neighbour" BOOLEAN NOT NULL DEFAULT false,
    "attachment_file_ids" UUID[],
    "requested_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "sla_due_at" TIMESTAMPTZ(3),
    "sla_paused_at" TIMESTAMPTZ(3),
    "sla_paused_ms" BIGINT NOT NULL DEFAULT 0,
    "sla_breach_level" INTEGER NOT NULL DEFAULT 0,
    "resolution_hours" INTEGER NOT NULL,
    "rejection_reason" TEXT,
    "rating" INTEGER,
    "feedback" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."maintenance_comments" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."work_orders" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "request_id" UUID,
    "recurring_id" UUID,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "space_id" UUID,
    "assignee_type" TEXT,
    "assignee_user_id" UUID,
    "vendor_name" TEXT,
    "vendor_phone" TEXT,
    "vendor_company" TEXT,
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "visitor_pass_id" UUID,
    "labour_cost" BIGINT NOT NULL DEFAULT 0,
    "materials_cost" BIGINT NOT NULL DEFAULT 0,
    "recharge_to_resident" BOOLEAN NOT NULL DEFAULT false,
    "invoice_id" UUID,
    "resolution_notes" TEXT,
    "resolution_file_ids" UUID[],
    "created_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."work_order_materials" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."recurring_maintenance" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "space_id" UUID,
    "frequency" TEXT NOT NULL,
    "next_run_on" DATE NOT NULL,
    "assignee" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_work_order_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."sla_policies" (
    "estate_id" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "response_minutes" INTEGER NOT NULL,
    "resolution_hours" INTEGER NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("estate_id","priority")
);

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_categories_estate_id_name_key" ON "tenant"."maintenance_categories"("estate_id", "name");

-- CreateIndex
CREATE INDEX "maintenance_requests_estate_id_status_created_at_idx" ON "tenant"."maintenance_requests"("estate_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_requests_estate_id_requested_by_idx" ON "tenant"."maintenance_requests"("estate_id", "requested_by");

-- CreateIndex
CREATE INDEX "maintenance_requests_estate_id_household_id_idx" ON "tenant"."maintenance_requests"("estate_id", "household_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_estate_id_number_key" ON "tenant"."maintenance_requests"("estate_id", "number");

-- CreateIndex
CREATE INDEX "maintenance_comments_request_id_created_at_idx" ON "tenant"."maintenance_comments"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "work_orders_estate_id_status_idx" ON "tenant"."work_orders"("estate_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_estate_id_assignee_user_id_status_idx" ON "tenant"."work_orders"("estate_id", "assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_request_id_idx" ON "tenant"."work_orders"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_estate_id_number_key" ON "tenant"."work_orders"("estate_id", "number");

-- CreateIndex
CREATE INDEX "work_order_materials_work_order_id_idx" ON "tenant"."work_order_materials"("work_order_id");

-- CreateIndex
CREATE INDEX "recurring_maintenance_estate_id_active_next_run_on_idx" ON "tenant"."recurring_maintenance"("estate_id", "active", "next_run_on");

-- AddForeignKey
ALTER TABLE "tenant"."maintenance_comments" ADD CONSTRAINT "maintenance_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "tenant"."maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "tenant"."work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: grants, row-level security and checks.
GRANT SELECT, INSERT, UPDATE ON "tenant"."maintenance_categories" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."maintenance_counters" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."maintenance_requests" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."maintenance_comments" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."work_orders" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."work_order_materials" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."recurring_maintenance" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."sla_policies" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_categories','maintenance_counters','maintenance_requests',
                           'maintenance_comments','work_orders','work_order_materials',
                           'recurring_maintenance','sla_policies'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "tenant"."maintenance_requests" ADD CONSTRAINT maintenance_requests_rating_check
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
ALTER TABLE "tenant"."work_orders" ADD CONSTRAINT work_orders_costs_check
  CHECK (labour_cost >= 0 AND materials_cost >= 0);
ALTER TABLE "tenant"."work_order_materials" ADD CONSTRAINT work_order_materials_check
  CHECK (quantity > 0 AND unit_cost >= 0 AND amount >= 0);
-- Comments and materials are records of what happened: append-only.
CREATE TRIGGER maintenance_comments_append_only BEFORE UPDATE OR DELETE ON "tenant"."maintenance_comments"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER work_order_materials_append_only BEFORE UPDATE OR DELETE ON "tenant"."work_order_materials"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
