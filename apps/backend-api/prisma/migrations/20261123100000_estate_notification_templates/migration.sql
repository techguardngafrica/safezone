-- Estate notification template overrides (notifications.md §7, management-web.md §6.13).
CREATE TABLE "tenant"."estate_notification_templates" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "intent_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sms_body" TEXT,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "estate_notification_templates_estate_id_intent_key_key"
  ON "tenant"."estate_notification_templates"("estate_id", "intent_key");

CREATE INDEX "estate_notification_templates_estate_id_idx"
  ON "tenant"."estate_notification_templates"("estate_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."estate_notification_templates" TO safezone_app;

ALTER TABLE "tenant"."estate_notification_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."estate_notification_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY estate_notification_templates_tenant ON "tenant"."estate_notification_templates" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

CREATE POLICY estate_notification_templates_worker ON "tenant"."estate_notification_templates" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'notifications');
