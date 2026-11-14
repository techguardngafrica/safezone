-- Billing core (billing.md, Phase 2; ADR-0012): charges, billing runs, invoices, credit notes, waivers,
-- allocations and the double-entry ledger.
-- CreateTable
CREATE TABLE "tenant"."charges" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount_rule" JSONB NOT NULL,
    "frequency" TEXT NOT NULL,
    "payer" TEXT NOT NULL DEFAULT 'occupant',
    "applies_to" JSONB NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."billing_runs" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "charge_ids" UUID[],
    "charge_versions" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "invoice_count" INTEGER,
    "total_amount" BIGINT,
    "skipped_units" INTEGER,
    "approval_required" BOOLEAN,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "created_by" UUID NOT NULL,
    "submitted_by" UUID,
    "approved_by" UUID,
    "issued_by" UUID,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "previewed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "issued_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."billing_run_items" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "billing_run_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "household_id" UUID,
    "payer_user_id" UUID,
    "payer_name" TEXT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "skip_reason" TEXT,
    "invoice_id" UUID,

    CONSTRAINT "billing_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."invoice_counters" (
    "estate_id" UUID NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("estate_id")
);

-- CreateTable
CREATE TABLE "tenant"."invoices" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "space_id" UUID NOT NULL,
    "household_id" UUID,
    "payer_user_id" UUID NOT NULL,
    "payer_type" TEXT NOT NULL,
    "billing_run_id" UUID,
    "description" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotal" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "amount_credited" BIGINT NOT NULL DEFAULT 0,
    "amount_waived" BIGINT NOT NULL DEFAULT 0,
    "balance" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."invoice_lines" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "charge_id" UUID,
    "charge_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_amount" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."credit_notes" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."waivers" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decision_reason" TEXT,
    "journal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "waivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."allocations" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "journal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."ledger_accounts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "party_user_id" UUID,
    "space_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."journals" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reference" TEXT,
    "posted_by" UUID,
    "reverses_journal_id" UUID,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."ledger_entries" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "charges_estate_id_status_idx" ON "tenant"."charges"("estate_id", "status");

-- CreateIndex
CREATE INDEX "billing_runs_estate_id_status_created_at_idx" ON "tenant"."billing_runs"("estate_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "billing_run_items_estate_id_idx" ON "tenant"."billing_run_items"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_run_items_billing_run_id_space_id_key" ON "tenant"."billing_run_items"("billing_run_id", "space_id");

-- CreateIndex
CREATE INDEX "invoices_estate_id_status_due_date_idx" ON "tenant"."invoices"("estate_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "invoices_estate_id_payer_user_id_issue_date_idx" ON "tenant"."invoices"("estate_id", "payer_user_id", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_estate_id_space_id_issue_date_idx" ON "tenant"."invoices"("estate_id", "space_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_estate_id_number_key" ON "tenant"."invoices"("estate_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_billing_run_id_space_id_key" ON "tenant"."invoices"("billing_run_id", "space_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "tenant"."invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_estate_id_invoice_id_idx" ON "tenant"."credit_notes"("estate_id", "invoice_id");

-- CreateIndex
CREATE INDEX "waivers_estate_id_status_idx" ON "tenant"."waivers"("estate_id", "status");

-- CreateIndex
CREATE INDEX "waivers_invoice_id_idx" ON "tenant"."waivers"("invoice_id");

-- CreateIndex
CREATE INDEX "allocations_estate_id_invoice_id_idx" ON "tenant"."allocations"("estate_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocations_source_type_source_id_invoice_id_key" ON "tenant"."allocations"("source_type", "source_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_estate_id_party_user_id_idx" ON "tenant"."ledger_accounts"("estate_id", "party_user_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_estate_id_space_id_idx" ON "tenant"."ledger_accounts"("estate_id", "space_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_estate_id_code_key" ON "tenant"."ledger_accounts"("estate_id", "code");

-- CreateIndex
CREATE INDEX "journals_estate_id_source_type_source_id_idx" ON "tenant"."journals"("estate_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "journals_estate_id_posted_at_idx" ON "tenant"."journals"("estate_id", "posted_at");

-- CreateIndex
CREATE INDEX "ledger_entries_journal_id_idx" ON "tenant"."ledger_entries"("journal_id");

-- CreateIndex
CREATE INDEX "ledger_entries_estate_id_account_id_occurred_at_idx" ON "tenant"."ledger_entries"("estate_id", "account_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "tenant"."billing_run_items" ADD CONSTRAINT "billing_run_items_billing_run_id_fkey" FOREIGN KEY ("billing_run_id") REFERENCES "tenant"."billing_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tenant"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tenant"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."waivers" ADD CONSTRAINT "waivers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tenant"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."allocations" ADD CONSTRAINT "allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tenant"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "tenant"."journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tenant"."ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written: grants, row-level security, money checks and append-only enforcement.
GRANT SELECT, INSERT, UPDATE ON "tenant"."charges" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."billing_runs" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."billing_run_items" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."invoice_counters" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."invoices" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."waivers" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."invoice_lines" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."credit_notes" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."allocations" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."ledger_accounts" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."journals" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."ledger_entries" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['charges','billing_runs','billing_run_items','invoice_counters','invoices',
                           'invoice_lines','credit_notes','waivers','allocations','ledger_accounts',
                           'journals','ledger_entries'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

-- Money is never negative, and an invoice's balance always equals what is left of its total.
ALTER TABLE "tenant"."invoices"
  ADD CONSTRAINT invoices_money_check CHECK (
    subtotal >= 0 AND total >= 0 AND amount_paid >= 0 AND amount_credited >= 0 AND amount_waived >= 0
    AND balance >= 0 AND balance = total - amount_paid - amount_credited - amount_waived),
  ADD CONSTRAINT invoices_currency_check CHECK (currency = 'NGN'),
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('issued','partially_paid','paid','waived','cancelled'));
ALTER TABLE "tenant"."invoice_lines" ADD CONSTRAINT invoice_lines_money_check
  CHECK (unit_amount >= 0 AND amount >= 0 AND quantity > 0);
ALTER TABLE "tenant"."credit_notes" ADD CONSTRAINT credit_notes_amount_check CHECK (amount > 0);
ALTER TABLE "tenant"."waivers" ADD CONSTRAINT waivers_amount_check CHECK (amount > 0);
ALTER TABLE "tenant"."allocations" ADD CONSTRAINT allocations_amount_check CHECK (amount > 0);
ALTER TABLE "tenant"."billing_run_items" ADD CONSTRAINT billing_run_items_amount_check CHECK (amount >= 0);
ALTER TABLE "tenant"."ledger_entries" ADD CONSTRAINT ledger_entries_side_check
  CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0));
ALTER TABLE "tenant"."ledger_accounts" ADD CONSTRAINT ledger_accounts_type_check
  CHECK (type IN ('asset','liability','income','expense','equity'));

-- Issued invoice terms are immutable (billing.md rule 1): only payment, credit, waiver and status
-- columns may change, and only through the billing service.
CREATE FUNCTION tenant.invoices_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.estate_id, NEW.number, NEW.space_id, NEW.household_id, NEW.payer_user_id, NEW.payer_type,
      NEW.billing_run_id, NEW.description, NEW.issue_date, NEW.due_date, NEW.currency, NEW.subtotal,
      NEW.total, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.estate_id, OLD.number, OLD.space_id, OLD.household_id, OLD.payer_user_id, OLD.payer_type,
      OLD.billing_run_id, OLD.description, OLD.issue_date, OLD.due_date, OLD.currency, OLD.subtotal,
      OLD.total, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'issued invoice terms are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.amount_paid < OLD.amount_paid OR NEW.amount_credited < OLD.amount_credited
     OR NEW.amount_waived < OLD.amount_waived THEN
    RAISE EXCEPTION 'invoice payments, credits and waivers only grow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_terms_immutable BEFORE UPDATE ON "tenant"."invoices"
  FOR EACH ROW EXECUTE FUNCTION tenant.invoices_terms_immutable();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON "tenant"."invoices"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

-- Financial records are append-only (AGENTS.md §5.4). Corrections are new records.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_lines','credit_notes','allocations','ledger_accounts','journals',
                           'ledger_entries'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON "tenant".%I
      FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation()', t || '_append_only', t);
  END LOOP;
END $$;

-- Every journal balances (billing.md rule 2): checked at commit, so a journal's lines can be inserted
-- one by one inside the transaction. A journal must have lines, and lines must belong to its estate.
CREATE FUNCTION tenant.ledger_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  lines int;
  difference numeric;
  mismatched int;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN
    target := NEW.id;
  ELSE
    target := NEW.journal_id;
  END IF;
  SELECT count(*), coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0),
         count(*) FILTER (WHERE e.estate_id <> j.estate_id OR a.estate_id <> j.estate_id)
    INTO lines, difference, mismatched
    FROM "tenant"."journals" j
    LEFT JOIN "tenant"."ledger_entries" e ON e.journal_id = j.id
    LEFT JOIN "tenant"."ledger_accounts" a ON a.id = e.account_id
   WHERE j.id = target;
  IF lines < 2 THEN
    RAISE EXCEPTION 'journal % has fewer than two lines', target USING ERRCODE = 'check_violation';
  END IF;
  IF difference <> 0 THEN
    RAISE EXCEPTION 'journal % does not balance', target USING ERRCODE = 'check_violation';
  END IF;
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'journal % mixes estates', target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journals_balanced AFTER INSERT ON "tenant"."journals"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tenant.ledger_journal_balanced();
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON "tenant"."ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tenant.ledger_journal_balanced();
