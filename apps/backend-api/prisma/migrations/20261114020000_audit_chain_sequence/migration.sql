-- Audit hash chain ordering (Phase 0 task 8).
-- AlterTable
ALTER TABLE "audit"."audit_events" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "audit_events_estate_id_seq_idx" ON "audit"."audit_events"("estate_id", "seq");


-- The audit consumer inserts as safezone_app, so it needs the sequence behind seq.
GRANT USAGE ON SEQUENCE "audit"."audit_events_seq_seq" TO safezone_app;
