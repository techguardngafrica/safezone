import { z } from 'zod';

const govDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---- Policies & Acknowledgements ----------------------------------------------------------------

export const policyAudienceSchema = z.enum(['all', 'residents', 'owners', 'staff']);
export const policyStatusSchema = z.enum(['draft', 'published', 'archived']);

export const createPolicySchema = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  requiresAck: z.boolean().default(false),
  audience: policyAudienceSchema.default('all'),
});

export const publishPolicyVersionSchema = z.object({
  documentId: z.uuid().optional(),
  summary: z.string().trim().min(3).max(2000),
  effectiveOn: govDateSchema,
});

export const policyVersionSchema = z.object({
  id: z.uuid(),
  policyId: z.uuid(),
  version: z.number().int(),
  documentId: z.uuid().nullable(),
  summary: z.string(),
  effectiveOn: govDateSchema,
  publishedBy: z.uuid(),
  publishedAt: z.iso.datetime(),
  ackCount: z.number().int(),
  acknowledgedByMe: z.boolean(),
});

export const policySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  category: z.string(),
  requiresAck: z.boolean(),
  audience: policyAudienceSchema,
  status: policyStatusSchema,
  currentVersion: policyVersionSchema.nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Management Committee -----------------------------------------------------------------------

export const createCommitteeMemberSchema = z.object({
  userId: z.uuid(),
  position: z.string().trim().min(2).max(80),
  termStart: govDateSchema,
  termEnd: govDateSchema.optional(),
});

export const committeeMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  position: z.string(),
  termStart: govDateSchema,
  termEnd: govDateSchema.nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

// ---- Meetings, Minutes & Action Items -----------------------------------------------------------

export const meetingTypeSchema = z.enum(['agm', 'egm', 'committee', 'town_hall']);
export const meetingStatusSchema = z.enum(['scheduled', 'held', 'cancelled']);
export const minutesStatusSchema = z.enum(['draft', 'approved', 'published']);

export const createMeetingSchema = z.object({
  type: meetingTypeSchema,
  title: z.string().trim().min(3).max(200),
  startsAt: z.iso.datetime({ offset: true }),
  location: z.string().trim().max(200).optional(),
  onlineLink: z.url().optional(),
  agenda: z.array(z.string().trim().min(1).max(300)).default([]),
  quorumRule: z.number().int().min(1).max(100).default(25),
});

export const recordAttendanceSchema = z.object({
  userId: z.uuid(),
  unitId: z.uuid().optional(),
  present: z.boolean().default(true),
  proxyForUserId: z.uuid().optional(),
});

export const upsertMinutesSchema = z.object({
  content: z.string().trim().min(5).max(20_000),
  documentId: z.uuid().optional(),
  status: minutesStatusSchema.optional(),
});

export const createActionItemSchema = z.object({
  title: z.string().trim().min(3).max(300),
  ownerId: z.uuid().optional(),
  dueOn: govDateSchema.optional(),
});

export const meetingSchema = z.object({
  id: z.uuid(),
  type: meetingTypeSchema,
  title: z.string(),
  startsAt: z.iso.datetime(),
  location: z.string().nullable(),
  onlineLink: z.string().nullable(),
  agenda: z.array(z.string()),
  quorumRule: z.number().int(),
  status: meetingStatusSchema,
  noticeSentAt: z.iso.datetime().nullable(),
  attendeeCount: z.number().int(),
  minutes: z
    .object({
      id: z.uuid(),
      content: z.string(),
      documentId: z.uuid().nullable(),
      status: minutesStatusSchema,
      approvedBy: z.uuid().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
  actionItems: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      ownerId: z.uuid().nullable(),
      dueOn: govDateSchema.nullable(),
      status: z.enum(['open', 'done']),
    }),
  ),
  createdAt: z.iso.datetime(),
});

// ---- Motions, Voting & Resolutions --------------------------------------------------------------

export const motionEligibilitySchema = z.enum(['per_unit', 'per_owner', 'per_resident']);
export const ballotTypeSchema = z.enum(['secret', 'open']);
export const thresholdTypeSchema = z.enum(['simple', 'two_thirds', 'custom']);
export const motionStatusSchema = z.enum(['draft', 'open', 'closed', 'passed', 'failed', 'void']);

export const createMotionSchema = z.object({
  meetingId: z.uuid().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(4000),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
  eligibility: motionEligibilitySchema.default('per_unit'),
  ballot: ballotTypeSchema.default('secret'),
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }),
  quorumCount: z.number().int().min(1).default(1),
  threshold: thresholdTypeSchema.default('simple'),
  customThresholdPercent: z.number().int().min(50).max(100).optional(),
});

export const castVoteSchema = z.object({
  option: z.string().trim().min(1).max(120),
  unitId: z.uuid().optional(),
  proxyForUserId: z.uuid().optional(),
});

export const motionSchema = z.object({
  id: z.uuid(),
  meetingId: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  options: z.array(z.string()),
  eligibility: motionEligibilitySchema,
  ballot: ballotTypeSchema,
  opensAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
  quorumCount: z.number().int(),
  threshold: thresholdTypeSchema,
  customThresholdPercent: z.number().int().nullable(),
  status: motionStatusSchema,
  totalVotes: z.number().int(),
  hasVoted: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const motionResultsSchema = z.object({
  motionId: z.uuid(),
  status: motionStatusSchema,
  ballot: ballotTypeSchema,
  quorumCount: z.number().int(),
  totalVotes: z.number().int(),
  quorumMet: z.boolean(),
  winningOption: z.string().nullable(),
  tallies: z.array(z.object({ option: z.string(), votes: z.number().int(), percent: z.number() })),
  resolutionText: z.string().nullable(),
});

// ---- Disputes (privacy-restricted) --------------------------------------------------------------

export const governanceDisputeStatusSchema = z.enum(['open', 'in_mediation', 'resolved', 'closed']);

export const createGovernanceDisputeSchema = z.object({
  partyUserIds: z.array(z.uuid()).min(1).max(10),
  summary: z.string().trim().min(5).max(2000),
});

export const updateGovernanceDisputeSchema = z.object({
  status: governanceDisputeStatusSchema.optional(),
  handlerId: z.uuid().nullable().optional(),
  mediationNotes: z.string().trim().max(4000).optional(),
  outcome: z.string().trim().max(2000).optional(),
});

export const governanceDisputeSchema = z.object({
  id: z.uuid(),
  partyUserIds: z.array(z.uuid()),
  summary: z.string(),
  status: governanceDisputeStatusSchema,
  handlerId: z.uuid().nullable(),
  mediationNotes: z.string().nullable(),
  outcome: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
