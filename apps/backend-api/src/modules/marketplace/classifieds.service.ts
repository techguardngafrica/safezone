import { Injectable } from '@nestjs/common';
import type {
  classifiedListQuerySchema,
  createClassifiedSchema,
  postClassifiedMessageSchema,
  updateClassifiedSchema,
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
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith } from '../occupancy/occupancy.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  classifiedExpiry,
  effectiveClassifiedStatus,
  MAX_ACTIVE_CLASSIFIEDS,
  sellerCanEdit,
} from './domain/marketplace';

type ClassifiedRow = Prisma.ClassifiedListingGetPayload<object>;
const cursorSchema = z.object({ createdAt: z.string(), id: z.uuid() });
const isCursor = (value: unknown): value is z.infer<typeof cursorSchema> =>
  cursorSchema.safeParse(value).success;

/**
 * Estate classifieds (ADR-0023, marketplace.md §2.1): residents sell items and services to neighbours.
 * Visible only inside the estate; moderated by staff with marketplace.moderate; no commission.
 */
@Injectable()
export class ClassifiedsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(access: EstateAccess, query: z.infer<typeof classifiedListQuerySchema>) {
    const moderator = isStaffWith(access, 'marketplace.moderate');
    const now = new Date();
    const statusFilter: Prisma.ClassifiedListingWhereInput = query.mine
      ? { sellerUserId: access.userId, ...(query.status ? { status: query.status } : {}) }
      : moderator && query.status
        ? query.status === 'expired'
          ? { status: 'active', expiresAt: { lte: now } }
          : { status: query.status }
        : { status: 'active', expiresAt: { gt: now } };
    const after = query.cursor ? decodeCursor(query.cursor, isCursor) : null;
    const rows = await this.db.withTenant(access, (tx) =>
      tx.classifiedListing.findMany({
        where: {
          estateId: access.estateId,
          ...statusFilter,
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
          ...(after
            ? {
                AND: [
                  {
                    OR: [
                      { createdAt: { lt: new Date(after.createdAt) } },
                      { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const names = await this.identity.contactsOf([...new Set(page.map((r) => r.sellerUserId))]);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.view(row, access, names, now)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async get(access: EstateAccess, id: string) {
    const row = await this.db.withTenant(access, (tx) => this.loadReadable(tx, access, id));
    const names = await this.identity.contactsOf([row.sellerUserId]);
    return this.view(row, access, names, new Date());
  }

  async create(access: EstateAccess, input: z.infer<typeof createClassifiedSchema>) {
    const settings = await this.tenancy.getSettings(access);
    if (!settings['marketplace.classifieds_enabled'])
      throw new ForbiddenError('Classifieds are turned off in this estate', 'CLASSIFIEDS_DISABLED');
    if (input.kind === 'service' && input.condition)
      throw new DomainError('CONDITION_FOR_ITEMS', 'Condition applies to items only', 422);
    const now = new Date();
    const row = await this.db.withTenant(access, async (tx) => {
      const active = await tx.classifiedListing.count({
        where: {
          estateId: access.estateId,
          sellerUserId: access.userId,
          status: 'active',
          expiresAt: { gt: now },
        },
      });
      if (active >= MAX_ACTIVE_CLASSIFIEDS)
        throw new ConflictError(
          'CLASSIFIEDS_LIMIT',
          `You can have up to ${MAX_ACTIVE_CLASSIFIEDS} active listings. Mark some as sold or withdraw them.`,
        );
      const created = await tx.classifiedListing.create({
        data: {
          estateId: access.estateId,
          sellerUserId: access.userId,
          kind: input.kind,
          title: input.title,
          description: input.description,
          price: input.priceKobo === undefined ? null : BigInt(input.priceKobo),
          negotiable: input.negotiable,
          condition: input.condition ?? null,
          photoFileIds: input.photoFileIds,
          expiresAt: classifiedExpiry(now),
        },
      });
      await this.event(tx, access, created.id, 'marketplace.classified.posted', 'post', {
        title: created.title,
      });
      return created;
    });
    return this.get(access, row.id);
  }

  async update(access: EstateAccess, id: string, input: z.infer<typeof updateClassifiedSchema>) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadReadable(tx, access, id);
      if (row.sellerUserId !== access.userId) throw new ForbiddenError();
      if (!sellerCanEdit(row.status))
        throw new ForbiddenError('This listing was hidden by the estate', 'CLASSIFIED_HIDDEN');
      const renew = input.status === 'active';
      await tx.classifiedListing.update({
        where: { id: row.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priceKobo !== undefined
            ? { price: input.priceKobo === null ? null : BigInt(input.priceKobo) }
            : {}),
          ...(input.negotiable !== undefined ? { negotiable: input.negotiable } : {}),
          ...(input.condition !== undefined ? { condition: input.condition } : {}),
          ...(input.photoFileIds !== undefined ? { photoFileIds: input.photoFileIds } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(renew ? { expiresAt: classifiedExpiry(new Date()) } : {}),
          version: { increment: 1 },
        },
      });
      await this.event(tx, access, row.id, 'marketplace.classified.updated', 'update', {
        fields: Object.keys(input),
      });
    });
    return this.get(access, id);
  }

  async hide(access: EstateAccess, id: string, reason: string) {
    return this.moderate(access, id, 'hidden', reason);
  }

  async restore(access: EstateAccess, id: string) {
    return this.moderate(access, id, 'active', null);
  }

  private async moderate(
    access: EstateAccess,
    id: string,
    status: 'hidden' | 'active',
    reason: string | null,
  ) {
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.classifiedListing.findFirst({
        where: { id, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Listing not found', 'CLASSIFIED_NOT_FOUND');
      if (status === 'active' && row.status !== 'hidden')
        throw new ConflictError('CLASSIFIED_NOT_HIDDEN', 'Only hidden listings can be restored');
      await tx.classifiedListing.update({
        where: { id: row.id },
        data: {
          status,
          hiddenReason: reason,
          hiddenBy: status === 'hidden' ? access.userId : null,
          version: { increment: 1 },
        },
      });
      await this.event(
        tx,
        access,
        row.id,
        status === 'hidden' ? 'marketplace.classified.hidden' : 'marketplace.classified.restored',
        status === 'hidden' ? 'hide' : 'restore',
        { status },
        reason,
      );
    });
    return this.get(access, id);
  }

  // ---- Enquiries -----------------------------------------------------------------------------

  /** The seller sees every buyer's thread; a buyer sees only their own. */
  async threads(access: EstateAccess, id: string) {
    const { listing, messages } = await this.db.withTenant(access, async (tx) => {
      const listing = await this.loadReadable(tx, access, id);
      const seller = listing.sellerUserId === access.userId;
      const messages = await tx.classifiedMessage.findMany({
        where: { listingId: id, ...(seller ? {} : { buyerUserId: access.userId }) },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      });
      return { listing, messages };
    });
    const byBuyer = new Map<string, typeof messages>();
    for (const m of messages)
      byBuyer.set(m.buyerUserId, [...(byBuyer.get(m.buyerUserId) ?? []), m]);
    const names = await this.identity.contactsOf([...byBuyer.keys()]);
    return [...byBuyer.entries()]
      .map(([buyerUserId, rows]) => ({
        buyerUserId,
        buyerName: names.get(buyerUserId)?.fullName ?? null,
        lastMessageAt: (rows.at(-1)?.createdAt ?? new Date()).toISOString(),
        messages: rows.map((m) => ({
          id: m.id,
          buyerUserId: m.buyerUserId,
          fromSeller: m.authorId === listing.sellerUserId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      }))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async postMessage(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof postClassifiedMessageSchema>,
  ) {
    await this.db.withTenant(access, async (tx) => {
      const listing = await this.loadReadable(tx, access, id);
      const seller = listing.sellerUserId === access.userId;
      let buyerUserId: string;
      if (seller) {
        if (!input.buyerUserId)
          throw new DomainError('BUYER_REQUIRED', 'Choose which enquiry to reply to', 422);
        const thread = await tx.classifiedMessage.findFirst({
          where: { listingId: id, buyerUserId: input.buyerUserId },
          select: { id: true },
        });
        if (!thread) throw new NotFoundError('Enquiry not found', 'ENQUIRY_NOT_FOUND');
        buyerUserId = input.buyerUserId;
      } else {
        if (effectiveClassifiedStatus(listing.status, listing.expiresAt, new Date()) !== 'active')
          throw new ConflictError('CLASSIFIED_CLOSED', 'This listing is no longer available');
        buyerUserId = access.userId;
      }
      await tx.classifiedMessage.create({
        data: {
          estateId: access.estateId,
          listingId: id,
          buyerUserId,
          authorId: access.userId,
          body: input.body,
        },
      });
      await this.notifications.request(tx, {
        intent: 'marketplace.classified_message',
        userIds: [seller ? buyerUserId : listing.sellerUserId],
        estateId: access.estateId,
        data: { listing: listing.title, listingId: listing.id },
        dedupeKey: `classified:${listing.id}:${buyerUserId}:${Date.now()}`,
      });
    });
    return this.threads(access, id);
  }

  // ---- Helpers -------------------------------------------------------------------------------

  /** Hidden listings are visible to their seller and to moderators only. */
  private async loadReadable(tx: Tx, access: EstateAccess, id: string): Promise<ClassifiedRow> {
    const row = await tx.classifiedListing.findFirst({ where: { id, estateId: access.estateId } });
    const readable =
      row &&
      (row.status === 'active' ||
        row.sellerUserId === access.userId ||
        isStaffWith(access, 'marketplace.moderate'));
    if (!row || !readable) throw new NotFoundError('Listing not found', 'CLASSIFIED_NOT_FOUND');
    return row;
  }

  private view(
    row: ClassifiedRow,
    access: EstateAccess,
    names: Map<string, { fullName: string | null }>,
    now: Date,
  ) {
    const mine = row.sellerUserId === access.userId;
    return {
      id: row.id,
      kind: row.kind as 'item' | 'service',
      title: row.title,
      description: row.description,
      priceKobo: row.price === null ? null : Number(row.price),
      negotiable: row.negotiable,
      condition: row.condition as 'new' | null,
      photoFileIds: row.photoFileIds,
      status: effectiveClassifiedStatus(row.status, row.expiresAt, now) as 'active',
      seller: {
        userId: row.sellerUserId,
        displayName: names.get(row.sellerUserId)?.fullName ?? null,
      },
      mine,
      hiddenReason: mine || isStaffWith(access, 'marketplace.moderate') ? row.hiddenReason : null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    id: string,
    type: string,
    verb: string,
    after: Prisma.InputJsonValue,
    reason: string | null = null,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'classified_listing',
        aggregateId: id,
        payload: { listingId: id },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: `marketplace.classified.${verb}`,
          resourceType: 'classified_listing',
          resourceId: id,
          after,
          reason,
        },
      },
    ]);
  }
}
