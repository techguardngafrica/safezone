-- Phase 5: Governance (governance.md, ADR-0026).

CREATE TABLE "tenant"."policies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "current_version_id" UUID,
    "requires_ack" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."policy_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" SMALLINT NOT NULL,
    "document_id" UUID,
    "summary" TEXT NOT NULL,
    "effective_on" DATE NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."policy_acknowledgements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."committee_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."meetings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "online_link" TEXT,
    "agenda" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "quorum_rule" SMALLINT NOT NULL DEFAULT 25,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notice_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."meeting_attendance" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "unit_id" UUID,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "proxy_for_user_id" UUID,

    CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."meeting_minutes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "document_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."meeting_action_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "owner_id" UUID,
    "due_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."motions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "meeting_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "eligibility" TEXT NOT NULL DEFAULT 'per_unit',
    "ballot" TEXT NOT NULL DEFAULT 'secret',
    "opens_at" TIMESTAMPTZ(3) NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "quorum_count" INTEGER NOT NULL DEFAULT 1,
    "threshold" TEXT NOT NULL DEFAULT 'simple',
    "custom_threshold_percent" SMALLINT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."motion_ballot_receipts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "motion_id" UUID NOT NULL,
    "voter_key" TEXT NOT NULL,
    "cast_by_user_id" UUID NOT NULL,
    "proxy_for_user_id" UUID,
    "cast_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motion_ballot_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."motion_votes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "motion_id" UUID NOT NULL,
    "option" TEXT NOT NULL,
    "voter_user_id" UUID,
    "unit_id" UUID,
    "cast_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motion_votes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."resolutions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "motion_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "adopted_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolutions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant"."governance_disputes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "estate_id" UUID NOT NULL,
    "party_user_ids" UUID[] NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "handler_id" UUID,
    "mediation_notes" TEXT,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policy_versions_policy_id_version_key" ON "tenant"."policy_versions"("policy_id", "version");
CREATE UNIQUE INDEX "policy_acknowledgements_policy_version_id_user_id_key" ON "tenant"."policy_acknowledgements"("policy_version_id", "user_id");
CREATE UNIQUE INDEX "meeting_attendance_meeting_id_user_id_key" ON "tenant"."meeting_attendance"("meeting_id", "user_id");
CREATE UNIQUE INDEX "meeting_minutes_meeting_id_key" ON "tenant"."meeting_minutes"("meeting_id");
CREATE UNIQUE INDEX "motion_ballot_receipts_motion_id_voter_key_key" ON "tenant"."motion_ballot_receipts"("motion_id", "voter_key");
CREATE INDEX "motion_votes_motion_id_idx" ON "tenant"."motion_votes"("motion_id");
CREATE UNIQUE INDEX "resolutions_motion_id_key" ON "tenant"."resolutions"("motion_id");

ALTER TABLE "tenant"."policy_versions" ADD CONSTRAINT "policy_versions_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "tenant"."policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id") REFERENCES "tenant"."policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_fkey"
  FOREIGN KEY ("meeting_id") REFERENCES "tenant"."meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_fkey"
  FOREIGN KEY ("meeting_id") REFERENCES "tenant"."meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_fkey"
  FOREIGN KEY ("meeting_id") REFERENCES "tenant"."meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."motion_ballot_receipts" ADD CONSTRAINT "motion_ballot_receipts_motion_id_fkey"
  FOREIGN KEY ("motion_id") REFERENCES "tenant"."motions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."motion_votes" ADD CONSTRAINT "motion_votes_motion_id_fkey"
  FOREIGN KEY ("motion_id") REFERENCES "tenant"."motions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant"."resolutions" ADD CONSTRAINT "resolutions_motion_id_fkey"
  FOREIGN KEY ("motion_id") REFERENCES "tenant"."motions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "tenant"."policies", "tenant"."policy_versions", "tenant"."committee_members",
  "tenant"."meetings", "tenant"."meeting_attendance", "tenant"."meeting_minutes", "tenant"."meeting_action_items",
  "tenant"."motions", "tenant"."governance_disputes" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."policy_acknowledgements", "tenant"."motion_ballot_receipts",
  "tenant"."motion_votes", "tenant"."resolutions" TO safezone_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policies','policy_versions','policy_acknowledgements','committee_members',
                           'meetings','meeting_attendance','meeting_minutes','meeting_action_items',
                           'motions','motion_ballot_receipts','motion_votes','resolutions','governance_disputes'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;

CREATE TRIGGER motion_votes_append_only BEFORE UPDATE OR DELETE ON "tenant"."motion_votes"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

ALTER TABLE "tenant"."policies" ADD CONSTRAINT policies_check
  CHECK (audience IN ('all','residents','owners','staff') AND status IN ('draft','published','archived'));
ALTER TABLE "tenant"."meetings" ADD CONSTRAINT meetings_check
  CHECK (type IN ('agm','egm','committee','town_hall') AND status IN ('scheduled','held','cancelled'));
ALTER TABLE "tenant"."meeting_minutes" ADD CONSTRAINT meeting_minutes_status_check
  CHECK (status IN ('draft','approved','published'));
ALTER TABLE "tenant"."motions" ADD CONSTRAINT motions_check
  CHECK (eligibility IN ('per_unit','per_owner','per_resident')
         AND ballot IN ('secret','open')
         AND threshold IN ('simple','two_thirds','custom')
         AND status IN ('draft','open','closed','passed','failed','void')
         AND closes_at > opens_at);
ALTER TABLE "tenant"."governance_disputes" ADD CONSTRAINT governance_disputes_status_check
  CHECK (status IN ('open','in_mediation','resolved','closed'));
