-- The aggregator request id of an airtime or data purchase, kept across retries and requeries (ADR-0025).
ALTER TABLE "tenant"."topup_purchases" ADD COLUMN "request_id" TEXT;
ALTER TABLE "tenant"."topup_purchases" ADD COLUMN "alerted_at" TIMESTAMPTZ(3);
