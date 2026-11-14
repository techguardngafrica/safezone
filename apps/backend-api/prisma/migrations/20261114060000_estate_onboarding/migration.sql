-- CreateTable
CREATE TABLE "platform"."estate_applications" (
    "id" UUID NOT NULL,
    "applicant_user_id" UUID NOT NULL,
    "representative_name" TEXT NOT NULL,
    "representative_email" TEXT NOT NULL,
    "representative_role" TEXT NOT NULL,
    "estate_name" TEXT NOT NULL,
    "estate_type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "units_estimate" INTEGER NOT NULL,
    "gates_estimate" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reviewer_id" UUID,
    "decision_reason" TEXT,
    "estate_id" UUID,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "estate_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."estate_application_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL DEFAULT 'proof_of_authority',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."onboarding_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "estate_name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "units_estimate" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "owner_user_id" UUID,
    "estate_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "onboarding_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."estate_invitations" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "role_key" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estate_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."estate_setup_progress" (
    "estate_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" UUID,

    CONSTRAINT "estate_setup_progress_pkey" PRIMARY KEY ("estate_id","step")
);

-- CreateTable
CREATE TABLE "platform"."contact_deliveries" (
    "id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "intent_key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "provider_ref" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estate_applications_estate_id_key" ON "platform"."estate_applications"("estate_id");

-- CreateIndex
CREATE INDEX "estate_applications_applicant_user_id_idx" ON "platform"."estate_applications"("applicant_user_id");

-- CreateIndex
CREATE INDEX "estate_applications_status_submitted_at_idx" ON "platform"."estate_applications"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "estate_application_documents_application_id_file_id_key" ON "platform"."estate_application_documents"("application_id", "file_id");

-- CreateIndex
CREATE INDEX "onboarding_leads_status_created_at_idx" ON "platform"."onboarding_leads"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "estate_invitations_token_hash_key" ON "platform"."estate_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "estate_invitations_estate_id_idx" ON "platform"."estate_invitations"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_deliveries_dedupe_key_channel_key" ON "platform"."contact_deliveries"("dedupe_key", "channel");

-- AddForeignKey
ALTER TABLE "platform"."estate_application_documents" ADD CONSTRAINT "estate_application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "platform"."estate_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: grants and row-level security (ADR-0005). Onboarding rows are reached only through the
-- tenancy module context; setup progress is also visible inside its own estate.
GRANT SELECT, INSERT, UPDATE ON "platform"."estate_applications" TO safezone_app;
GRANT SELECT, INSERT ON "platform"."estate_application_documents" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."onboarding_leads" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."estate_invitations" TO safezone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant"."estate_setup_progress" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "platform"."contact_deliveries" TO safezone_app;

ALTER TABLE "platform"."estate_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."estate_applications" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_applications_tenancy ON "platform"."estate_applications" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy')
  WITH CHECK (current_setting('app.context', true) = 'tenancy');

ALTER TABLE "platform"."estate_application_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."estate_application_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_application_documents_tenancy ON "platform"."estate_application_documents" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy')
  WITH CHECK (current_setting('app.context', true) = 'tenancy');

ALTER TABLE "platform"."onboarding_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."onboarding_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_leads_tenancy ON "platform"."onboarding_leads" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy')
  WITH CHECK (current_setting('app.context', true) = 'tenancy');

ALTER TABLE "platform"."estate_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."estate_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_invitations_tenancy ON "platform"."estate_invitations" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'tenancy')
  WITH CHECK (current_setting('app.context', true) = 'tenancy');

ALTER TABLE "tenant"."estate_setup_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant"."estate_setup_progress" FORCE ROW LEVEL SECURITY;
CREATE POLICY estate_setup_progress_tenant ON "tenant"."estate_setup_progress" FOR ALL TO safezone_app
  USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid
         OR current_setting('app.context', true) = 'tenancy')
  WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid
         OR current_setting('app.context', true) = 'tenancy');

ALTER TABLE "platform"."contact_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."contact_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_deliveries_notifications ON "platform"."contact_deliveries" FOR ALL TO safezone_app
  USING (current_setting('app.context', true) = 'notifications')
  WITH CHECK (current_setting('app.context', true) = 'notifications');

-- Application documents are evidence: never edited or removed.
CREATE TRIGGER estate_application_documents_append_only
  BEFORE UPDATE OR DELETE ON "platform"."estate_application_documents"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
