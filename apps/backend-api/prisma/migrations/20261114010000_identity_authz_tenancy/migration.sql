-- Identity, authz and tenancy core (Phase 0 tasks 5-7). ADR-0005 explains the module contexts.

-- AlterTable
ALTER TABLE "platform"."outbox_events" ADD COLUMN     "audit" JSONB;

-- CreateTable
CREATE TABLE "platform"."users" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(3),
    "email" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "full_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'active',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."otp_challenges" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "app" TEXT NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT,
    "app" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'totp',
    "secret_encrypted" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."roles" (
    "id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "estate_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "platform"."role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "estate_id" UUID,
    "scope_type" TEXT,
    "scope_id" UUID,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "reason" TEXT,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."estates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT,
    "state" TEXT,
    "lga" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "onboarding_mode" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL DEFAULT 'core',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "suspension_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "estates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."estate_memberships" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "estate_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."estate_settings" (
    "estate_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_settings_pkey" PRIMARY KEY ("estate_id","key")
);

-- CreateTable
CREATE TABLE "tenant"."entitlements" (
    "estate_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'override',
    "valid_to" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("estate_id","feature_key")
);

-- CreateTable
CREATE TABLE "platform"."plans" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "platform"."users"("phone_e164");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_e164_purpose_created_at_idx" ON "platform"."otp_challenges"("phone_e164", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "platform"."sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "platform"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "platform"."refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "platform"."user_devices"("user_id");

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_idx" ON "platform"."mfa_factors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_code_hash_key" ON "platform"."recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "platform"."recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_estate_id_key_key" ON "platform"."roles"("estate_id", "key");

-- CreateIndex
CREATE INDEX "role_assignments_user_id_revoked_at_idx" ON "platform"."role_assignments"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "role_assignments_estate_id_idx" ON "platform"."role_assignments"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "estates_slug_key" ON "platform"."estates"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "estates_code_key" ON "platform"."estates"("code");

-- CreateIndex
CREATE INDEX "estate_memberships_user_id_idx" ON "tenant"."estate_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "estate_memberships_estate_id_user_id_key" ON "tenant"."estate_memberships"("estate_id", "user_id");

-- AddForeignKey
ALTER TABLE "platform"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "platform"."user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "platform"."sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "platform"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "platform"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Built-in roles have estate_id NULL; make the (estate_id, key) pair unique for them too.
DROP INDEX "platform"."roles_estate_id_key_key";
CREATE UNIQUE INDEX "roles_estate_id_key_key" ON "platform"."roles"("estate_id", "key") NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- Hand-written: grants and row-level security.
-- app.context names the module doing platform-level work (withContext in DatabaseService). It stops
-- tenant code paths (withTenant) from touching platform tables by mistake; it is not a boundary against
-- code that already runs as safezone_app.
-- ---------------------------------------------------------------------------

-- identity -------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."users" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."otp_challenges" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."sessions" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."refresh_tokens" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."user_devices" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."mfa_factors" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."recovery_codes" TO safezone_app;

ALTER TABLE "platform"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."users" FORCE ROW LEVEL SECURITY;
CREATE POLICY users_identity ON "platform"."users" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity'
         OR id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.context', true) = 'identity');

ALTER TABLE "platform"."otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."otp_challenges" FORCE ROW LEVEL SECURITY;
CREATE POLICY otp_challenges_identity ON "platform"."otp_challenges" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity')
  WITH CHECK (current_setting('app.context', true) = 'identity');

ALTER TABLE "platform"."refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_identity ON "platform"."refresh_tokens" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity')
  WITH CHECK (current_setting('app.context', true) = 'identity');

-- Per-user tables: the identity module, or the signed-in owner reading their own rows.
ALTER TABLE "platform"."sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_identity ON "platform"."sessions" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity'
         OR user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.context', true) = 'identity');

ALTER TABLE "platform"."user_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."user_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_devices_identity ON "platform"."user_devices" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) IN ('identity', 'notifications')
         OR user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.context', true) = 'identity');

ALTER TABLE "platform"."mfa_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."mfa_factors" FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_factors_identity ON "platform"."mfa_factors" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity')
  WITH CHECK (current_setting('app.context', true) = 'identity');

ALTER TABLE "platform"."recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."recovery_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_codes_identity ON "platform"."recovery_codes" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'identity')
  WITH CHECK (current_setting('app.context', true) = 'identity');

-- authz ----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."roles" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "platform"."role_permissions" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."role_assignments" TO safezone_app;

-- Role definitions are not personal data: readable everywhere; written only by the authz module.
ALTER TABLE "platform"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_read ON "platform"."roles" FOR SELECT TO safezone_app USING (true);
CREATE POLICY roles_write ON "platform"."roles" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'authz');
CREATE POLICY roles_update ON "platform"."roles" FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'authz')
  WITH CHECK (current_setting('app.context', true) = 'authz');

ALTER TABLE "platform"."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_read ON "platform"."role_permissions" FOR SELECT TO safezone_app USING (true);
CREATE POLICY role_permissions_insert ON "platform"."role_permissions" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'authz');
CREATE POLICY role_permissions_delete ON "platform"."role_permissions" FOR DELETE TO safezone_app
  USING (current_setting('app.context', true) = 'authz');

-- Assignments: the authz module, the user's own, or those of the current estate.
ALTER TABLE "platform"."role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."role_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY role_assignments_read ON "platform"."role_assignments" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'authz'
         OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
         OR estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);
CREATE POLICY role_assignments_insert ON "platform"."role_assignments" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'authz');
CREATE POLICY role_assignments_update ON "platform"."role_assignments" FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'authz')
  WITH CHECK (current_setting('app.context', true) = 'authz');

-- tenancy --------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "platform"."estates" TO safezone_app;
GRANT SELECT ON "platform"."plans" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."estate_memberships" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."estate_settings" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."entitlements" TO safezone_app;

ALTER TABLE "platform"."estates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."estates" FORCE ROW LEVEL SECURITY;
CREATE POLICY estates_read ON "platform"."estates" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy'
         OR id = nullif(current_setting('app.estate_id', true), '')::uuid);
CREATE POLICY estates_insert ON "platform"."estates" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'tenancy');
CREATE POLICY estates_update ON "platform"."estates" FOR UPDATE TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy'
         OR id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (current_setting('app.context', true) = 'tenancy'
         OR id = nullif(current_setting('app.estate_id', true), '')::uuid);

ALTER TABLE "platform"."plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON "platform"."plans" FOR SELECT TO safezone_app USING (true);

ALTER TABLE "tenant"."estate_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."estate_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_memberships_tenant ON "tenant"."estate_memberships" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid
         OR current_setting('app.context', true) = 'tenancy')
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid
         OR current_setting('app.context', true) = 'tenancy');
-- A signed-in user may list their own memberships across estates (GET /v1/me/memberships).
CREATE POLICY estate_memberships_own ON "tenant"."estate_memberships" FOR SELECT TO safezone_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE "tenant"."estate_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."estate_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_settings_tenant ON "tenant"."estate_settings" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

ALTER TABLE "tenant"."entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."entitlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY entitlements_tenant ON "tenant"."entitlements" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid);

-- audit consumer -------------------------------------------------------------
-- The audit consumer (worker) writes every stream, including platform-level rows (estate_id NULL),
-- and reads the previous hash of a stream to extend the chain.
CREATE POLICY audit_events_consumer_select ON "audit"."audit_events" FOR SELECT TO safezone_app
  USING (current_setting('app.context', true) = 'audit');
CREATE POLICY audit_events_consumer_insert ON "audit"."audit_events" FOR INSERT TO safezone_app
  WITH CHECK (current_setting('app.context', true) = 'audit');

-- Plans framework: every estate is on the free core plan at launch (no pricing).
INSERT INTO "platform"."plans" ("key", "name", "features")
VALUES ('core', 'Core (free)', ARRAY[
  'visitors', 'security', 'emergency', 'announcements', 'property', 'occupancy',
  'billing', 'payments', 'maintenance', 'community', 'facilities', 'documents'
]);
