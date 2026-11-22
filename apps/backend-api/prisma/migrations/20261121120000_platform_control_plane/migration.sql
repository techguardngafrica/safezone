-- Platform control plane tables: support tickets, DSRs, breach log, retention rules (ADR-0022).
-- Also allows platform_config context to list tenant.support_sessions read-only.

-- CreateTable
CREATE TABLE "platform"."support_tickets" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "requester_user_id" UUID,
    "requester_name" TEXT,
    "requester_contact" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "category" TEXT NOT NULL DEFAULT 'technical',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignee_id" UUID,
    "sla_due_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."support_ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."data_subject_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "subject_name" TEXT NOT NULL,
    "subject_contact" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "notes" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "identity_checked_by" UUID,
    "identity_checked_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."breach_log" (
    "id" UUID NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "affected_estates" INTEGER NOT NULL DEFAULT 0,
    "affected_count" INTEGER NOT NULL DEFAULT 0,
    "ndpc_notified_at" TIMESTAMPTZ(3),
    "subjects_notified_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breach_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."retention_rules" (
    "data_type" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_rules_pkey" PRIMARY KEY ("data_type")
);

-- AddForeignKey
ALTER TABLE "platform"."support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "platform"."support_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_at_idx" ON "platform"."support_tickets"("status", "priority", "created_at");
CREATE INDEX "support_tickets_estate_id_created_at_idx" ON "platform"."support_tickets"("estate_id", "created_at");
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "platform"."support_ticket_messages"("ticket_id", "created_at");
CREATE INDEX "data_subject_requests_status_due_at_idx" ON "platform"."data_subject_requests"("status", "due_at");
CREATE INDEX "breach_log_status_detected_at_idx" ON "platform"."breach_log"("status", "detected_at");

-- Hand-written: grants, row-level security and checks.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets','support_ticket_messages','data_subject_requests','breach_log','retention_rules'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON "platform".%I TO safezone_app', t);
    EXECUTE format('ALTER TABLE "platform".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "platform".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "platform".%I FOR ALL TO safezone_app
      USING (current_setting('app.context', true) = 'platform_config')
      WITH CHECK (current_setting('app.context', true) = 'platform_config')$p$, t || '_platform', t);
  END LOOP;
END $$;

-- Platform support staff can list support sessions across estates (read-only).
CREATE POLICY support_sessions_platform_read ON "tenant"."support_sessions" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'platform_config');

ALTER TABLE "platform"."support_tickets" ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('new','open','pending_customer','resolved','closed'));
ALTER TABLE "platform"."support_tickets" ADD CONSTRAINT support_tickets_priority_check
  CHECK (priority IN ('critical','high','normal','low'));
ALTER TABLE "platform"."data_subject_requests" ADD CONSTRAINT data_subject_requests_type_check
  CHECK (type IN ('access','correction','deletion','export','objection'));
ALTER TABLE "platform"."data_subject_requests" ADD CONSTRAINT data_subject_requests_status_check
  CHECK (status IN ('received','identity_verified','in_progress','completed','rejected'));
ALTER TABLE "platform"."breach_log" ADD CONSTRAINT breach_log_severity_check
  CHECK (severity IN ('low','medium','high','critical'));
ALTER TABLE "platform"."breach_log" ADD CONSTRAINT breach_log_status_check
  CHECK (status IN ('investigating','contained','notified','closed'));
ALTER TABLE "platform"."retention_rules" ADD CONSTRAINT retention_rules_action_check
  CHECK (action IN ('delete','anonymise','archive'));
