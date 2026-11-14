import { Injectable } from '@nestjs/common';
import type { announcementListQuerySchema, createAnnouncementSchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';

type AnnouncementRow = Prisma.AnnouncementGetPayload<object>;
const cursorSchema = z.object({ publishedAt: z.iso.datetime(), id: z.uuid() });
const CHUNK = 5000;

/** Official announcements (community.md §2.1, rule 5): only announcement.publish holders post them. */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async publish(access: EstateAccess, input: z.infer<typeof createAnnouncementSchema>) {
    const everyone =
      input.audience.type === 'estate' ? await this.tenancy.activeMemberIds(access.estateId) : [];
    return this.db.withTenant(access, async (tx) => {
      const spaceIds = input.audience.type === 'spaces' ? input.audience.spaceIds : [];
      const unitIds =
        spaceIds.length > 0 ? await this.property.unitIdsWithin(tx, access.estateId, spaceIds) : [];
      const recipients =
        input.audience.type === 'estate'
          ? everyone
          : await this.occupancy.residentUserIdsInUnits(tx, access.estateId, unitIds);
      const row = await tx.announcement.create({
        data: {
          estateId: access.estateId,
          title: input.title,
          body: input.body,
          category: input.category,
          priority: input.priority,
          audienceType: input.audience.type,
          audienceSpaceIds: spaceIds,
          audienceUnitIds: unitIds,
          authorId: access.userId,
          recipients: recipients.length,
        },
      });
      for (let start = 0; start < recipients.length; start += CHUNK) {
        await this.notifications.request(tx, {
          intent:
            input.priority === 'important'
              ? 'community.announcement_important'
              : 'community.announcement',
          userIds: recipients.slice(start, start + CHUNK),
          estateId: access.estateId,
          data: { title: input.title, body: input.body.slice(0, 160), announcementId: row.id },
          dedupeKey: `announcement:${row.id}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'community.announcement.published',
          estateId: access.estateId,
          aggregateType: 'announcement',
          aggregateId: row.id,
          payload: { announcementId: row.id, recipients: recipients.length },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'community.announcement.publish',
            resourceType: 'announcement',
            resourceId: row.id,
            after: {
              title: input.title,
              audience: input.audience.type,
              recipients: recipients.length,
            },
          },
        },
      ]);
      return this.view(row, null, recipients.length);
    });
  }

  /** Readers see estate-wide ones and those for their unit; management (`all`) sees everything. */
  async list(access: EstateAccess, query: z.infer<typeof announcementListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const management =
      query.all &&
      (isStaffWith(access, 'announcement.publish') || isStaffWith(access, 'resident.read'));
    const units = management
      ? []
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (household) => household.spaceId,
        );
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.announcement.findMany({
        where: {
          estateId: access.estateId,
          ...(management
            ? {}
            : {
                OR: [
                  { audienceType: 'estate' },
                  ...(units.length > 0 ? [{ audienceUnitIds: { hasSome: units } }] : []),
                ],
              }),
          ...(after
            ? {
                AND: [
                  {
                    OR: [
                      { publishedAt: { lt: new Date(after.publishedAt) } },
                      { publishedAt: new Date(after.publishedAt), id: { lt: after.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const reads = management
        ? new Set<string>()
        : new Set(
            (
              await tx.announcementRead.findMany({
                where: { userId: access.userId, announcementId: { in: page.map((row) => row.id) } },
                select: { announcementId: true },
              })
            ).map((read) => read.announcementId),
          );
      const last = page.at(-1);
      return {
        items: page.map((row) =>
          management
            ? this.view(row, null, row.recipients)
            : this.view(row, reads.has(row.id), null),
        ),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ publishedAt: last.publishedAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async markRead(access: EstateAccess, announcementId: string) {
    const units = (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
      (h) => h.spaceId,
    );
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.announcement.findFirst({
        where: { id: announcementId, estateId: access.estateId },
      });
      const visible =
        row &&
        (row.audienceType === 'estate' || row.audienceUnitIds.some((id) => units.includes(id)));
      if (!row || !visible)
        throw new NotFoundError('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
      await tx.announcementRead.createMany({
        data: [{ estateId: access.estateId, announcementId, userId: access.userId }],
        skipDuplicates: true,
      });
      return this.view(row, true, null);
    });
  }

  private view(row: AnnouncementRow, read: boolean | null, recipients: number | null) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      category: row.category as 'general',
      priority: row.priority as 'normal' | 'important',
      audienceType: row.audienceType as 'estate' | 'spaces',
      official: true as const,
      publishedAt: row.publishedAt.toISOString(),
      read,
      recipients,
    };
  }
}
