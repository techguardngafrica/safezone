-- Notifications core (Phase 0 task 9).
-- CreateTable
CREATE TABLE "platform"."notifications" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "user_id" UUID NOT NULL,
    "intent_key" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_ref" TEXT,
    "error" TEXT,
    "cost_kobo" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "app" TEXT NOT NULL,
    "expo_token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalid_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "platform"."notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "platform"."notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "platform"."notification_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_channel_status_sent_at_idx" ON "platform"."notification_deliveries"("channel", "status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_expo_token_key" ON "platform"."push_tokens"("expo_token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "platform"."push_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "platform"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "platform"."notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."push_tokens" ADD CONSTRAINT "push_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "platform"."user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: grants and row-level security.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."notifications" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."notification_deliveries" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."push_tokens" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."notification_preferences" TO safezone_app;

-- Recipients read and mark their own notifications; the notifications module writes them.
ALTER TABLE "platform"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_module ON "platform"."notifications" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'notifications')
  WITH CHECK (current_setting('app.context', true) = 'notifications');
CREATE POLICY notifications_own_read ON "platform"."notifications" FOR SELECT TO safezone_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY notifications_own_mark_read ON "platform"."notifications" FOR UPDATE TO safezone_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE "platform"."notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_module ON "platform"."notification_deliveries" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'notifications')
  WITH CHECK (current_setting('app.context', true) = 'notifications');

ALTER TABLE "platform"."push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."push_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY push_tokens_module ON "platform"."push_tokens" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'notifications')
  WITH CHECK (current_setting('app.context', true) = 'notifications');

ALTER TABLE "platform"."notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_module ON "platform"."notification_preferences" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'notifications'
         OR user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.context', true) = 'notifications'
         OR user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Recipients' phone numbers for SMS: the notifications worker reads users in its own context.
CREATE POLICY users_notifications_read ON "platform"."users" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'notifications');
