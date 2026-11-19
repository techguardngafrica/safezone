import { Injectable } from '@nestjs/common';
import {
  type channelListQuerySchema,
  type createChannelSchema,
  DEFAULT_ESTATE_CHANNELS,
  type editMessageSchema,
  type messageListQuerySchema,
  type postMessageSchema,
} from '@safezone/schemas';
import { z } from 'zod';
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
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { FilesService } from '../files/files.service';
import { UserDirectory } from '../identity/user-directory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';

type ChannelRow = Prisma.ChannelGetPayload<object>;
type MessageRow = Prisma.MessageGetPayload<object>;
const EDIT_WINDOW_MS = 15 * 60_000;
const NOTIFY_CHUNK = 5000;
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const CHANNEL_ACTIONS: Record<string, string> = {
  'community.channel.created': 'community.channel.create',
  'community.channel.approved': 'community.channel.approve',
  'community.channel.suspended': 'community.channel.suspend',
  'community.channel.archived': 'community.channel.archive',
  'community.channel.reactivated': 'community.channel.reactivate',
};

/** What the caller may do in a channel and from when they may read history. */
interface Membership {
  member: boolean;
  role: 'owner' | 'moderator' | 'member' | null;
  status: 'active' | 'requested' | 'invited' | null;
  notify: 'all' | 'mentions' | 'none' | null;
  mutedUntil: Date | null;
  /** History visible from (rule 8); null for full history. */
  since: Date | null;
}

function directKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export function otherDirectUserId(key: string | null, me: string): string | null {
  if (!key) return null;
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  return parts[0] === me ? (parts[1] ?? null) : parts[1] === me ? (parts[0] ?? null) : null;
}

/**
 * Channels and messages (community.md §2.4–2.11). Building channels are per building or block, created on
 * demand, with membership derived from active occupancy (rules 1–2), so move-ins and move-outs apply at
 * once. Estate channels include every member; resident and direct channels have explicit members.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly users: UserDirectory,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Guidelines ----------------------------------------------------------------------------

  async guidelines(access: EstateAccess) {
    const settings = await this.tenancy.getSettings(access);
    const profile = await this.db.withTenant(access, (tx) =>
      tx.communityProfile.findUnique({
        where: { estateId_userId: { estateId: access.estateId, userId: access.userId } },
      }),
    );
    return {
      text: settings['community.guidelines'],
      acceptedAt: profile?.guidelinesAcceptedAt?.toISOString() ?? null,
    };
  }

  async acceptGuidelines(access: EstateAccess) {
    await this.db.withTenant(access, (tx) =>
      tx.communityProfile.upsert({
        where: { estateId_userId: { estateId: access.estateId, userId: access.userId } },
        create: {
          estateId: access.estateId,
          userId: access.userId,
          guidelinesAcceptedAt: new Date(),
        },
        update: { guidelinesAcceptedAt: new Date() },
      }),
    );
    return this.guidelines(access);
  }

  // ---- Channels ------------------------------------------------------------------------------

  /** Seeds the estate channels and the caller's building channels, then lists what they can see. */
  async list(access: EstateAccess, query: z.infer<typeof channelListQuerySchema>) {
    const settings = await this.tenancy.getSettings(access);
    return this.db.withTenant(access, async (tx) => {
      await this.seedEstateChannels(tx, access.estateId);
      const buildingIds = await this.myBuildingIds(
        tx,
        access,
        settings['community.owners_in_building_channels'],
      );
      await this.ensureBuildingChannels(tx, access.estateId, buildingIds);
      const staff = isStaffWith(access, 'community.moderate');
      const explicit = await tx.channelMember.findMany({
        where: {
          estateId: access.estateId,
          userId: access.userId,
          status: { in: ['active', 'requested', 'invited'] },
        },
      });
      const explicitIds = explicit.map((row) => row.channelId);
      const rows = await tx.channel.findMany({
        where: {
          estateId: access.estateId,
          OR: query.mine
            ? [
                { type: 'estate', status: 'active' },
                { type: 'building', spaceId: { in: buildingIds } },
                { id: { in: explicitIds } },
                ...(staff ? [{ type: 'resident', status: 'pending_approval' }] : []),
              ]
            : [{ type: 'resident', status: 'active', privacy: { in: ['public', 'restricted'] } }],
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
      const prefs = new Map(explicit.map((row) => [row.channelId, row]));
      const directPeerIds = [
        ...new Set(
          rows
            .filter((row) => row.type === 'direct')
            .map((row) => otherDirectUserId(row.key, access.userId))
            .filter((id): id is string => id !== null),
        ),
      ];
      const peerNames =
        directPeerIds.length > 0 ? await this.users.contactsOf(directPeerIds) : new Map();
      return rows.map((row) => {
        const pref = prefs.get(row.id);
        const derived = row.type === 'estate' || row.type === 'building';
        const peerId = row.type === 'direct' ? otherDirectUserId(row.key, access.userId) : null;
        const displayName = peerId ? (peerNames.get(peerId)?.fullName ?? undefined) : undefined;
        return this.channelView(
          row,
          {
            member: derived || pref?.status === 'active',
            role: (pref?.role as Membership['role']) ?? (derived ? 'member' : null),
            status: (pref?.status as Membership['status']) ?? (derived ? 'active' : null),
            notify: (pref?.notify as Membership['notify']) ?? (derived ? 'mentions' : null),
            mutedUntil: pref?.mutedUntil ?? null,
            since: null,
          },
          displayName,
        );
      });
    });
  }

  private async seedEstateChannels(tx: Tx, estateId: string) {
    const count = await tx.channel.count({ where: { estateId, type: 'estate' } });
    if (count >= DEFAULT_ESTATE_CHANNELS.length) return;
    await tx.channel.createMany({
      data: DEFAULT_ESTATE_CHANNELS.map((channel) => ({
        estateId,
        type: 'estate',
        key: channel.key,
        name: channel.name,
        staffOnly: channel.staffOnly,
      })),
      skipDuplicates: true,
    });
  }

  private async myBuildingIds(
    tx: Tx,
    access: EstateAccess,
    includeOwned: boolean,
  ): Promise<string[]> {
    const units = (await this.occupancy.unitsSince(tx, access.estateId, access.userId)).map(
      (row) => row.spaceId,
    );
    if (includeOwned)
      units.push(
        ...(await this.property.ownedUnits(tx, access.estateId, access.userId)).map(
          (o) => o.ownership.spaceId,
        ),
      );
    const buildings = await this.property.buildingsOfUnits(tx, access.estateId, units);
    return [...new Set([...buildings.values()].map((building) => building.id))];
  }

  private async ensureBuildingChannels(tx: Tx, estateId: string, buildingIds: readonly string[]) {
    if (buildingIds.length === 0) return;
    const spaces = await this.property.spacesByIds(tx, estateId, buildingIds);
    await tx.channel.createMany({
      data: spaces.map((space) => ({
        estateId,
        type: 'building',
        key: space.id,
        spaceId: space.id,
        name: `${space.name || space.code} residents`,
      })),
      skipDuplicates: true,
    });
  }

  async create(access: EstateAccess, input: z.infer<typeof createChannelSchema>) {
    const settings = await this.tenancy.getSettings(access);
    const needsApproval =
      settings['community.channel_approval'] && !isStaffWith(access, 'community.moderate');
    return this.db.withTenant(access, async (tx) => {
      await this.assertCanParticipate(tx, access);
      const row = await tx.channel.create({
        data: {
          estateId: access.estateId,
          type: 'resident',
          name: input.name,
          description: input.description ?? null,
          category: input.category ?? null,
          privacy: input.privacy,
          status: needsApproval ? 'pending_approval' : 'active',
          createdBy: access.userId,
          ...(needsApproval ? {} : { approvedBy: access.userId }),
        },
      });
      await tx.channelMember.create({
        data: {
          estateId: access.estateId,
          channelId: row.id,
          userId: access.userId,
          role: 'owner',
        },
      });
      await this.event(tx, access, 'community.channel.created', row.id, {
        name: row.name,
        status: row.status,
      });
      return this.channelView(row, {
        member: true,
        role: 'owner',
        status: 'active',
        notify: 'all',
        mutedUntil: null,
        since: null,
      });
    });
  }

  async decide(
    access: EstateAccess,
    channelId: string,
    action: 'approve' | 'suspend' | 'archive' | 'reactivate',
    reason: string | null,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, channelId);
      const allowed: Record<typeof action, string[]> = {
        approve: ['pending_approval'],
        suspend: ['active'],
        archive: ['pending_approval', 'active', 'suspended'],
        reactivate: ['suspended'],
      };
      if (!allowed[action].includes(row.status) || row.type === 'direct')
        throw new ConflictError('CHANNEL_INVALID_TRANSITION', 'This channel cannot do that now');
      const status =
        action === 'approve' || action === 'reactivate'
          ? 'active'
          : action === 'suspend'
            ? 'suspended'
            : 'archived';
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: {
          status,
          ...(action === 'approve' ? { approvedBy: access.userId } : {}),
          ...(action === 'suspend' ? { suspendedAt: new Date() } : {}),
        },
      });
      await this.event(
        tx,
        access,
        `community.channel.${action === 'approve' ? 'approved' : action === 'suspend' ? 'suspended' : action === 'archive' ? 'archived' : 'reactivated'}`,
        channelId,
        { status },
        reason,
      );
      return this.channelView(updated, await this.membership(tx, access, updated));
    });
  }

  /** Public: join now. Restricted: request (owner or moderator accepts). Invite-only: needs an invite. */
  async join(access: EstateAccess, channelId: string) {
    return this.db.withTenant(access, async (tx) => {
      await this.assertCanParticipate(tx, access);
      const row = await this.load(tx, access.estateId, channelId);
      if (row.type !== 'resident' || row.status !== 'active')
        throw new ConflictError('CHANNEL_NOT_JOINABLE', 'You cannot join this channel');
      const existing = await tx.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId: access.userId } },
      });
      if (existing?.status === 'active')
        return this.channelView(row, await this.membership(tx, access, row));
      const status =
        existing?.status === 'invited' || row.privacy === 'public'
          ? 'active'
          : row.privacy === 'restricted'
            ? 'requested'
            : null;
      if (!status) throw new ForbiddenError('This channel is invite-only', 'CHANNEL_INVITE_ONLY');
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId, userId: access.userId } },
        create: { estateId: access.estateId, channelId, userId: access.userId, status },
        update: { status, joinedAt: new Date() },
      });
      return this.channelView(row, await this.membership(tx, access, row));
    });
  }

  /** Owner or moderator invites someone (invite-only), or accepts a request (restricted). */
  async invite(access: EstateAccess, channelId: string, userId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, channelId);
      await this.assertChannelModerator(tx, access, row);
      const member = await this.tenancy.activeMembership(userId, access.estateId);
      if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
      const existing = await tx.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });
      const status =
        existing?.status === 'requested'
          ? 'active'
          : existing?.status === 'active'
            ? 'active'
            : 'invited';
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId, userId } },
        create: { estateId: access.estateId, channelId, userId, status },
        update: { status },
      });
      return this.channelView(row, await this.membership(tx, access, row));
    });
  }

  /** Leave (yourself) or remove someone (channel owner/moderator or estate moderator). */
  async removeMember(access: EstateAccess, channelId: string, userId: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, channelId);
      if (row.type === 'building' || row.type === 'estate')
        throw new ConflictError(
          'CHANNEL_MEMBERSHIP_DERIVED',
          'Membership of this channel follows where you live',
        );
      if (userId !== access.userId) await this.assertChannelModerator(tx, access, row);
      await tx.channelMember.updateMany({
        where: { channelId, userId },
        data: { status: 'removed' },
      });
    });
  }

  async setPreferences(
    access: EstateAccess,
    channelId: string,
    notify: 'all' | 'mentions' | 'none',
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, channelId);
      const membership = await this.membership(tx, access, row);
      if (!membership.member) throw new NotFoundError('Channel not found', 'CHANNEL_NOT_FOUND');
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId, userId: access.userId } },
        create: { estateId: access.estateId, channelId, userId: access.userId, notify },
        update: { notify },
      });
      return this.channelView(row, { ...membership, notify });
    });
  }

  // ---- Direct messages and blocking ---------------------------------------------------------

  /** Rule 3: only within the estate, only when enabled, never with someone who blocked either way. */
  async startDirect(access: EstateAccess, userId: string) {
    const settings = await this.tenancy.getSettings(access);
    if (!settings['community.private_messaging'])
      throw new ForbiddenError(
        'Private messaging is not enabled in this estate',
        'FEATURE_NOT_ENABLED',
      );
    if (userId === access.userId)
      throw new DomainError('DIRECT_SELF', 'You cannot message yourself', 422);
    const other = await this.tenancy.activeMembership(userId, access.estateId);
    if (!other) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    return this.db.withTenant(access, async (tx) => {
      await this.assertCanParticipate(tx, access);
      await this.assertNotBlocked(tx, access.estateId, access.userId, userId);
      const key = directKey(access.userId, userId);
      await tx.channel.createMany({
        data: [
          {
            estateId: access.estateId,
            type: 'direct',
            key,
            name: 'Direct message',
            privacy: 'invite_only',
            createdBy: access.userId,
          },
        ],
        skipDuplicates: true,
      });
      const row = await tx.channel.findFirstOrThrow({
        where: { estateId: access.estateId, type: 'direct', key },
      });
      await tx.channelMember.createMany({
        data: [access.userId, userId].map((id) => ({
          estateId: access.estateId,
          channelId: row.id,
          userId: id,
        })),
        skipDuplicates: true,
      });
      const peerNames = await this.users.contactsOf([userId]);
      return this.channelView(
        row,
        await this.membership(tx, access, row),
        peerNames.get(userId)?.fullName ?? undefined,
      );
    });
  }

  async block(access: EstateAccess, userId: string) {
    await this.db.withTenant(access, (tx) =>
      tx.userBlock.createMany({
        data: [{ estateId: access.estateId, blockerId: access.userId, blockedId: userId }],
        skipDuplicates: true,
      }),
    );
  }

  async unblock(access: EstateAccess, userId: string) {
    await this.db.withTenant(access, (tx) =>
      tx.userBlock.deleteMany({
        where: { estateId: access.estateId, blockerId: access.userId, blockedId: userId },
      }),
    );
  }

  private async assertNotBlocked(tx: Tx, estateId: string, a: string, b: string) {
    const blocked = await tx.userBlock.count({
      where: {
        estateId,
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    if (blocked > 0) throw new ForbiddenError('You cannot message this person', 'USER_BLOCKED');
  }

  // ---- Messages ------------------------------------------------------------------------------

  async messages(
    access: EstateAccess,
    channelId: string,
    query: z.infer<typeof messageListQuerySchema>,
  ) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, channelId);
      const membership = await this.membership(tx, access, row);
      const moderator = isStaffWith(access, 'community.moderate');
      if (!membership.member && !moderator)
        throw new NotFoundError('Channel not found', 'CHANNEL_NOT_FOUND');
      const rows = await tx.message.findMany({
        where: {
          channelId,
          ...(membership.since && !moderator ? { createdAt: { gte: membership.since } } : {}),
          ...(query.q
            ? {
                body: { contains: query.q, mode: 'insensitive' },
                deletedAt: null,
                removedByModeration: false,
              }
            : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const views = await this.messageViews(tx, access, page);
      const last = page.at(-1);
      return {
        items: views,
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async post(access: EstateAccess, channelId: string, input: z.infer<typeof postMessageSchema>) {
    const attachments = await this.files.estateFilesOf(
      access.estateId,
      access.userId,
      input.attachmentFileIds,
      'document',
    );
    if (attachments.length !== new Set(input.attachmentFileIds).size)
      throw new DomainError('ATTACHMENT_INVALID', 'Upload the attachments first', 422);
    const created = await this.db.withTenant(access, async (tx) => {
      const profile = await this.assertCanParticipate(tx, access);
      const row = await this.load(tx, access.estateId, channelId);
      if (row.status !== 'active')
        throw new ConflictError('CHANNEL_NOT_ACTIVE', 'This channel is not open for posting');
      const membership = await this.membership(tx, access, row);
      if (!membership.member) throw new NotFoundError('Channel not found', 'CHANNEL_NOT_FOUND');
      // Rule 9: muted members read but do not post.
      const mutedUntil = [membership.mutedUntil, profile.mutedUntil].filter(
        (d): d is Date => d !== null && d > new Date(),
      );
      if (mutedUntil.length > 0)
        throw new ForbiddenError('You are muted in this channel for now', 'MEMBER_MUTED');
      if (row.staffOnly && !isStaffWith(access, 'announcement.publish'))
        throw new ForbiddenError(
          'Only estate management posts in this channel',
          'CHANNEL_STAFF_ONLY',
        );
      if (row.type === 'direct') {
        const other = row.key?.split(':').find((id) => id !== access.userId);
        if (other) await this.assertNotBlocked(tx, access.estateId, access.userId, other);
      }
      if (input.replyToId) {
        const parent = await tx.message.count({ where: { id: input.replyToId, channelId } });
        if (parent === 0) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      }
      const message = await tx.message.create({
        data: {
          estateId: access.estateId,
          channelId,
          authorId: access.userId,
          body: input.body,
          replyToId: input.replyToId ?? null,
          attachmentFileIds: attachments,
          mentionUserIds: input.mentionUserIds,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'community.message.posted',
          estateId: access.estateId,
          aggregateType: 'channel',
          aggregateId: channelId,
          payload: { channelId, messageId: message.id, authorId: access.userId },
        },
      ]);
      const recipients = await this.notifyList(tx, access, row, input.mentionUserIds);
      for (let index = 0; index < recipients.length; index += NOTIFY_CHUNK) {
        await this.notifications.request(tx, {
          intent: 'community.message',
          userIds: recipients.slice(index, index + NOTIFY_CHUNK),
          estateId: access.estateId,
          data: {
            channel: row.type === 'direct' ? 'Direct message' : row.name,
            preview: input.body.slice(0, 120),
            channelId,
            messageId: message.id,
          },
          dedupeKey: `message:${message.id}:${index}`,
        });
      }
      return message;
    });
    return this.db.withTenant(
      access,
      async (tx) => (await this.messageViews(tx, access, [created]))[0],
    );
  }

  /** Who gets a push: members set to `all`, plus mentioned members not set to `none`. Never the author. */
  private async notifyList(
    tx: Tx,
    access: EstateAccess,
    row: ChannelRow,
    mentions: readonly string[],
  ) {
    const prefs = await tx.channelMember.findMany({
      where: { channelId: row.id },
      select: { userId: true, notify: true, status: true },
    });
    const byUser = new Map(prefs.map((pref) => [pref.userId, pref]));
    const explicit = row.type === 'resident' || row.type === 'direct';
    const all = prefs
      .filter((pref) => (explicit ? pref.status === 'active' : true) && pref.notify === 'all')
      .map((pref) => pref.userId);
    const mentioned = mentions.filter(
      (id) =>
        byUser.get(id)?.notify !== 'none' && (!explicit || byUser.get(id)?.status === 'active'),
    );
    return [...new Set([...all, ...mentioned])].filter((id) => id !== access.userId);
  }

  async edit(access: EstateAccess, messageId: string, input: z.infer<typeof editMessageSchema>) {
    const row = await this.db.withTenant(access, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, estateId: access.estateId },
      });
      if (!message || message.authorId !== access.userId)
        throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      if (message.deletedAt || message.removedByModeration)
        throw new ConflictError('MESSAGE_GONE', 'This message was deleted');
      if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS)
        throw new ConflictError('MESSAGE_EDIT_EXPIRED', 'Messages can be edited for 15 minutes');
      return tx.message.update({
        where: { id: messageId },
        data: { body: input.body, editedAt: new Date() },
      });
    });
    return this.db.withTenant(
      access,
      async (tx) => (await this.messageViews(tx, access, [row]))[0],
    );
  }

  async deleteOwn(access: EstateAccess, messageId: string) {
    await this.db.withTenant(access, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, estateId: access.estateId },
      });
      if (!message || message.authorId !== access.userId)
        throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      if (!message.deletedAt)
        await tx.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    });
  }

  async react(access: EstateAccess, messageId: string, emoji: string, on: boolean) {
    const row = await this.db.withTenant(access, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, estateId: access.estateId },
      });
      if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      const channel = await this.load(tx, access.estateId, message.channelId);
      if (!(await this.membership(tx, access, channel)).member)
        throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      if (on) {
        await tx.messageReaction.createMany({
          data: [{ estateId: access.estateId, messageId, userId: access.userId, emoji }],
          skipDuplicates: true,
        });
      } else {
        await tx.messageReaction.deleteMany({ where: { messageId, userId: access.userId, emoji } });
      }
      return message;
    });
    return this.db.withTenant(
      access,
      async (tx) => (await this.messageViews(tx, access, [row]))[0],
    );
  }

  // ---- Shared checks -------------------------------------------------------------------------

  /** Guidelines accepted and not banned (community.md §2.14, §2.16). Returns the profile. */
  async assertCanParticipate(tx: Tx, access: EstateAccess) {
    const profile = await tx.communityProfile.findUnique({
      where: { estateId_userId: { estateId: access.estateId, userId: access.userId } },
    });
    if (!profile?.guidelinesAcceptedAt)
      throw new DomainError(
        'GUIDELINES_NOT_ACCEPTED',
        'Read and accept the community guidelines first',
        422,
      );
    if (profile.bannedUntil && profile.bannedUntil > new Date())
      throw new ForbiddenError('You are banned from the community', 'COMMUNITY_BANNED');
    return profile;
  }

  private async assertChannelModerator(tx: Tx, access: EstateAccess, row: ChannelRow) {
    if (isStaffWith(access, 'community.moderate')) return;
    const me = await tx.channelMember.findUnique({
      where: { channelId_userId: { channelId: row.id, userId: access.userId } },
    });
    if (me?.status !== 'active' || (me.role !== 'owner' && me.role !== 'moderator'))
      throw new ForbiddenError('Only the channel’s owner or moderators can do this');
  }

  /** Membership of the caller in a channel, derived for building and estate channels. */
  async membership(tx: Tx, access: EstateAccess, row: ChannelRow): Promise<Membership> {
    const pref = await tx.channelMember.findUnique({
      where: { channelId_userId: { channelId: row.id, userId: access.userId } },
    });
    if (row.type === 'estate') {
      return {
        member: row.status === 'active',
        role: 'member',
        status: 'active',
        notify: (pref?.notify as Membership['notify']) ?? 'mentions',
        mutedUntil: pref?.mutedUntil ?? null,
        since: null,
      };
    }
    if (row.type === 'building') {
      const mine = await this.occupancy.unitsSince(tx, access.estateId, access.userId);
      const buildings = await this.property.buildingsOfUnits(
        tx,
        access.estateId,
        mine.map((m) => m.spaceId),
      );
      const here = mine.filter((m) => buildings.get(m.spaceId)?.id === row.spaceId);
      let ownsHere = false;
      if (
        here.length === 0 &&
        (await this.tenancy.getSettings(access))['community.owners_in_building_channels']
      ) {
        const owned = await this.property.ownedUnits(tx, access.estateId, access.userId);
        const ownedBuildings = await this.property.buildingsOfUnits(
          tx,
          access.estateId,
          owned.map((o) => o.ownership.spaceId),
        );
        ownsHere = [...ownedBuildings.values()].some((building) => building.id === row.spaceId);
      }
      const member = here.length > 0 || ownsHere;
      const since =
        here.length > 0 ? new Date(Math.min(...here.map((m) => m.joinedAt.getTime()))) : null;
      return {
        member,
        role: member ? 'member' : null,
        status: member ? 'active' : null,
        notify: (pref?.notify as Membership['notify']) ?? (member ? 'mentions' : null),
        mutedUntil: pref?.mutedUntil ?? null,
        since,
      };
    }
    const active = pref?.status === 'active';
    return {
      member: active && row.status === 'active',
      role: (pref?.role as Membership['role']) ?? null,
      status: (pref?.status as Membership['status']) ?? null,
      notify: (pref?.notify as Membership['notify']) ?? null,
      mutedUntil: pref?.mutedUntil ?? null,
      since: null,
    };
  }

  async load(tx: Tx, estateId: string, id: string): Promise<ChannelRow> {
    const row = await tx.channel.findFirst({ where: { id, estateId } });
    if (!row) throw new NotFoundError('Channel not found', 'CHANNEL_NOT_FOUND');
    return row;
  }

  private async messageViews(tx: Tx, access: EstateAccess, rows: readonly MessageRow[]) {
    const reactions = await tx.messageReaction.findMany({
      where: { messageId: { in: rows.map((row) => row.id) } },
    });
    const names = await this.users.contactsOf([...new Set(rows.map((row) => row.authorId))]);
    return rows.map((row) => {
      const mine = reactions.filter((reaction) => reaction.messageId === row.id);
      const counts = new Map<string, { count: number; mine: boolean }>();
      for (const reaction of mine) {
        const entry = counts.get(reaction.emoji) ?? { count: 0, mine: false };
        entry.count += 1;
        entry.mine ||= reaction.userId === access.userId;
        counts.set(reaction.emoji, entry);
      }
      const state = row.removedByModeration
        ? ('removed' as const)
        : row.deletedAt
          ? ('deleted' as const)
          : ('visible' as const);
      return {
        id: row.id,
        channelId: row.channelId,
        authorId: row.authorId,
        // Rule 10: names only, never phone numbers.
        authorName: names.get(row.authorId)?.fullName ?? null,
        body: state === 'visible' ? row.body : null,
        replyToId: row.replyToId,
        attachmentFileIds: state === 'visible' ? row.attachmentFileIds : [],
        mentionUserIds: row.mentionUserIds,
        reactions: [...counts.entries()].map(([emoji, value]) => ({ emoji, ...value })),
        state,
        editedAt: row.editedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private channelView(row: ChannelRow, membership: Membership, displayName?: string) {
    return {
      id: row.id,
      type: row.type as 'building' | 'estate' | 'resident' | 'direct',
      name: displayName ?? row.name,
      description: row.description,
      category: row.category,
      privacy: row.privacy as 'public' | 'restricted' | 'invite_only',
      status: row.status as 'pending_approval' | 'active' | 'suspended' | 'archived',
      staffOnly: row.staffOnly,
      spaceId: row.spaceId,
      memberCount: null,
      myRole: membership.role,
      myStatus: membership.status,
      notify: membership.notify,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    type: string,
    channelId: string,
    after: Prisma.InputJsonValue,
    reason?: string | null,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'channel',
        aggregateId: channelId,
        payload: { channelId },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: CHANNEL_ACTIONS[type] ?? type,
          resourceType: 'channel',
          resourceId: channelId,
          after,
          ...(reason ? { reason } : {}),
        },
      },
    ]);
  }
}
