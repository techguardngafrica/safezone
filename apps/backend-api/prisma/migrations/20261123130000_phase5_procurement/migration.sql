-- Phase 5: Procurement & Inventory (procurement.md, ADR-0026).

CREATE TABLE "tenant"."suppliers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "vendor_id" UUID,
    "bank_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rating" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."purchase_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "required_by" DATE,
    "estimated_total_kobo" BIGINT NOT NULL,
    "work_order_id" UUID,
    "budget_line_id" UUID,
    "sole_source_justification" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."purchase_request_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "inventory_item_id" UUID,
    "qty" DOUBLE PRECISION NOT NULL,
    "est_unit_cost_kobo" BIGINT NOT NULL,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."approval_steps" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "step" SMALLINT NOT NULL,
    "approver_role" TEXT NOT NULL,
    "approver_id" UUID,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMPTZ(3),
    "comment" TEXT,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."quotations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "valid_until" DATE,
    "file_id" UUID,
    "notes" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."purchase_orders" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "pr_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issued_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."purchase_order_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "inventory_item_id" UUID,
    "qty_ordered" DOUBLE PRECISION NOT NULL,
    "qty_received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit_cost_kobo" BIGINT NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."goods_receipts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "received_by" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "photo_file_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."goods_receipt_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "gr_id" UUID NOT NULL,
    "po_item_id" UUID NOT NULL,
    "qty_received" DOUBLE PRECISION NOT NULL,
    "qty_rejected" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."stock_locations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "space_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."inventory_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "reorder_level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "is_consumable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."stock_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "qty_delta" DOUBLE PRECISION NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "recorded_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."assets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "space_id" UUID,
    "custodian_id" UUID,
    "purchase_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "purchased_on" DATE,
    "warranty_until" DATE,
    "status" TEXT NOT NULL DEFAULT 'in_use',
    "disposal_reason" TEXT,
    "disposed_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suppliers_estate_id_status_idx" ON "tenant"."suppliers"("estate_id", "status");
CREATE UNIQUE INDEX "purchase_requests_estate_id_number_key" ON "tenant"."purchase_requests"("estate_id", "number");
CREATE INDEX "purchase_requests_estate_id_status_created_at_idx" ON "tenant"."purchase_requests"("estate_id", "status", "created_at");
CREATE INDEX "approval_steps_estate_id_subject_idx" ON "tenant"."approval_steps"("estate_id", "subject_type", "subject_id", "step");
CREATE INDEX "quotations_pr_id_idx" ON "tenant"."quotations"("pr_id");
CREATE UNIQUE INDEX "purchase_orders_estate_id_number_key" ON "tenant"."purchase_orders"("estate_id", "number");
CREATE INDEX "purchase_orders_estate_id_status_created_at_idx" ON "tenant"."purchase_orders"("estate_id", "status", "created_at");
CREATE INDEX "goods_receipts_po_id_idx" ON "tenant"."goods_receipts"("po_id");
CREATE UNIQUE INDEX "inventory_items_estate_id_sku_key" ON "tenant"."inventory_items"("estate_id", "sku");
CREATE INDEX "stock_movements_estate_id_item_id_occurred_at_idx" ON "tenant"."stock_movements"("estate_id", "item_id", "occurred_at");
CREATE UNIQUE INDEX "assets_estate_id_tag_key" ON "tenant"."assets"("estate_id", "tag");

ALTER TABLE "tenant"."purchase_request_items" ADD CONSTRAINT "purchase_request_items_pr_id_fkey"
  FOREIGN KEY ("pr_id") REFERENCES "tenant"."purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."quotations" ADD CONSTRAINT "quotations_pr_id_fkey"
  FOREIGN KEY ("pr_id") REFERENCES "tenant"."purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."quotations" ADD CONSTRAINT "quotations_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "tenant"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."purchase_orders" ADD CONSTRAINT "purchase_orders_pr_id_fkey"
  FOREIGN KEY ("pr_id") REFERENCES "tenant"."purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "tenant"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_fkey"
  FOREIGN KEY ("po_id") REFERENCES "tenant"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_fkey"
  FOREIGN KEY ("po_id") REFERENCES "tenant"."purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_gr_id_fkey"
  FOREIGN KEY ("gr_id") REFERENCES "tenant"."goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "tenant"."inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "tenant"."stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "tenant"."suppliers", "tenant"."purchase_requests", "tenant"."purchase_request_items",
  "tenant"."approval_steps", "tenant"."quotations", "tenant"."purchase_orders", "tenant"."purchase_order_items",
  "tenant"."goods_receipts", "tenant"."goods_receipt_items", "tenant"."stock_locations", "tenant"."inventory_items",
  "tenant"."assets" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."stock_movements" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers','purchase_requests','purchase_request_items','approval_steps',
                           'quotations','purchase_orders','purchase_order_items','goods_receipts',
                           'goods_receipt_items','stock_locations','inventory_items','stock_movements','assets'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON "tenant"."stock_movements"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

ALTER TABLE "tenant"."suppliers" ADD CONSTRAINT suppliers_status_check
  CHECK (status IN ('active','suspended','archived') AND (rating IS NULL OR rating BETWEEN 1 AND 5));
ALTER TABLE "tenant"."purchase_requests" ADD CONSTRAINT purchase_requests_status_check
  CHECK (estimated_total_kobo >= 0 AND status IN ('draft','submitted','approved','rejected','rfq','quoted','po_created','closed'));
ALTER TABLE "tenant"."approval_steps" ADD CONSTRAINT approval_steps_decision_check
  CHECK (decision IN ('pending','approved','rejected') AND step >= 1);
ALTER TABLE "tenant"."purchase_orders" ADD CONSTRAINT purchase_orders_status_check
  CHECK (total_kobo > 0 AND status IN ('draft','issued','partially_received','received','invoiced','closed','cancelled'));
ALTER TABLE "tenant"."stock_movements" ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('receipt','issue','transfer','return','adjustment') AND qty_delta <> 0);
ALTER TABLE "tenant"."assets" ADD CONSTRAINT assets_status_check
  CHECK (purchase_cost_kobo >= 0 AND status IN ('in_use','in_repair','disposed'));
