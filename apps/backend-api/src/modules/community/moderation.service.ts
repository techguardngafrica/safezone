import { Injectable } from '@nestjs/common';
import type {
  appealDecisionSchema,
  createModerationActionSchema,
  createReportSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith } from '../occupancy/occupancy.service';
import { ChannelsService } from './channels.service';

type ActionRow = Prisma.ModerationActionGetPayload<object>;
const PERMANENT = new Date('9999-12-31T00:00:00Z');

/**
 * Reports, the moderation queue, actions and appeals (community.md §2.13–2.18). Every action is audited;
 * removed messages keep their content (rule 7) and can be restored on appeal.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
  ) {}

  async report(access: EstateAccess, input: z.infer<typeof createReportSchema>) {
    return this.db.withTenant(access, async (tx) => {
      await this.assertTargetExists(tx, access.estateId, input.targetType, input.targetId);
      const existing = await tx.communityReport.findUnique({
        where: {
          targetType_targetId_reportedBy: {
            targetType: input.targetType,
            targetId: input.targetId,
            reportedBy: access.userId,
          },
        },
      });
      if (existing) return this.reportView(existing, null);
      const row = await tx.communityReport.create({
        data: {
          estateId: access.estateId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          details: input.details ?? null,
          reportedBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'community.report.created',
          estateId: access.estateId,
          aggregateType: 'community_report',
          aggregateId: row.id,
          payload: { reportId: row.id, targetType: row.targetType, reason: row.reason },
        },
      ]);
      return this.reportView(row, null);
    });
  }

  private async assertTargetExists(tx: Tx, estateId: string, type: string, id: string) {
    const found =
      type === 'message'
        ? await tx.message.count({ where: { id, estateId } })
        : type === 'channel'
          ? await tx.channel.count({ where: { id, estateId } })
          : await tx.communityProfile.count({ where: { estateId, userId: id } });
    if (found === 0 && type !== 'user')
      throw new NotFoundError('Not found', 'REPORT_TARGET_NOT_FOUND');
  }

  async queue(access: EstateAccess, status: 'open' | 'actioned' | 'dismissed') {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.communityReport.findMany({
        where: { estateId: access.estateId, status },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const messages = new Map(
        (
          await tx.message.findMany({
            where: {
              estateId: access.estateId,
              id: { in: rows.filter((r) => r.targetType === 'message').map((r) => r.targetId) },
            },
            select: { id: true, body: true },
          })
        ).map((m) => [m.id, m.body]),
      );
      return rows.map((row) =>
        this.reportView(
          row,
          row.targetType === 'message' ? (messages.get(row.targetId)?.slice(0, 280) ?? null) : null,
        ),
      );
    });
  }

  /** One call from the queue: act on the target and close the report (acceptance criterion 3). */
  async act(access: EstateAccess, input: z.infer<typeof createModerationActionSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const now = new Date();
      const endsAt = input.durationHours
        ? new Date(now.getTime() + input.durationHours * 3_600_000)
        : null;
      let subjectUserId: string | null = null;
      let channelId: string | null = input.channelId ?? null;
      switch (input.action) {
        case 'remove_message': {
          const message = await this.messageTarget(tx, access, input);
          subjectUserId = message.authorId;
          channelId = message.channelId;
          await tx.message.update({
            where: { id: message.id },
            data: { removedByModeration: true },
          });
          break;
        }
        case 'warn':
        case 'mute':
        case 'ban': {
          subjectUserId =
            input.targetType === 'user'
              ? input.targetId
              : (await this.messageTarget(tx, access, input)).authorId;
          await tx.communityProfile.upsert({
            where: { estateId_userId: { estateId: access.estateId, userId: subjectUserId } },
            create: {
              estateId: access.estateId,
              userId: subjectUserId,
              ...(input.action === 'warn' ? { warnings: 1 } : {}),
              ...(input.action === 'mute'
                ? { mutedUntil: endsAt ?? new Date(now.getTime() + 24 * 3_600_000) }
                : {}),
              ...(input.action === 'ban' ? { bannedUntil: endsAt ?? PERMANENT } : {}),
            },
            update: {
              ...(input.action === 'warn' ? { warnings: { increment: 1 } } : {}),
              ...(input.action === 'mute'
                ? { mutedUntil: endsAt ?? new Date(now.getTime() + 24 * 3_600_000) }
                : {}),
              ...(input.action === 'ban' ? { bannedUntil: endsAt ?? PERMANENT } : {}),
            },
          });
          break;
        }
        case 'remove_from_channel': {
          if (!input.channelId || input.targetType !== 'user')
            throw new DomainError(
              'MODERATION_TARGET_INVALID',
              'Choose the member and the channel',
              422,
            );
          subjectUserId = input.targetId;
          await tx.channelMember.updateMany({
            where: { channelId: input.channelId, userId: input.targetId },
            data: { status: 'removed' },
          });
          break;
        }
        case 'suspend_channel': {
          if (input.targetType !== 'channel')
            throw new DomainError('MODERATION_TARGET_INVALID', 'Choose a channel', 422);
          const channel = await this.channels.load(tx, access.estateId, input.targetId);
          channelId = channel.id;
          await tx.channel.update({
            where: { id: channel.id },
            data: { status: 'suspended', suspendedAt: now },
          });
          break;
        }
        case 'dismiss_report':
          if (!input.reportId)
            throw new DomainError('MODERATION_TARGET_INVALID', 'Choose the report to dismiss', 422);
          break;
      }
      const row = await tx.moderationAction.create({
        data: {
          estateId: access.estateId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          subjectUserId,
          channelId,
          reason: input.reason,
          endsAt:
            input.action === 'ban'
              ? (endsAt ?? PERMANENT)
              : input.action === 'mute'
                ? (endsAt ?? new Date(now.getTime() + 24 * 3_600_000))
                : null,
          moderatorId: access.userId,
          reportId: input.reportId ?? null,
        },
      });
      if (input.reportId) {
        await tx.communityReport.updateMany({
          where: { id: input.reportId, estateId: access.estateId },
          data: {
            status: input.action === 'dismiss_report' ? 'dismissed' : 'actioned',
            handledBy: access.userId,
            handledAt: now,
          },
        });
      }
      // Close every other open report on the same target too.
      if (input.action !== 'dismiss_report') {
        await tx.communityReport.updateMany({
          where: {
            estateId: access.estateId,
            targetType: input.targetType,
            targetId: input.targetId,
            status: 'open',
          },
          data: { status: 'actioned', handledBy: access.userId, handledAt: now },
        });
      }
      await appendOutboxEvents(tx, [
        {
          type:
            input.action === 'remove_message'
              ? 'community.message.removed'
              : 'community.moderation.actioned',
          estateId: access.estateId,
          aggregateType: 'moderation_action',
          aggregateId: row.id,
          payload: { actionId: row.id, action: row.action, targetType: row.targetType },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: `community.moderation.${input.action}`,
            resourceType: input.targetType,
            resourceId: input.targetId,
            after: { endsAt: row.endsAt?.toISOString() ?? null, channelId },
            reason: input.reason,
          },
        },
      ]);
      if (subjectUserId && input.action !== 'dismiss_report') {
        await this.notifications.request(tx, {
          intent: 'community.moderation',
          userIds: [subjectUserId],
          estateId: access.estateId,
          data: {
            action: input.action.replaceAll('_', ' '),
            reason: input.reason,
            actionId: row.id,
          },
          dedupeKey: `moderation:${row.id}`,
        });
      }
      return this.actionView(row);
    });
  }

  private async messageTarget(
    tx: Tx,
    access: EstateAccess,
    input: { targetType: string; targetId: string },
  ) {
    if (input.targetType !== 'message')
      throw new DomainError('MODERATION_TARGET_INVALID', 'Choose a message', 422);
    const message = await tx.message.findFirst({
      where: { id: input.targetId, estateId: access.estateId },
    });
    if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
    return message;
  }

  /** The moderation audit log (community.md §2.18). */
  async actions(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.moderationAction.findMany({
          where: { estateId: access.estateId },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
      ).map((row) => this.actionView(row)),
    );
  }

  /** The person acted on appeals once (community.md §2.17). */
  async appeal(access: EstateAccess, actionId: string, statement: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.moderationAction.findFirst({
        where: { id: actionId, estateId: access.estateId },
      });
      if (!row || row.subjectUserId !== access.userId)
        throw new NotFoundError('Action not found', 'MODERATION_ACTION_NOT_FOUND');
      if (row.appealStatus !== 'none')
        throw new ConflictError('APPEAL_EXISTS', 'This action has already been appealed');
      const updated = await tx.moderationAction.update({
        where: { id: actionId },
        data: { appealStatus: 'pending', appealStatement: statement },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'community.appeal.submitted',
          estateId: access.estateId,
          aggregateType: 'moderation_action',
          aggregateId: actionId,
          payload: { actionId },
        },
      ]);
      return this.actionView(updated);
    });
  }

  /** A different moderator decides; overturning restores the message or lifts the mute or ban. */
  async decideAppeal(
    access: EstateAccess,
    actionId: string,
    input: z.infer<typeof appealDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.moderationAction.findFirst({
        where: { id: actionId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Action not found', 'MODERATION_ACTION_NOT_FOUND');
      if (row.appealStatus !== 'pending')
        throw new ConflictError('APPEAL_NOT_PENDING', 'There is no pending appeal');
      if (row.moderatorId === access.userId)
        throw new ForbiddenError('Another moderator must decide this appeal', 'APPEAL_SELF_REVIEW');
      if (input.decision === 'overturned') await this.undo(tx, access.estateId, row);
      const updated = await tx.moderationAction.update({
        where: { id: actionId },
        data: { appealStatus: input.decision, appealDecidedBy: access.userId },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'community.appeal.decided',
          estateId: access.estateId,
          aggregateType: 'moderation_action',
          aggregateId: actionId,
          payload: { actionId, decision: input.decision },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'community.appeal.decide',
            resourceType: 'moderation_action',
            resourceId: actionId,
            after: { decision: input.decision },
            reason: input.note ?? null,
          },
        },
      ]);
      return this.actionView(updated);
    });
  }

  private async undo(tx: Tx, estateId: string, row: ActionRow) {
    switch (row.action) {
      case 'remove_message':
        await tx.message.update({
          where: { id: row.targetId },
          data: { removedByModeration: false },
        });
        break;
      case 'mute':
        if (row.subjectUserId)
          await tx.communityProfile.updateMany({
            where: { estateId, userId: row.subjectUserId },
            data: { mutedUntil: null },
          });
        break;
      case 'ban':
        if (row.subjectUserId)
          await tx.communityProfile.updateMany({
            where: { estateId, userId: row.subjectUserId },
            data: { bannedUntil: null },
          });
        break;
      case 'suspend_channel':
        await tx.channel.updateMany({
          where: { id: row.targetId, estateId, status: 'suspended' },
          data: { status: 'active' },
        });
        break;
      case 'remove_from_channel':
        if (row.channelId && row.subjectUserId)
          await tx.channelMember.updateMany({
            where: { channelId: row.channelId, userId: row.subjectUserId },
            data: { status: 'active' },
          });
        break;
      default:
        break;
    }
  }

  private reportView(row: Prisma.CommunityReportGetPayload<object>, preview: string | null) {
    return {
      id: row.id,
      targetType: row.targetType as 'message' | 'channel' | 'user',
      targetId: row.targetId,
      reason: row.reason,
      details: row.details,
      status: row.status as 'open' | 'actioned' | 'dismissed',
      reportedBy: row.reportedBy,
      preview,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private actionView(row: ActionRow) {
    return {
      id: row.id,
      action: row.action as 'warn',
      targetType: row.targetType as 'message' | 'channel' | 'user',
      targetId: row.targetId,
      reason: row.reason,
      endsAt: row.endsAt?.toISOString() ?? null,
      moderatorId: row.moderatorId,
      appealStatus: row.appealStatus as 'none' | 'pending' | 'upheld' | 'overturned',
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Staff moderators, or a resident with the permission (trusted residents, community.md §2.15). */
  static canModerate(access: EstateAccess): boolean {
    return (
      isStaffWith(access, 'community.moderate') || access.permissions.has('community.moderate')
    );
  }
}
