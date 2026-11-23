import { Inject, Injectable } from '@nestjs/common';
import {
  type AdCategory,
  type adEnquiryListQuerySchema,
  type AdPlacementKey,
  type addAdvertiserMemberSchema,
  type advertiserListQuerySchema,
  type createAdEnquirySchema,
  type createAdvertiserSchema,
  normalizeNigerianPhone,
  type updateAdEnquirySchema,
  type updateAdPlacementSchema,
  type updateAdvertiserSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { AdvertiserAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  RateLimitedError,
} from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { type AuditInput, appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { IdentityService } from '../identity/identity.service';
import { AdCache } from './ad-cache';
import { deriveAdEnquiryToken, hashAdEnquiryToken } from './domain/enquiry-token';

type EnquiryRow = Prisma.AdEnquiryGetPayload<object>;
type AdvertiserRow = Prisma.AdvertiserGetPayload<object>;

const ENQUIRIES_PER_IP_PER_HOUR = 5;
const ENQUIRY_STATUS_LOOKUPS_PER_IP_PER_HOUR = 30;
const cursorSchema = z.object({ createdAt: z.string(), id: z.uuid() });
const isCursor = (value: unknown): value is z.infer<typeof cursorSchema> =>
  cursorSchema.safeParse(value).success;

export function cursorWhere(cursor: string | undefined) {
  if (!cursor) return {};
  const c = decodeCursor(cursor, isCursor);
  return {
    OR: [
      { createdAt: { lt: new Date(c.createdAt) } },
      { createdAt: new Date(c.createdAt), id: { lt: c.id } },
    ],
  };
}

export function cursorPage<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

/** Advertising enquiries, advertisers and their teams, and the placements inventory (ADR-0024). */
@Injectable()
export class AdvertisersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly identity: IdentityService,
    private readonly rateLimiter: RateLimiter,
    private readonly cache: AdCache,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---- Enquiries -----------------------------------------------------------------------------

  async submitEnquiry(
    input: z.infer<typeof createAdEnquirySchema>,
    source: { kind: 'web'; ip: string | undefined } | { kind: 'resident_app'; userId: string },
  ) {
    const phone = normalizeNigerianPhone(input.phone);
    if (!phone) throw new DomainError('PHONE_INVALID', 'Enter a valid Nigerian phone number', 422);
    const limitKey =
      source.kind === 'web'
        ? source.ip
          ? `ad-enquiry:ip:${source.ip}`
          : null
        : `ad-enquiry:user:${source.userId}`;
    if (limitKey) {
      const limit = await this.rateLimiter.hit(limitKey, ENQUIRIES_PER_IP_PER_HOUR, 3600);
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    }
    const id = uuidv7();
    const trackingToken = deriveAdEnquiryToken(this.env.OTP_HMAC_SECRET, id);
    const trackingTokenHash = hashAdEnquiryToken(trackingToken);
    return this.db.withContext('advertising', async (tx) => {
      const row = await tx.adEnquiry.create({
        data: {
          id,
          source: source.kind,
          userId: source.kind === 'resident_app' ? source.userId : null,
          advertiserType: input.advertiserType,
          contactName: input.contactName,
          orgName: input.orgName ?? null,
          phone,
          email: input.email,
          category: input.category,
          objectives: input.objectives,
          description: input.description,
          budgetRange: input.budgetRange,
          durationWeeks: input.durationWeeks ?? null,
          audience: input.audience ?? null,
          placements: input.placements,
          trackingTokenHash,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'advertising.enquiry.submitted',
          estateId: null,
          aggregateType: 'ad_enquiry',
          aggregateId: row.id,
          payload: { enquiryId: row.id, source: row.source },
        },
      ]);
      return { id: row.id, status: row.status as 'submitted', trackingToken };
    });
  }

  /** Public link-based status lookup (public-web.md §7). Rate-limited; returns no PII or internal notes. */
  async publicEnquiryStatus(token: string, ip: string | undefined) {
    if (ip) {
      const limit = await this.rateLimiter.hit(
        `ad-enquiry:status:ip:${ip}`,
        ENQUIRY_STATUS_LOOKUPS_PER_IP_PER_HOUR,
        3600,
      );
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    }
    const tokenHash = hashAdEnquiryToken(token);
    return this.db.withContext('advertising', async (tx) => {
      const row = await tx.adEnquiry.findUnique({ where: { trackingTokenHash: tokenHash } });
      if (!row) throw new NotFoundError('Enquiry not found', 'AD_ENQUIRY_NOT_FOUND');
      return {
        id: row.id,
        status: row.status as 'submitted',
        advertiserType: row.advertiserType as 'individual' | 'organisation',
        orgName: row.orgName,
        category: row.category as AdCategory,
        budgetRange: row.budgetRange as 'not_sure',
        durationWeeks: row.durationWeeks,
        placements: row.placements as AdPlacementKey[],
        hasAdvertiserAccount: row.advertiserId !== null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async myEnquiries(userId: string) {
    return this.db.withContext('advertising', async (tx) =>
      (
        await tx.adEnquiry.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      ).map(enquiryView),
    );
  }

  async platformEnquiries(query: z.infer<typeof adEnquiryListQuerySchema>) {
    return this.db.withContext('advertising', async (tx) => {
      const rows = await tx.adEnquiry.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...cursorWhere(query.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = cursorPage(rows, query.limit);
      return { items: page.items.map(platformEnquiryView), nextCursor: page.nextCursor };
    });
  }

  async platformEnquiry(id: string) {
    return this.db.withContext('advertising', async (tx) =>
      platformEnquiryView(await this.loadEnquiry(tx, id)),
    );
  }

  async updateEnquiry(staffId: string, id: string, input: z.infer<typeof updateAdEnquirySchema>) {
    return this.db.withContext(
      'advertising',
      async (tx) => {
        const row = await this.loadEnquiry(tx, id);
        const updated = await tx.adEnquiry.update({
          where: { id: row.id },
          data: {
            ...(input.status ? { status: input.status } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          },
        });
        await this.event(tx, 'advertising.enquiry.updated', 'ad_enquiry', row.id, {
          actorType: 'platform_staff',
          actorId: staffId,
          action: 'advertising.enquiry.update',
          resourceType: 'ad_enquiry',
          resourceId: row.id,
          before: { status: row.status },
          after: { status: updated.status },
        });
        return platformEnquiryView(updated);
      },
      { userId: staffId },
    );
  }

  private async loadEnquiry(tx: Tx, id: string): Promise<EnquiryRow> {
    const row = await tx.adEnquiry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Enquiry not found', 'AD_ENQUIRY_NOT_FOUND');
    return row;
  }

  // ---- Advertisers ---------------------------------------------------------------------------

  async createAdvertiser(staffId: string, input: z.infer<typeof createAdvertiserSchema>) {
    const phone = normalizeNigerianPhone(input.ownerPhone);
    if (!phone) throw new DomainError('PHONE_INVALID', 'Enter a valid Nigerian phone number', 422);
    const ownerId = await this.identity.findOrCreateByPhone(phone, null, staffId);
    return this.db.withContext(
      'advertising',
      async (tx) => {
        const row = await tx.advertiser.create({
          data: {
            type: input.type,
            name: input.name,
            category: input.category,
            createdBy: staffId,
          },
        });
        await tx.advertiserMember.create({
          data: {
            advertiserId: row.id,
            userId: ownerId,
            role: input.type === 'organisation' ? 'advertiser_organisation_owner' : 'advertiser',
            addedBy: staffId,
          },
        });
        if (input.enquiryId) {
          await this.loadEnquiry(tx, input.enquiryId);
          await tx.adEnquiry.update({
            where: { id: input.enquiryId },
            data: { advertiserId: row.id },
          });
        }
        await this.event(tx, 'advertising.advertiser.created', 'advertiser', row.id, {
          actorType: 'platform_staff',
          actorId: staffId,
          action: 'advertising.advertiser.create',
          resourceType: 'advertiser',
          resourceId: row.id,
          after: { name: row.name, category: row.category },
        });
        return advertiserView(row, null);
      },
      { userId: staffId },
    );
  }

  async platformAdvertisers(query: z.infer<typeof advertiserListQuerySchema>) {
    return this.db.withContext('advertising', async (tx) => {
      const rows = await tx.advertiser.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...cursorWhere(query.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = cursorPage(rows, query.limit);
      return { items: page.items.map((r) => advertiserView(r, null)), nextCursor: page.nextCursor };
    });
  }

  async platformAdvertiser(id: string) {
    return this.db.withContext('advertising', async (tx) =>
      advertiserView(await this.load(tx, id), null),
    );
  }

  /** Verification and suspension (rule 9: suspension takes effect at once; the decision cache is purged). */
  async updateAdvertiser(
    staffId: string,
    id: string,
    input: z.infer<typeof updateAdvertiserSchema>,
  ) {
    const result = await this.db.withContext(
      'advertising',
      async (tx) => {
        const row = await this.load(tx, id);
        const verifying =
          input.verificationStatus === 'verified' && row.verificationStatus !== 'verified';
        const updated = await tx.advertiser.update({
          where: { id: row.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.verificationStatus !== undefined
              ? { verificationStatus: input.verificationStatus }
              : {}),
            ...(verifying ? { verifiedAt: new Date(), verifiedBy: staffId } : {}),
            ...(input.status !== undefined
              ? {
                  status: input.status,
                  suspendedReason: input.status === 'suspended' ? (input.reason ?? null) : null,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        await this.event(
          tx,
          input.status === 'suspended' && row.status !== 'suspended'
            ? 'advertising.advertiser.suspended'
            : 'advertising.advertiser.updated',
          'advertiser',
          row.id,
          {
            actorType: 'platform_staff',
            actorId: staffId,
            action: 'advertising.advertiser.update',
            resourceType: 'advertiser',
            resourceId: row.id,
            before: {
              status: row.status,
              verificationStatus: row.verificationStatus,
              category: row.category,
            },
            after: {
              status: updated.status,
              verificationStatus: updated.verificationStatus,
              category: updated.category,
            },
            reason: input.reason ?? null,
          },
        );
        return advertiserView(updated, null);
      },
      { userId: staffId },
    );
    // Rule 9: a suspension or category change takes effect at once.
    this.cache.purge();
    return result;
  }

  async myAdvertisers(userId: string) {
    return this.db.withContext('advertising', async (tx) => {
      const members = await tx.advertiserMember.findMany({
        where: { userId, removedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const advertisers = await tx.advertiser.findMany({
        where: { id: { in: members.map((m) => m.advertiserId) } },
        select: { id: true, name: true, status: true },
      });
      const byId = new Map(advertisers.map((a) => [a.id, a]));
      return members.flatMap((m) => {
        const a = byId.get(m.advertiserId);
        return a
          ? [{ id: a.id, name: a.name, status: a.status as 'active', role: m.role as 'advertiser' }]
          : [];
      });
    });
  }

  async get(access: AdvertiserAccess) {
    return this.db.withContext('advertising', async (tx) =>
      advertiserView(await this.load(tx, access.advertiserId), access.role),
    );
  }

  async members(access: AdvertiserAccess) {
    const rows = await this.db.withContext('advertising', (tx) =>
      tx.advertiserMember.findMany({
        where: { advertiserId: access.advertiserId, removedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const contacts = await this.identity.contactsOf(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      displayName: contacts.get(r.userId)?.fullName ?? null,
      role: r.role as 'advertiser',
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addMember(access: AdvertiserAccess, input: z.infer<typeof addAdvertiserMemberSchema>) {
    const phone = normalizeNigerianPhone(input.phone);
    if (!phone) throw new DomainError('PHONE_INVALID', 'Enter a valid Nigerian phone number', 422);
    const userId = await this.identity.findOrCreateByPhone(phone, null, access.userId);
    await this.db.withContext('advertising', async (tx) => {
      const existing = await tx.advertiserMember.findFirst({
        where: { advertiserId: access.advertiserId, userId, removedAt: null },
      });
      if (existing) throw new ConflictError('MEMBER_EXISTS', 'This person is already on the team');
      const row = await tx.advertiserMember.create({
        data: {
          advertiserId: access.advertiserId,
          userId,
          role: input.role,
          addedBy: access.userId,
        },
      });
      await this.event(
        tx,
        'advertising.advertiser_member.added',
        'advertiser',
        access.advertiserId,
        {
          actorType: 'user',
          actorId: access.userId,
          action: 'advertising.advertiser_member.add',
          resourceType: 'advertiser_member',
          resourceId: row.id,
          after: { role: input.role },
        },
      );
    });
    return this.members(access);
  }

  async removeMember(access: AdvertiserAccess, memberId: string) {
    await this.db.withContext('advertising', async (tx) => {
      const row = await tx.advertiserMember.findFirst({
        where: { id: memberId, advertiserId: access.advertiserId, removedAt: null },
      });
      if (!row) throw new NotFoundError('Team member not found', 'MEMBER_NOT_FOUND');
      if (row.userId === access.userId)
        throw new ConflictError('CANNOT_REMOVE_SELF', 'You cannot remove yourself');
      await tx.advertiserMember.update({ where: { id: row.id }, data: { removedAt: new Date() } });
      await this.event(
        tx,
        'advertising.advertiser_member.removed',
        'advertiser',
        access.advertiserId,
        {
          actorType: 'user',
          actorId: access.userId,
          action: 'advertising.advertiser_member.remove',
          resourceType: 'advertiser_member',
          resourceId: row.id,
          before: { role: row.role },
        },
      );
    });
    return this.members(access);
  }

  async load(tx: Tx, id: string): Promise<AdvertiserRow> {
    const row = await tx.advertiser.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Advertiser not found', 'ADVERTISER_NOT_FOUND');
    return row;
  }

  // ---- Placements ----------------------------------------------------------------------------

  async placements() {
    return this.db.withContext('advertising', async (tx) =>
      (await tx.adPlacement.findMany({ orderBy: { key: 'asc' } })).map(placementView),
    );
  }

  async updatePlacement(
    staffId: string,
    key: AdPlacementKey,
    input: z.infer<typeof updateAdPlacementSchema>,
  ) {
    return this.db.withContext(
      'advertising',
      async (tx) => {
        const row = await tx.adPlacement.findUnique({ where: { key } });
        if (!row) throw new NotFoundError('Placement not found', 'AD_PLACEMENT_NOT_FOUND');
        const updated = await tx.adPlacement.update({
          where: { key },
          data: {
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.frequencyCapPerDay !== undefined
              ? { frequencyCapPerDay: input.frequencyCapPerDay }
              : {}),
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'advertising.placement.updated',
            estateId: null,
            aggregateType: 'ad_placement',
            aggregateId: key,
            payload: { key },
            audit: {
              actorType: 'platform_staff',
              actorId: staffId,
              action: 'advertising.placement.update',
              resourceType: 'ad_placement',
              resourceId: null,
              before: { active: row.active, frequencyCapPerDay: row.frequencyCapPerDay },
              after: { active: updated.active, frequencyCapPerDay: updated.frequencyCapPerDay },
            },
          },
        ]);
        return placementView(updated);
      },
      { userId: staffId },
    );
  }

  private async event(
    tx: Tx,
    type: string,
    aggregateType: string,
    aggregateId: string,
    audit: AuditInput,
  ) {
    await appendOutboxEvents(tx, [
      { type, estateId: null, aggregateType, aggregateId, payload: { id: aggregateId }, audit },
    ]);
  }
}

function enquiryView(row: EnquiryRow) {
  return {
    id: row.id,
    source: row.source as 'web',
    advertiserType: row.advertiserType as 'individual',
    contactName: row.contactName,
    orgName: row.orgName,
    category: row.category as AdCategory,
    objectives: row.objectives,
    description: row.description,
    budgetRange: row.budgetRange as 'not_sure',
    durationWeeks: row.durationWeeks,
    audience: row.audience,
    placements: row.placements as AdPlacementKey[],
    status: row.status as 'submitted',
    advertiserId: row.advertiserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function platformEnquiryView(row: EnquiryRow) {
  return {
    ...enquiryView(row),
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    assigneeId: row.assigneeId,
  };
}

export function advertiserView(row: AdvertiserRow, myRole: string | null) {
  return {
    id: row.id,
    type: row.type as 'individual',
    name: row.name,
    category: row.category as AdCategory,
    verificationStatus: row.verificationStatus as 'verified',
    status: row.status as 'active',
    myRole: myRole as 'advertiser' | null,
    createdAt: row.createdAt.toISOString(),
  };
}

function placementView(row: Prisma.AdPlacementGetPayload<object>) {
  return {
    key: row.key as AdPlacementKey,
    surface: row.surface,
    formats: row.formats,
    width: row.width,
    height: row.height,
    maxFileKb: row.maxFileKb,
    frequencyCapPerDay: row.frequencyCapPerDay,
    active: row.active,
  };
}
