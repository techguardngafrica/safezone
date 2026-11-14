-- Billing jobs (ADR-0012 amendment): late penalties as separate invoices, overdue tracking.
-- AlterTable
ALTER TABLE "tenant"."charges" ADD COLUMN     "penalty_rule" JSONB;

-- AlterTable
ALTER TABLE "tenant"."invoices" ADD COLUMN     "overdue_at" TIMESTAMPTZ(3),
ADD COLUMN     "penalty_for_invoice_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_penalty_for_invoice_id_key" ON "tenant"."invoices"("penalty_for_invoice_id");


-- Hand-written: the penalty link is part of an invoice's immutable terms.
CREATE OR REPLACE FUNCTION tenant.invoices_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.estate_id, NEW.number, NEW.space_id, NEW.household_id, NEW.payer_user_id, NEW.payer_type,
      NEW.billing_run_id, NEW.penalty_for_invoice_id, NEW.description, NEW.issue_date, NEW.due_date,
      NEW.currency, NEW.subtotal, NEW.total, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.estate_id, OLD.number, OLD.space_id, OLD.household_id, OLD.payer_user_id, OLD.payer_type,
      OLD.billing_run_id, OLD.penalty_for_invoice_id, OLD.description, OLD.issue_date, OLD.due_date,
      OLD.currency, OLD.subtotal, OLD.total, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'issued invoice terms are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.amount_paid < OLD.amount_paid OR NEW.amount_credited < OLD.amount_credited
     OR NEW.amount_waived < OLD.amount_waived THEN
    RAISE EXCEPTION 'invoice payments, credits and waivers only grow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.overdue_at IS NOT NULL AND NEW.overdue_at IS DISTINCT FROM OLD.overdue_at THEN
    RAISE EXCEPTION 'overdue_at is set once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
