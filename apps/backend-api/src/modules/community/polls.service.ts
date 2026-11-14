import { Injectable } from '@nestjs/common';
import type { createPollSchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';

type PollRow = Prisma.PollGetPayload<{ include: { options: true } }>;

/**
 * Official polls (community.md §2.12): estate-wide or for some spaces, one vote per user or per household,
 * anonymous or named. Results show after you vote or once the poll closes.
 */
@Injectable()
export class PollsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(access: EstateAccess, input: z.infer<typeof createPollSchema>) {
    if (new Date(input.closesAt) <= new Date())
      throw new DomainError('POLL_CLOSES_IN_PAST', 'Choose a closing time in the future', 422);
    const everyone =
      input.audience.type === 'estate' ? await this.tenancy.activeMemberIds(access.estateId) : [];
    const id = await this.db.withTenant(access, async (tx) => {
      const units =
        input.audience.type === 'spaces'
          ? await this.property.unitIdsWithin(tx, access.estateId, input.audience.spaceIds)
          : [];
      const row = await tx.poll.create({
        data: {
          estateId: access.estateId,
          question: input.question,
          closesAt: new Date(input.closesAt),
          anonymous: input.anonymous,
          votePer: input.votePer,
          audienceType: input.audience.type,
          audienceUnitIds: units,
          createdBy: access.userId,
          options: {
            create: input.options.map((label, position) => ({
              estateId: access.estateId,
              label,
              position,
            })),
          },
        },
      });
      const recipients =
        input.audience.type === 'estate'
          ? everyone
          : await this.occupancy.residentUserIdsInUnits(tx, access.estateId, units);
      for (let index = 0; index < recipients.length; index += 5000) {
        await this.notifications.request(tx, {
          intent: 'community.poll',
          userIds: recipients.slice(index, index + 5000),
          estateId: access.estateId,
          data: { question: input.question.slice(0, 120), pollId: row.id },
          dedupeKey: `poll:${row.id}:${index}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'community.poll.created',
          estateId: access.estateId,
          aggregateType: 'poll',
          aggregateId: row.id,
          payload: { pollId: row.id, recipients: recipients.length },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'community.poll.create',
            resourceType: 'poll',
            resourceId: row.id,
            after: { question: input.question },
          },
        },
      ]);
      return row.id;
    });
    return this.get(access, id);
  }

  private async eligibleUnits(access: EstateAccess) {
    return this.occupancy.householdsOf(access.estateId, access.userId);
  }

  private inAudience(row: PollRow, units: readonly string[]): boolean {
    return (
      row.audienceType === 'estate' || row.audienceUnitIds.some((unit) => units.includes(unit))
    );
  }

  async list(access: EstateAccess) {
    const households = await this.eligibleUnits(access);
    const staff = isStaffWith(access, 'announcement.publish');
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.poll.findMany({
        where: { estateId: access.estateId },
        include: { options: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const units = households.map((h) => h.spaceId);
      const visible = rows.filter((row) => staff || this.inAudience(row, units));
      return Promise.all(
        visible.map((row) =>
          this.view(
            tx,
            access,
            row,
            households.map((h) => h.householdId),
          ),
        ),
      );
    });
  }

  async get(access: EstateAccess, id: string) {
    const households = await this.eligibleUnits(access);
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(
        tx,
        access,
        id,
        households.map((h) => h.spaceId),
      );
      return this.view(
        tx,
        access,
        row,
        households.map((h) => h.householdId),
      );
    });
  }

  async vote(access: EstateAccess, id: string, optionId: string) {
    const households = await this.eligibleUnits(access);
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(
        tx,
        access,
        id,
        households.map((h) => h.spaceId),
      );
      if (row.closesAt <= new Date())
        throw new ConflictError('POLL_CLOSED', 'This poll has closed');
      if (!row.options.some((option) => option.id === optionId))
        throw new NotFoundError('Option not found', 'POLL_OPTION_NOT_FOUND');
      if (
        row.audienceType === 'spaces' &&
        !this.inAudience(
          row,
          households.map((h) => h.spaceId),
        )
      )
        throw new NotFoundError('Poll not found', 'POLL_NOT_FOUND');
      let voterKey = `user:${access.userId}`;
      if (row.votePer === 'household') {
        const household = households.find(
          (h) => row.audienceType === 'estate' || row.audienceUnitIds.includes(h.spaceId),
        );
        if (!household)
          throw new DomainError(
            'POLL_HOUSEHOLD_REQUIRED',
            'This poll is one vote per household',
            422,
          );
        voterKey = `household:${household.householdId}`;
      }
      const created = await tx.pollVote.createMany({
        data: [
          { estateId: access.estateId, pollId: id, optionId, userId: access.userId, voterKey },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0)
        throw new ConflictError(
          'POLL_ALREADY_VOTED',
          row.votePer === 'household'
            ? 'Your household has already voted'
            : 'You have already voted',
        );
      return this.view(
        tx,
        access,
        row,
        households.map((h) => h.householdId),
      );
    });
  }

  /** Named polls only: who voted for what (management). */
  async voters(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.poll.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Poll not found', 'POLL_NOT_FOUND');
      if (row.anonymous)
        throw new ConflictError('POLL_ANONYMOUS', 'Votes on this poll are anonymous');
      const votes = await tx.pollVote.findMany({
        where: { pollId: id },
        orderBy: { votedAt: 'asc' },
      });
      return votes.map((vote) => ({
        userId: vote.userId,
        optionId: vote.optionId,
        votedAt: vote.votedAt.toISOString(),
      }));
    });
  }

  /** Worker: announce closed polls once (community.poll.closed). */
  async closeDue(estateId: string, now: Date = new Date()): Promise<number> {
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const due = await tx.poll.findMany({
        where: { estateId, closedNotified: false, closesAt: { lte: now } },
        take: 200,
      });
      for (const poll of due) {
        await tx.poll.update({ where: { id: poll.id }, data: { closedNotified: true } });
        await appendOutboxEvents(tx, [
          {
            type: 'community.poll.closed',
            estateId,
            aggregateType: 'poll',
            aggregateId: poll.id,
            payload: { pollId: poll.id },
          },
        ]);
      }
      return due.length;
    });
  }

  private async load(
    tx: Tx,
    access: EstateAccess,
    id: string,
    units: readonly string[],
  ): Promise<PollRow> {
    const row = await tx.poll.findFirst({
      where: { id, estateId: access.estateId },
      include: { options: { orderBy: { position: 'asc' } } },
    });
    if (!row || (!isStaffWith(access, 'announcement.publish') && !this.inAudience(row, units)))
      throw new NotFoundError('Poll not found', 'POLL_NOT_FOUND');
    return row;
  }

  private async view(tx: Tx, access: EstateAccess, row: PollRow, households: readonly string[]) {
    const closed = row.closesAt <= new Date();
    const keys = [`user:${access.userId}`, ...households.map((h) => `household:${h}`)];
    const mine = await tx.pollVote.findFirst({ where: { pollId: row.id, voterKey: { in: keys } } });
    const showResults = closed || mine !== null || isStaffWith(access, 'announcement.publish');
    const counts = showResults
      ? new Map(
          (
            await tx.pollVote.groupBy({
              by: ['optionId'],
              where: { pollId: row.id },
              _count: { _all: true },
            })
          ).map((c) => [c.optionId, c._count._all]),
        )
      : null;
    return {
      id: row.id,
      question: row.question,
      options: row.options.map((option) => ({
        id: option.id,
        label: option.label,
        votes: counts ? (counts.get(option.id) ?? 0) : null,
      })),
      closesAt: row.closesAt.toISOString(),
      anonymous: row.anonymous,
      votePer: row.votePer as 'user' | 'household',
      status: (closed ? 'closed' : 'open') as 'open' | 'closed',
      totalVotes: counts ? [...counts.values()].reduce((a, b) => a + b, 0) : null,
      myVoteOptionId: mine?.optionId ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
