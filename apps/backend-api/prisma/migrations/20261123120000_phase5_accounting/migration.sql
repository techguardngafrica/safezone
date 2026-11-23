-- Phase 5: Full Accounting & General Ledger (billing.md Phase 5, ADR-0026).

CREATE TABLE "tenant"."coa_accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parent_code" TEXT,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coa_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."financial_periods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closing_journal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."budgets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "period_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."budget_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "allocated_kobo" BIGINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."expenses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "category_account_code" TEXT NOT NULL,
    "cash_account_code" TEXT NOT NULL DEFAULT 'cash:bank',
    "vendor_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "incurred_on" DATE NOT NULL,
    "receipt_file_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "journal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."payables" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID,
    "supplier_name" TEXT NOT NULL,
    "po_id" UUID,
    "grn_id" UUID,
    "invoice_ref" TEXT NOT NULL,
    "expense_account_code" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "amount_paid_kobo" BIGINT NOT NULL DEFAULT 0,
    "due_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "journal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."payable_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "cash_account_code" TEXT NOT NULL,
    "reference" TEXT,
    "recorded_by" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."bank_statements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "cash_account_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "statement_from" DATE NOT NULL,
    "statement_to" DATE NOT NULL,
    "opening_balance_kobo" BIGINT NOT NULL,
    "closing_balance_kobo" BIGINT NOT NULL,
    "imported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."bank_statement_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount_kobo" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "matched_journal_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'unmatched',

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coa_accounts_estate_id_code_key" ON "tenant"."coa_accounts"("estate_id", "code");
CREATE INDEX "coa_accounts_estate_id_type_idx" ON "tenant"."coa_accounts"("estate_id", "type");
CREATE INDEX "financial_periods_estate_id_starts_on_ends_on_idx" ON "tenant"."financial_periods"("estate_id", "starts_on", "ends_on");
CREATE INDEX "budgets_estate_id_period_id_idx" ON "tenant"."budgets"("estate_id", "period_id");
CREATE UNIQUE INDEX "budget_lines_budget_id_account_code_key" ON "tenant"."budget_lines"("budget_id", "account_code");
CREATE UNIQUE INDEX "expenses_estate_id_number_key" ON "tenant"."expenses"("estate_id", "number");
CREATE INDEX "expenses_estate_id_status_created_at_idx" ON "tenant"."expenses"("estate_id", "status", "created_at");
CREATE UNIQUE INDEX "payables_estate_id_number_key" ON "tenant"."payables"("estate_id", "number");
CREATE INDEX "payables_estate_id_status_due_on_idx" ON "tenant"."payables"("estate_id", "status", "due_on");
CREATE INDEX "payable_payments_payable_id_created_at_idx" ON "tenant"."payable_payments"("payable_id", "created_at");
CREATE INDEX "bank_statements_estate_id_created_at_idx" ON "tenant"."bank_statements"("estate_id", "created_at");
CREATE INDEX "bank_statement_lines_statement_id_txn_date_idx" ON "tenant"."bank_statement_lines"("statement_id", "txn_date");

ALTER TABLE "tenant"."budgets" ADD CONSTRAINT "budgets_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "tenant"."financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey"
  FOREIGN KEY ("budget_id") REFERENCES "tenant"."budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."payable_payments" ADD CONSTRAINT "payable_payments_payable_id_fkey"
  FOREIGN KEY ("payable_id") REFERENCES "tenant"."payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant"."bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey"
  FOREIGN KEY ("statement_id") REFERENCES "tenant"."bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grants & RLS
GRANT SELECT, INSERT, UPDATE ON "tenant"."coa_accounts", "tenant"."financial_periods", "tenant"."budgets",
  "tenant"."expenses", "tenant"."payables", "tenant"."bank_statements", "tenant"."bank_statement_lines" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."budget_lines" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."payable_payments" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coa_accounts','financial_periods','budgets','budget_lines','expenses',
                           'payables','payable_payments','bank_statements','bank_statement_lines'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

CREATE TRIGGER payable_payments_append_only BEFORE UPDATE OR DELETE ON "tenant"."payable_payments"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

ALTER TABLE "tenant"."coa_accounts" ADD CONSTRAINT coa_accounts_type_check
  CHECK (type IN ('asset','liability','income','expense','equity'));
ALTER TABLE "tenant"."financial_periods" ADD CONSTRAINT financial_periods_check
  CHECK (status IN ('open','closed') AND ends_on >= starts_on);
ALTER TABLE "tenant"."budgets" ADD CONSTRAINT budgets_status_check
  CHECK (status IN ('draft','approved','archived'));
ALTER TABLE "tenant"."budget_lines" ADD CONSTRAINT budget_lines_amount_check
  CHECK (allocated_kobo >= 0);
ALTER TABLE "tenant"."expenses" ADD CONSTRAINT expenses_check
  CHECK (amount_kobo > 0 AND status IN ('draft','submitted','approved','posted','rejected'));
ALTER TABLE "tenant"."payables" ADD CONSTRAINT payables_check
  CHECK (amount_kobo > 0 AND amount_paid_kobo >= 0 AND amount_paid_kobo <= amount_kobo
         AND status IN ('draft','matched','approved','partially_paid','paid','void'));
ALTER TABLE "tenant"."payable_payments" ADD CONSTRAINT payable_payments_amount_check
  CHECK (amount_kobo > 0);
ALTER TABLE "tenant"."bank_statement_lines" ADD CONSTRAINT bank_statement_lines_check
  CHECK (amount_kobo > 0 AND direction IN ('credit','debit') AND status IN ('unmatched','matched','ignored'));

-- Enable Phase 5 modules on the free core plan (AGENTS.md §2.2).
UPDATE "platform"."plans"
   SET features = (
     SELECT ARRAY(
       SELECT DISTINCT f FROM unnest(features || ARRAY['accounting','procurement','workforce','governance','patrols','analytics']) AS f
     )
   )
 WHERE key = 'core';
