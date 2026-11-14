import { z } from 'zod';

/** Channels, messages, moderation and polls (community.md §2.4–2.18, Phase 3). */
export const channelTypeSchema = z.enum(['building', 'estate', 'resident', 'direct']);
export const channelPrivacySchema = z.enum(['public', 'restricted', 'invite_only']);
export const channelStatusSchema = z.enum(['pending_approval', 'active', 'suspended', 'archived']);

export const DEFAULT_ESTATE_CHANNELS = [
  { key: 'general', name: 'General', staffOnly: false },
  { key: 'security_updates', name: 'Security Updates', staffOnly: true },
  { key: 'events', name: 'Events and Activities', staffOnly: false },
  { key: 'suggestions', name: 'Suggestions', staffOnly: false },
  { key: 'management', name: 'Management Announcements', staffOnly: true },
  { key: 'support', name: 'Community Support', staffOnly: false },
  { key: 'buy_and_sell', name: 'Buy and Sell', staffOnly: false },
] as const;

export const createChannelSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(40).optional(),
  privacy: channelPrivacySchema.default('public'),
});

export const channelSchema = z.object({
  id: z.uuid(),
  type: channelTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  privacy: channelPrivacySchema,
  status: channelStatusSchema,
  /** Only staff may post (official estate channels). */
  staffOnly: z.boolean(),
  spaceId: z.uuid().nullable(),
  memberCount: z.number().int().nullable(),
  myRole: z.enum(['owner', 'moderator', 'member']).nullable(),
  myStatus: z.enum(['active', 'requested', 'invited']).nullable(),
  notify: z.enum(['all', 'mentions', 'none']).nullable(),
  createdAt: z.iso.datetime(),
});
export const channelListQuerySchema = z.object({
  /** Only channels I belong to (default); false lists public resident channels to join. */
  mine: z.stringbool().default(true),
});
export const channelMemberParamsSchema = z.object({
  estateId: z.uuid(),
  id: z.uuid(),
  userId: z.uuid(),
});
export const inviteMemberSchema = z.object({ userId: z.uuid() });
export const channelPreferencesSchema = z.object({ notify: z.enum(['all', 'mentions', 'none']) });
export const channelReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToId: z.uuid().optional(),
  attachmentFileIds: z.array(z.uuid()).max(10).default([]),
  mentionUserIds: z.array(z.uuid()).max(20).default([]),
});
export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(16) });

export const messageSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  authorId: z.uuid(),
  authorName: z.string().nullable(),
  /** Null when deleted or removed (rule 7 shows a placeholder instead). */
  body: z.string().nullable(),
  replyToId: z.uuid().nullable(),
  attachmentFileIds: z.array(z.uuid()),
  mentionUserIds: z.array(z.uuid()),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number().int(), mine: z.boolean() })),
  state: z.enum(['visible', 'deleted', 'removed']),
  editedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  q: z.string().trim().min(2).max(100).optional(),
});

export const startDirectSchema = z.object({ userId: z.uuid() });
export const blockUserSchema = z.object({ userId: z.uuid() });

export const reportTargetSchema = z.enum(['message', 'channel', 'user']);
export const createReportSchema = z.object({
  targetType: reportTargetSchema,
  targetId: z.uuid(),
  reason: z.enum(['spam', 'harassment', 'hate', 'violence', 'scam', 'privacy', 'other']),
  details: z.string().trim().max(1000).optional(),
});
export const reportSchema = z.object({
  id: z.uuid(),
  targetType: reportTargetSchema,
  targetId: z.uuid(),
  reason: z.string(),
  details: z.string().nullable(),
  status: z.enum(['open', 'actioned', 'dismissed']),
  reportedBy: z.uuid(),
  /** Moderators see a preview of a reported message. */
  preview: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const moderationQueueQuerySchema = z.object({
  status: z.enum(['open', 'actioned', 'dismissed']).default('open'),
});

export const moderationActionTypeSchema = z.enum([
  'remove_message',
  'warn',
  'mute',
  'remove_from_channel',
  'suspend_channel',
  'ban',
  'dismiss_report',
]);
export const createModerationActionSchema = z.object({
  action: moderationActionTypeSchema,
  targetType: reportTargetSchema,
  targetId: z.uuid(),
  /** For remove_from_channel: which channel. */
  channelId: z.uuid().optional(),
  reason: z.string().trim().min(3).max(500),
  /** Mute and ban length; omitted ban is permanent. */
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
  reportId: z.uuid().optional(),
});
export const moderationActionSchema = z.object({
  id: z.uuid(),
  action: moderationActionTypeSchema,
  targetType: reportTargetSchema,
  targetId: z.uuid(),
  reason: z.string(),
  endsAt: z.iso.datetime().nullable(),
  moderatorId: z.uuid(),
  appealStatus: z.enum(['none', 'pending', 'upheld', 'overturned']),
  createdAt: z.iso.datetime(),
});
export const appealSchema = z.object({ statement: z.string().trim().min(3).max(1000) });
export const appealDecisionSchema = z.object({
  decision: z.enum(['upheld', 'overturned']),
  note: z.string().trim().max(500).optional(),
});
export const moderationActionParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });

export const createPollSchema = z
  .object({
    question: z.string().trim().min(5).max(300),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
    closesAt: z.iso.datetime({ offset: true }),
    anonymous: z.boolean().default(false),
    votePer: z.enum(['user', 'household']).default('user'),
    audience: z.discriminatedUnion('type', [
      z.object({ type: z.literal('estate') }),
      z.object({ type: z.literal('spaces'), spaceIds: z.array(z.uuid()).min(1).max(100) }),
    ]),
  })
  .refine(
    (value) => new Set(value.options.map((o) => o.toLowerCase())).size === value.options.length,
    {
      message: 'Options must be different',
      path: ['options'],
    },
  );
export const pollSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  options: z.array(
    z.object({ id: z.uuid(), label: z.string(), votes: z.number().int().nullable() }),
  ),
  closesAt: z.iso.datetime(),
  anonymous: z.boolean(),
  votePer: z.enum(['user', 'household']),
  status: z.enum(['open', 'closed']),
  totalVotes: z.number().int().nullable(),
  myVoteOptionId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const votePollSchema = z.object({ optionId: z.uuid() });
export const pollVoterSchema = z.object({
  userId: z.uuid(),
  optionId: z.uuid(),
  votedAt: z.iso.datetime(),
});
