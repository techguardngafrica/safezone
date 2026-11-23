import { Injectable } from '@nestjs/common';
import type {
  castVoteSchema,
  createActionItemSchema,
  createCommitteeMemberSchema,
  createGovernanceDisputeSchema,
  createMeetingSchema,
  createMotionSchema,
  createPolicySchema,
  publishPolicyVersionSchema,
  recordAttendanceSchema,
  updateGovernanceDisputeSchema,
  upsertMinutesSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { dateOnly, parseDateOnly, todayInLagos } from '../billing/domain/billing';
import {
  buildVoterKey,
  evaluateMotionResult,
  type MotionEligibility,
  type MotionThreshold,
} from './domain/governance';

/**
 * Estate Governance (governance.md, Phase 5; ADR-0026).
 * Policies & mandatory acknowledgements, committee, meetings/minutes, motions & secret/open voting,
 * resolutions, and privacy-restricted disputes.
 */
@Injectable()
export class GovernanceService {
  constructor(private readonly db: DatabaseService) {}

  // ---- Policies & Acknowledgements --------------------------------------------------------------

  async listPolicies(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const canManage = access.permissions.has('governance.manage');
      const rows = await tx.policy.findMany({
        where: {
          estateId: access.estateId,
          ...(canManage ? {} : { status: 'published' }),
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            include: { _count: { select: { acknowledgements: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const latestVersionIds = rows.flatMap((r) => (r.versions[0] ? [r.versions[0].id] : []));
      const myAcks =
        latestVersionIds.length > 0
          ? await tx.policyAcknowledgement.findMany({
              where: {
                estateId: access.estateId,
                userId: access.userId,
                policyVersionId: { in: latestVersionIds },
              },
              select: { policyVersionId: true },
            })
          : [];
      const ackSet = new Set(myAcks.map((a) => a.policyVersionId));

      return rows.map((r) => {
        const v = r.versions[0];
        return {
          id: r.id,
          title: r.title,
          category: r.category,
          requiresAck: r.requiresAck,
          audience: r.audience as 'all' | 'residents' | 'owners' | 'staff',
          status: r.status as 'draft' | 'published' | 'archived',
          currentVersion: v
            ? {
                id: v.id,
                policyId: v.policyId,
                version: v.version,
                documentId: v.documentId,
                summary: v.summary,
                effectiveOn: dateOnly(v.effectiveOn),
                publishedBy: v.publishedBy,
                publishedAt: v.publishedAt.toISOString(),
                ackCount: v._count.acknowledgements,
                acknowledgedByMe: ackSet.has(v.id),
              }
            : null,
          createdAt: r.createdAt.toISOString(),
        };
      });
    });
  }

  async pendingPolicyAcknowledgements(access: EstateAccess) {
    const all = await this.listPolicies(access);
    return all.filter(
      (p) =>
        p.status === 'published' &&
        p.requiresAck &&
        p.currentVersion !== null &&
        !p.currentVersion.acknowledgedByMe,
    );
  }

  async createPolicy(access: EstateAccess, input: z.infer<typeof createPolicySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.policy.create({
        data: {
          estateId: access.estateId,
          title: input.title,
          category: input.category,
          requiresAck: input.requiresAck,
          audience: input.audience,
          status: 'draft',
        },
      });
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        requiresAck: row.requiresAck,
        audience: row.audience as 'all' | 'residents' | 'owners' | 'staff',
        status: row.status as 'draft' | 'published' | 'archived',
        currentVersion: null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async publishPolicyVersion(
    access: EstateAccess,
    policyId: string,
    input: z.infer<typeof publishPolicyVersionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const policy = await tx.policy.findFirst({
        where: { estateId: access.estateId, id: policyId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!policy) throw new NotFoundError('Policy not found', 'POLICY_NOT_FOUND');
      const nextVersion = (policy.versions[0]?.version ?? 0) + 1;
      const version = await tx.policyVersion.create({
        data: {
          estateId: access.estateId,
          policyId: policy.id,
          version: nextVersion,
          documentId: input.documentId ?? null,
          summary: input.summary,
          effectiveOn: parseDateOnly(input.effectiveOn),
          publishedBy: access.userId,
        },
      });
      await tx.policy.update({
        where: { id: policy.id },
        data: { currentVersionId: version.id, status: 'published' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'governance.policy.published',
          estateId: access.estateId,
          aggregateType: 'policy',
          aggregateId: policy.id,
          payload: {
            policyId: policy.id,
            versionId: version.id,
            version: nextVersion,
            requiresAck: policy.requiresAck,
          },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'governance.policy.publish',
            resourceType: 'policy',
            resourceId: policy.id,
            after: { version: nextVersion },
          },
        },
      ]);
      return {
        id: version.id,
        policyId: version.policyId,
        version: version.version,
        documentId: version.documentId,
        summary: version.summary,
        effectiveOn: dateOnly(version.effectiveOn),
        publishedBy: version.publishedBy,
        publishedAt: version.publishedAt.toISOString(),
        ackCount: 0,
        acknowledgedByMe: false,
      };
    });
  }

  async acknowledgePolicyVersion(access: EstateAccess, versionId: string) {
    return this.db.withTenant(access, async (tx) => {
      const version = await tx.policyVersion.findFirst({
        where: { estateId: access.estateId, id: versionId },
      });
      if (!version) throw new NotFoundError('Policy version not found', 'POLICY_VERSION_NOT_FOUND');
      await tx.policyAcknowledgement.createMany({
        data: [{ estateId: access.estateId, policyVersionId: version.id, userId: access.userId }],
        skipDuplicates: true,
      });
      return { acknowledged: true, policyVersionId: version.id };
    });
  }

  // ---- Management Committee ---------------------------------------------------------------------

  async listCommittee(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.committeeMember.findMany({
        where: { estateId: access.estateId },
        orderBy: [{ active: 'desc' }, { termStart: 'desc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        position: r.position,
        termStart: dateOnly(r.termStart),
        termEnd: r.termEnd ? dateOnly(r.termEnd) : null,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async addCommitteeMember(
    access: EstateAccess,
    input: z.infer<typeof createCommitteeMemberSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.committeeMember.create({
        data: {
          estateId: access.estateId,
          userId: input.userId,
          position: input.position,
          termStart: parseDateOnly(input.termStart),
          termEnd: input.termEnd ? parseDateOnly(input.termEnd) : null,
        },
      });
      return {
        id: row.id,
        userId: row.userId,
        position: row.position,
        termStart: dateOnly(row.termStart),
        termEnd: row.termEnd ? dateOnly(row.termEnd) : null,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---- Meetings, Minutes & Action Items ---------------------------------------------------------

  async listMeetings(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const canManage = access.permissions.has('governance.manage');
      const rows = await tx.meeting.findMany({
        where: { estateId: access.estateId },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
        orderBy: { startsAt: 'desc' },
      });
      return rows.map((r) => this.meetingView(r, canManage));
    });
  }

  async createMeeting(access: EstateAccess, input: z.infer<typeof createMeetingSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.meeting.create({
        data: {
          estateId: access.estateId,
          type: input.type,
          title: input.title,
          startsAt: new Date(input.startsAt),
          location: input.location ?? null,
          onlineLink: input.onlineLink ?? null,
          agenda: input.agenda,
          quorumRule: input.quorumRule,
          status: 'scheduled',
        },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'governance.meeting.scheduled',
          estateId: access.estateId,
          aggregateType: 'meeting',
          aggregateId: row.id,
          payload: { meetingId: row.id, type: row.type, title: row.title },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'governance.meeting.schedule',
            resourceType: 'meeting',
            resourceId: row.id,
          },
        },
      ]);
      return this.meetingView(row, true);
    });
  }

  async sendMeetingNotice(access: EstateAccess, meetingId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.meeting.findFirst({
        where: { estateId: access.estateId, id: meetingId },
      });
      if (!row) throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
      const updated = await tx.meeting.update({
        where: { id: meetingId },
        data: { noticeSentAt: new Date() },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
      });
      return this.meetingView(updated, true);
    });
  }

  async recordMeetingAttendance(
    access: EstateAccess,
    meetingId: string,
    input: z.infer<typeof recordAttendanceSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.meeting.findFirst({
        where: { estateId: access.estateId, id: meetingId },
      });
      if (!row) throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
      await tx.meetingAttendance.upsert({
        where: { meetingId_userId: { meetingId, userId: input.userId } },
        create: {
          estateId: access.estateId,
          meetingId,
          userId: input.userId,
          unitId: input.unitId ?? null,
          present: input.present,
          proxyForUserId: input.proxyForUserId ?? null,
        },
        update: {
          unitId: input.unitId ?? null,
          present: input.present,
          proxyForUserId: input.proxyForUserId ?? null,
        },
      });
      const updated = await tx.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
      });
      return this.meetingView(updated, true);
    });
  }

  async upsertMinutes(
    access: EstateAccess,
    meetingId: string,
    input: z.infer<typeof upsertMinutesSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.meeting.findFirst({
        where: { estateId: access.estateId, id: meetingId },
      });
      if (!row) throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
      const status = input.status ?? 'draft';
      const minutes = await tx.meetingMinutes.upsert({
        where: { meetingId },
        create: {
          estateId: access.estateId,
          meetingId,
          content: input.content,
          documentId: input.documentId ?? null,
          status,
          approvedBy: status === 'approved' || status === 'published' ? access.userId : null,
        },
        update: {
          content: input.content,
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          status,
          ...(status === 'approved' || status === 'published' ? { approvedBy: access.userId } : {}),
        },
      });
      if (status === 'published') {
        await appendOutboxEvents(tx, [
          {
            type: 'governance.minutes.published',
            estateId: access.estateId,
            aggregateType: 'meeting_minutes',
            aggregateId: minutes.id,
            payload: { meetingId, minutesId: minutes.id },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'governance.minutes.publish',
              resourceType: 'meeting_minutes',
              resourceId: minutes.id,
            },
          },
        ]);
      }
      const updated = await tx.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
      });
      return this.meetingView(updated, true);
    });
  }

  async addActionItem(
    access: EstateAccess,
    meetingId: string,
    input: z.infer<typeof createActionItemSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.meeting.findFirst({
        where: { estateId: access.estateId, id: meetingId },
      });
      if (!row) throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
      await tx.meetingActionItem.create({
        data: {
          estateId: access.estateId,
          meetingId,
          title: input.title,
          ownerId: input.ownerId ?? null,
          dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null,
        },
      });
      const updated = await tx.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: {
          minutes: true,
          actionItems: true,
          _count: { select: { attendance: true } },
        },
      });
      return this.meetingView(updated, true);
    });
  }

  // ---- Motions, Voting & Resolutions ------------------------------------------------------------

  async listMotions(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const canManage = access.permissions.has('governance.manage');
      const rows = await tx.motion.findMany({
        where: {
          estateId: access.estateId,
          ...(canManage ? {} : { status: { not: 'draft' } }),
        },
        include: { _count: { select: { votes: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const receipts =
        rows.length > 0
          ? await tx.motionBallotReceipt.findMany({
              where: {
                estateId: access.estateId,
                motionId: { in: rows.map((r) => r.id) },
                castByUserId: access.userId,
              },
              select: { motionId: true },
            })
          : [];
      const votedSet = new Set(receipts.map((r) => r.motionId));
      return rows.map((r) => this.motionView(r, r._count.votes, votedSet.has(r.id)));
    });
  }

  async createMotion(access: EstateAccess, input: z.infer<typeof createMotionSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.motion.create({
        data: {
          estateId: access.estateId,
          meetingId: input.meetingId ?? null,
          title: input.title,
          description: input.description,
          options: input.options,
          eligibility: input.eligibility,
          ballot: input.ballot,
          opensAt: new Date(input.opensAt),
          closesAt: new Date(input.closesAt),
          quorumCount: input.quorumCount,
          threshold: input.threshold,
          customThresholdPercent: input.customThresholdPercent ?? null,
          status: 'open',
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'governance.motion.opened',
          estateId: access.estateId,
          aggregateType: 'motion',
          aggregateId: row.id,
          payload: { motionId: row.id, title: row.title },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'governance.motion.open',
            resourceType: 'motion',
            resourceId: row.id,
          },
        },
      ]);
      return this.motionView(row, 0, false);
    });
  }

  /**
   * Casts a vote on an open motion (governance.md §4 rules 1-4, ADR-0026).
   * For secret ballots, `motion_votes` stores NULL for `voter_user_id` and `unit_id`;
   * deduplication is enforced separately in `motion_ballot_receipts`.
   */
  async castVote(access: EstateAccess, motionId: string, input: z.infer<typeof castVoteSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const motion = await tx.motion.findFirst({
        where: { estateId: access.estateId, id: motionId },
      });
      if (!motion) throw new NotFoundError('Motion not found', 'MOTION_NOT_FOUND');
      const now = new Date();
      if (motion.status !== 'open' || now < motion.opensAt || now > motion.closesAt) {
        throw new ConflictError('MOTION_NOT_OPEN', 'Voting is not currently open for this motion');
      }
      const options = motion.options as string[];
      if (!options.includes(input.option)) {
        throw new DomainError(
          'INVALID_VOTE_OPTION',
          'Selected option is not valid for this motion',
          422,
        );
      }

      let voterKey: string;
      try {
        voterKey = buildVoterKey(
          motion.eligibility as MotionEligibility,
          access.userId,
          input.unitId,
          input.proxyForUserId,
        );
      } catch {
        throw new DomainError(
          'UNIT_REQUIRED',
          'unitId is required to vote on a per-unit motion',
          422,
        );
      }

      const existing = await tx.motionBallotReceipt.findUnique({
        where: { motionId_voterKey: { motionId: motion.id, voterKey } },
      });
      if (existing) {
        throw new ConflictError(
          'ALREADY_VOTED',
          motion.eligibility === 'per_unit'
            ? 'A vote has already been cast for this unit'
            : 'You have already voted on this motion',
        );
      }

      await tx.motionBallotReceipt.create({
        data: {
          estateId: access.estateId,
          motionId: motion.id,
          voterKey,
          castByUserId: access.userId,
          proxyForUserId: input.proxyForUserId ?? null,
        },
      });
      await tx.motionVote.create({
        data: {
          estateId: access.estateId,
          motionId: motion.id,
          option: input.option,
          // Secret ballot invariant: never store voter identity alongside choice.
          voterUserId: motion.ballot === 'secret' ? null : access.userId,
          unitId: motion.ballot === 'secret' ? null : (input.unitId ?? null),
        },
      });
      return { recorded: true, motionId: motion.id };
    });
  }

  async closeMotion(access: EstateAccess, motionId: string) {
    return this.db.withTenant(access, async (tx) => {
      const motion = await tx.motion.findFirst({
        where: { estateId: access.estateId, id: motionId },
        include: { votes: { select: { option: true } } },
      });
      if (!motion) throw new NotFoundError('Motion not found', 'MOTION_NOT_FOUND');
      if (motion.status !== 'open') {
        throw new ConflictError('MOTION_ALREADY_CLOSED', 'Motion is already closed');
      }
      const evalResult = evaluateMotionResult({
        options: motion.options as string[],
        voteOptions: motion.votes.map((v) => v.option),
        quorumCount: motion.quorumCount,
        threshold: motion.threshold as MotionThreshold,
        customThresholdPercent: motion.customThresholdPercent,
      });

      await tx.motion.update({
        where: { id: motion.id },
        data: { status: evalResult.status },
      });

      let resolutionText: string | null = null;
      if (evalResult.status === 'passed' && evalResult.winningOption) {
        resolutionText = `Resolved: "${motion.title}" passed with option "${evalResult.winningOption}" (${evalResult.totalVotes} votes).`;
        await tx.resolution.create({
          data: {
            estateId: access.estateId,
            motionId: motion.id,
            text: resolutionText,
            adoptedOn: parseDateOnly(todayInLagos()),
          },
        });
      }

      await appendOutboxEvents(tx, [
        {
          type: 'governance.motion.closed',
          estateId: access.estateId,
          aggregateType: 'motion',
          aggregateId: motion.id,
          payload: {
            motionId: motion.id,
            status: evalResult.status,
            totalVotes: evalResult.totalVotes,
          },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'governance.motion.close',
            resourceType: 'motion',
            resourceId: motion.id,
            after: { status: evalResult.status },
          },
        },
      ]);

      return {
        motionId: motion.id,
        status: evalResult.status,
        ballot: motion.ballot as 'secret' | 'open',
        quorumCount: motion.quorumCount,
        totalVotes: evalResult.totalVotes,
        quorumMet: evalResult.quorumMet,
        winningOption: evalResult.winningOption,
        tallies: evalResult.tallies,
        resolutionText,
      };
    });
  }

  async motionResults(access: EstateAccess, motionId: string) {
    return this.db.withTenant(access, async (tx) => {
      const motion = await tx.motion.findFirst({
        where: { estateId: access.estateId, id: motionId },
        include: { votes: { select: { option: true } }, resolution: true },
      });
      if (!motion) throw new NotFoundError('Motion not found', 'MOTION_NOT_FOUND');
      if (motion.status === 'open' && motion.ballot === 'secret') {
        throw new ForbiddenError(
          'Secret ballot results are only visible after the motion closes',
          'RESULTS_HIDDEN_UNTIL_CLOSE',
        );
      }
      const evalResult = evaluateMotionResult({
        options: motion.options as string[],
        voteOptions: motion.votes.map((v) => v.option),
        quorumCount: motion.quorumCount,
        threshold: motion.threshold as MotionThreshold,
        customThresholdPercent: motion.customThresholdPercent,
      });
      return {
        motionId: motion.id,
        status: motion.status as 'draft' | 'open' | 'closed' | 'passed' | 'failed' | 'void',
        ballot: motion.ballot as 'secret' | 'open',
        quorumCount: motion.quorumCount,
        totalVotes: evalResult.totalVotes,
        quorumMet: evalResult.quorumMet,
        winningOption: evalResult.winningOption,
        tallies: evalResult.tallies,
        resolutionText: motion.resolution?.text ?? null,
      };
    });
  }

  // ---- Disputes (privacy-restricted) ------------------------------------------------------------

  async listDisputes(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const canHandle = access.permissions.has('governance.dispute.manage');
      const rows = await tx.governanceDispute.findMany({
        where: {
          estateId: access.estateId,
          ...(canHandle
            ? {}
            : { OR: [{ partyUserIds: { has: access.userId } }, { handlerId: access.userId }] }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => this.disputeView(r));
    });
  }

  async createDispute(access: EstateAccess, input: z.infer<typeof createGovernanceDisputeSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const parties = [...new Set([access.userId, ...input.partyUserIds])];
      const row = await tx.governanceDispute.create({
        data: {
          estateId: access.estateId,
          partyUserIds: parties,
          summary: input.summary,
          status: 'open',
        },
      });
      return this.disputeView(row);
    });
  }

  async updateDispute(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateGovernanceDisputeSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.governanceDispute.findFirst({
        where: { estateId: access.estateId, id },
      });
      if (!existing) throw new NotFoundError('Dispute not found', 'DISPUTE_NOT_FOUND');
      const row = await tx.governanceDispute.update({
        where: { id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.handlerId !== undefined ? { handlerId: input.handlerId } : {}),
          ...(input.mediationNotes !== undefined ? { mediationNotes: input.mediationNotes } : {}),
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        },
      });
      return this.disputeView(row);
    });
  }

  // ---- View helpers -----------------------------------------------------------------------------

  private meetingView(
    r: {
      id: string;
      type: string;
      title: string;
      startsAt: Date;
      location: string | null;
      onlineLink: string | null;
      agenda: unknown;
      quorumRule: number;
      status: string;
      noticeSentAt: Date | null;
      createdAt: Date;
      _count: { attendance: number };
      minutes: {
        id: string;
        content: string;
        documentId: string | null;
        status: string;
        approvedBy: string | null;
        updatedAt: Date;
      } | null;
      actionItems: {
        id: string;
        title: string;
        ownerId: string | null;
        dueOn: Date | null;
        status: string;
      }[];
    },
    canManage: boolean,
  ) {
    // Rule 6: Minutes become visible to residents only after approval/publication.
    const visibleMinutes =
      r.minutes &&
      (canManage || r.minutes.status === 'approved' || r.minutes.status === 'published')
        ? {
            id: r.minutes.id,
            content: r.minutes.content,
            documentId: r.minutes.documentId,
            status: r.minutes.status as 'draft' | 'approved' | 'published',
            approvedBy: r.minutes.approvedBy,
            updatedAt: r.minutes.updatedAt.toISOString(),
          }
        : null;
    return {
      id: r.id,
      type: r.type as 'agm' | 'egm' | 'committee' | 'town_hall',
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      location: r.location,
      onlineLink: r.onlineLink,
      agenda: Array.isArray(r.agenda) ? (r.agenda as string[]) : [],
      quorumRule: r.quorumRule,
      status: r.status as 'scheduled' | 'held' | 'cancelled',
      noticeSentAt: r.noticeSentAt ? r.noticeSentAt.toISOString() : null,
      attendeeCount: r._count.attendance,
      minutes: visibleMinutes,
      actionItems: r.actionItems.map((a) => ({
        id: a.id,
        title: a.title,
        ownerId: a.ownerId,
        dueOn: a.dueOn ? dateOnly(a.dueOn) : null,
        status: a.status as 'open' | 'done',
      })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private motionView(
    r: {
      id: string;
      meetingId: string | null;
      title: string;
      description: string;
      options: unknown;
      eligibility: string;
      ballot: string;
      opensAt: Date;
      closesAt: Date;
      quorumCount: number;
      threshold: string;
      customThresholdPercent: number | null;
      status: string;
      createdAt: Date;
    },
    totalVotes: number,
    hasVoted: boolean,
  ) {
    return {
      id: r.id,
      meetingId: r.meetingId,
      title: r.title,
      description: r.description,
      options: Array.isArray(r.options) ? (r.options as string[]) : [],
      eligibility: r.eligibility as MotionEligibility,
      ballot: r.ballot as 'secret' | 'open',
      opensAt: r.opensAt.toISOString(),
      closesAt: r.closesAt.toISOString(),
      quorumCount: r.quorumCount,
      threshold: r.threshold as MotionThreshold,
      customThresholdPercent: r.customThresholdPercent,
      status: r.status as 'draft' | 'open' | 'closed' | 'passed' | 'failed' | 'void',
      totalVotes,
      hasVoted,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private disputeView(r: {
    id: string;
    partyUserIds: string[];
    summary: string;
    status: string;
    handlerId: string | null;
    mediationNotes: string | null;
    outcome: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      partyUserIds: r.partyUserIds,
      summary: r.summary,
      status: r.status as 'open' | 'in_mediation' | 'resolved' | 'closed',
      handlerId: r.handlerId,
      mediationNotes: r.mediationNotes,
      outcome: r.outcome,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
