-- Platform Finance Officers list payment transactions across estates (super-admin.md §6.7, ADR-0022).
-- The tenant policy on payment_transactions only admits app.estate_id, so the cross-estate list
-- returned nothing. This adds a read-only policy for the dedicated platform_finance context;
-- no write path uses that context.
CREATE POLICY payment_transactions_platform_finance_read ON "tenant"."payment_transactions"
  FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'platform_finance');
