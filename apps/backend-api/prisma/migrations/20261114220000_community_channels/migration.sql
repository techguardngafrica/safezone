-- Community channels, messages, moderation and polls (community.md, Phase 3; ADR-0015).
-- CreateTable
CREATE TABLE "tenant"."channels" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "space_id" UUID,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'active',
    "staff_only" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMPTZ(3),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."channel_members" (
    "estate_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notify" TEXT NOT NULL DEFAULT 'all',
    "muted_until" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channel_id","user_id")
);

-- CreateTable
CREATE TABLE "tenant"."messages" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "reply_to_id" UUID,
    "attachment_file_ids" UUID[],
    "mention_user_ids" UUID[],
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "removed_by_moderation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."message_reactions" (
    "estate_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id","user_id","emoji")
);

-- CreateTable
CREATE TABLE "tenant"."user_blocks" (
    "estate_id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("estate_id","blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "tenant"."community_profiles" (
    "estate_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guidelines_accepted_at" TIMESTAMPTZ(3),
    "muted_until" TIMESTAMPTZ(3),
    "banned_until" TIMESTAMPTZ(3),
    "warnings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "community_profiles_pkey" PRIMARY KEY ("estate_id","user_id")
);

-- CreateTable
CREATE TABLE "tenant"."community_reports" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "reported_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."moderation_actions" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "subject_user_id" UUID,
    "channel_id" UUID,
    "reason" TEXT NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "moderator_id" UUID NOT NULL,
    "report_id" UUID,
    "appeal_status" TEXT NOT NULL DEFAULT 'none',
    "appeal_statement" TEXT,
    "appeal_decided_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."polls" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "vote_per" TEXT NOT NULL DEFAULT 'user',
    "audience_type" TEXT NOT NULL,
    "audience_unit_ids" UUID[],
    "created_by" UUID NOT NULL,
    "closed_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."poll_options" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant"."poll_votes" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "voter_key" TEXT NOT NULL,
    "voted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channels_estate_id_type_status_idx" ON "tenant"."channels"("estate_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channels_estate_id_type_key_key" ON "tenant"."channels"("estate_id", "type", "key");

-- CreateIndex
CREATE INDEX "channel_members_estate_id_user_id_status_idx" ON "tenant"."channel_members"("estate_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "messages_channel_id_created_at_idx" ON "tenant"."messages"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_estate_id_author_id_idx" ON "tenant"."messages"("estate_id", "author_id");

-- CreateIndex
CREATE INDEX "community_reports_estate_id_status_created_at_idx" ON "tenant"."community_reports"("estate_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "community_reports_target_type_target_id_reported_by_key" ON "tenant"."community_reports"("target_type", "target_id", "reported_by");

-- CreateIndex
CREATE INDEX "moderation_actions_estate_id_created_at_idx" ON "tenant"."moderation_actions"("estate_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_estate_id_subject_user_id_idx" ON "tenant"."moderation_actions"("estate_id", "subject_user_id");

-- CreateIndex
CREATE INDEX "polls_estate_id_closes_at_idx" ON "tenant"."polls"("estate_id", "closes_at");

-- CreateIndex
CREATE INDEX "poll_options_poll_id_idx" ON "tenant"."poll_options"("poll_id");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_poll_id_voter_key_key" ON "tenant"."poll_votes"("poll_id", "voter_key");

-- AddForeignKey
ALTER TABLE "tenant"."poll_options" ADD CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "tenant"."polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: grants and row-level security. Moderation actions and votes are append-only records.
GRANT SELECT, INSERT, UPDATE ON "tenant"."channels" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."channel_members" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."messages" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "tenant"."message_reactions" TO safezone_app;
GRANT SELECT, INSERT, DELETE ON "tenant"."user_blocks" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."community_profiles" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."community_reports" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."moderation_actions" TO safezone_app;
GRANT SELECT, INSERT, UPDATE ON "tenant"."polls" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."poll_options" TO safezone_app;
GRANT SELECT, INSERT ON "tenant"."poll_votes" TO safezone_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels','channel_members','messages','message_reactions','user_blocks',
                           'community_profiles','community_reports','moderation_actions','polls',
                           'poll_options','poll_votes'] LOOP
    EXECUTE format('ALTER TABLE "tenant".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "tenant".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON "tenant".%I FOR ALL TO safezone_app
      USING (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)
      WITH CHECK (estate_id = nullif(current_setting('app.estate_id', true), '')::uuid)$p$, t || '_tenant', t);
  END LOOP;
END $$;
-- Removed messages keep their content for audit (community.md rule 7): messages are never deleted.
CREATE TRIGGER messages_no_delete BEFORE DELETE ON "tenant"."messages"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER poll_votes_append_only BEFORE UPDATE OR DELETE ON "tenant"."poll_votes"
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE INDEX messages_body_search ON "tenant"."messages" USING gin (to_tsvector('simple', body));
