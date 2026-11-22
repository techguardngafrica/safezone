import { Injectable } from '@nestjs/common';
import {
  type addVendorMemberSchema,
  type createListingSchema,
  normalizeNigerianPhone,
  type platformVendorListQuerySchema,
  type setCommissionRuleSchema,
  type updateListingSchema,
  type updateVendorSchema,
  type vendorApplicationSchema,
  type vendorListingQuerySchema,
  type vendorPayoutSetupSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { VendorAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { type AuditInput, appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { ratingAverage } from './domain/marketplace';

type VendorRow = Prisma.VendorGetPayload<object>;
type ListingRow = Prisma.ListingGetPayload<object>;
type AreaRow = Prisma.VendorServiceAreaGetPayload<object>;

const OPEN_STATUSES = ['applied', 'under_review', 'approved', 'suspended'];
const cursorSchema = z.object({ createdAt: z.string(), id: z.uuid() });
const isCursor = (value: unknown): value is z.infer<typeof cursorSchema> =>
  cursorSchema.safeParse(value).success;

function after(cursor: string | undefined) {
  if (!cursor) return {};
  const c = decodeCursor(cursor, isCursor);
  return {
    OR: [
      { createdAt: { lt: new Date(c.createdAt) } },
      { createdAt: new Date(c.createdAt), id: { lt: c.id } },
    ],
  };
}

function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
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

/**
 * Vendors, their teams, payout accounts and listings, plus Techguard's review (marketplace.md §2,
 * ADR-0023). All tables here are platform-level, reached through the `marketplace` context.
 */
@Injectable()
export class VendorsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly identity: IdentityService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Catalogue -----------------------------------------------------------------------------

  async categories() {
    return this.db.withContext('marketplace', async (tx) =>
      (
        await tx.serviceCategory.findMany({
          where: { status: 'active' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
      ).map((row) => ({
        id: row.id,
        parentId: row.parentId,
        slug: row.slug,
        name: row.name,
        kind: row.kind as 'service' | 'goods',
      })),
    );
  }

  // ---- Applications and profile --------------------------------------------------------------

  async apply(userId: string, input: z.infer<typeof vendorApplicationSchema>) {
    return this.db.withContext(
      'marketplace',
      async (tx) => {
        const open = await tx.vendor.findFirst({
          where: { ownerUserId: userId, status: { in: OPEN_STATUSES } },
          select: { id: true },
        });
        if (open)
          throw new ConflictError('VENDOR_ALREADY_EXISTS', 'You already have a vendor account');
        await this.assertCategories(tx, input.categoryIds);
        const vendor = await tx.vendor.create({
          data: {
            name: input.name,
            type: input.type,
            verificationTier: input.type === 'company' ? 'business' : 'individual',
            cacNumber: input.cacNumber?.toUpperCase() ?? null,
            description: input.description,
            contactEmail: input.contactEmail,
            ownerUserId: userId,
            categoryIds: input.categoryIds,
          },
        });
        await tx.vendorMember.create({
          data: { vendorId: vendor.id, userId, role: 'vendor_owner', addedBy: userId },
        });
        await this.replaceAreas(tx, vendor.id, input.serviceAreas);
        if (input.documentFileIds.length > 0) {
          await tx.vendorDocument.createMany({
            data: input.documentFileIds.map((fileId) => ({
              vendorId: vendor.id,
              fileId,
              docType: 'verification',
            })),
          });
        }
        await this.event(tx, vendor.id, 'marketplace.vendor.applied', {
          actorType: 'user',
          actorId: userId,
          action: 'marketplace.vendor.apply',
          resourceType: 'vendor',
          resourceId: vendor.id,
          after: { name: input.name, type: input.type },
        });
        return this.view(tx, vendor, 'vendor_owner');
      },
      { userId },
    );
  }

  async myVendors(userId: string) {
    return this.db.withContext('marketplace', async (tx) => {
      const members = await tx.vendorMember.findMany({
        where: { userId, removedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (members.length === 0) return [];
      const vendors = await tx.vendor.findMany({
        where: { id: { in: members.map((m) => m.vendorId) } },
        select: { id: true, name: true, status: true },
      });
      const byId = new Map(vendors.map((v) => [v.id, v]));
      return members.flatMap((m) => {
        const vendor = byId.get(m.vendorId);
        return vendor ? [{ ...vendor, role: m.role }] : [];
      });
    });
  }

  async get(access: VendorAccess) {
    return this.db.withContext('marketplace', async (tx) =>
      this.view(tx, await this.load(tx, access.vendorId), access.role),
    );
  }

  async update(access: VendorAccess, input: z.infer<typeof updateVendorSchema>) {
    return this.db.withContext('marketplace', async (tx) => {
      const vendor = await this.load(tx, access.vendorId);
      if (vendor.status === 'rejected')
        throw new ForbiddenError('A rejected application cannot be changed', 'VENDOR_REJECTED');
      const updated = await tx.vendor.update({
        where: { id: vendor.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
          ...(input.logoFileId !== undefined ? { logoFileId: input.logoFileId } : {}),
          version: { increment: 1 },
        },
      });
      if (input.serviceAreas) await this.replaceAreas(tx, vendor.id, input.serviceAreas);
      await this.event(tx, vendor.id, 'marketplace.vendor.updated', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.vendor.update',
        resourceType: 'vendor',
        resourceId: vendor.id,
        after: Object.keys(input),
      });
      return this.view(tx, updated, access.role);
    });
  }

  /** marketplace.md §2.4: bank details go to the provider; we keep the subaccount and last 4 digits. */
  async linkPayout(access: VendorAccess, input: z.infer<typeof vendorPayoutSetupSchema>) {
    const vendor = await this.db.withContext('marketplace', (tx) => this.load(tx, access.vendorId));
    if (vendor.status === 'rejected')
      throw new ForbiddenError('A rejected application cannot be changed', 'VENDOR_REJECTED');
    const linked = await this.payments.linkVendorPayout({
      businessName: vendor.name,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    });
    return this.db.withContext('marketplace', async (tx) => {
      const updated = await tx.vendor.update({
        where: { id: vendor.id },
        data: {
          payoutProvider: linked.provider,
          payoutSubaccountCode: linked.subaccountCode,
          payoutBankName: linked.bankName,
          payoutAccountLast4: linked.accountLast4,
          version: { increment: 1 },
        },
      });
      await this.event(tx, vendor.id, 'marketplace.vendor.payout_linked', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.vendor.payout_link',
        resourceType: 'vendor',
        resourceId: vendor.id,
        before: vendor.payoutAccountLast4
          ? { bankName: vendor.payoutBankName, accountLast4: vendor.payoutAccountLast4 }
          : undefined,
        after: { bankName: linked.bankName, accountLast4: linked.accountLast4 },
      });
      return this.view(tx, updated, access.role);
    });
  }

  // ---- Team ----------------------------------------------------------------------------------

  async members(access: VendorAccess) {
    const rows = await this.db.withContext('marketplace', (tx) =>
      tx.vendorMember.findMany({
        where: { vendorId: access.vendorId, removedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const contacts = await this.identity.contactsOf(rows.map((r) => r.userId));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: contacts.get(row.userId)?.fullName ?? null,
      role: row.role as 'vendor_owner',
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addMember(access: VendorAccess, input: z.infer<typeof addVendorMemberSchema>) {
    const phone = normalizeNigerianPhone(input.phone);
    if (!phone) throw new DomainError('PHONE_INVALID', 'Enter a valid Nigerian phone number', 422);
    const userId = await this.identity.findOrCreateByPhone(phone, null, access.userId);
    await this.db.withContext('marketplace', async (tx) => {
      const existing = await tx.vendorMember.findFirst({
        where: { vendorId: access.vendorId, userId, removedAt: null },
      });
      if (existing) throw new ConflictError('MEMBER_EXISTS', 'This person is already on the team');
      const row = await tx.vendorMember.create({
        data: { vendorId: access.vendorId, userId, role: input.role, addedBy: access.userId },
      });
      await this.event(tx, access.vendorId, 'marketplace.vendor_member.added', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.vendor_member.add',
        resourceType: 'vendor_member',
        resourceId: row.id,
        after: { role: input.role },
      });
    });
    return this.members(access);
  }

  async updateMember(access: VendorAccess, memberId: string, role: string) {
    await this.db.withContext('marketplace', async (tx) => {
      const row = await this.loadMember(tx, access.vendorId, memberId);
      if (row.role === 'vendor_owner')
        throw new ForbiddenError('The owner’s role cannot be changed', 'OWNER_ROLE_FIXED');
      await tx.vendorMember.update({ where: { id: row.id }, data: { role } });
      await this.event(tx, access.vendorId, 'marketplace.vendor_member.updated', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.vendor_member.update',
        resourceType: 'vendor_member',
        resourceId: row.id,
        before: { role: row.role },
        after: { role },
      });
    });
    return this.members(access);
  }

  async removeMember(access: VendorAccess, memberId: string) {
    await this.db.withContext('marketplace', async (tx) => {
      const row = await this.loadMember(tx, access.vendorId, memberId);
      if (row.role === 'vendor_owner')
        throw new ForbiddenError('The owner cannot be removed', 'OWNER_ROLE_FIXED');
      await tx.vendorMember.update({
        where: { id: row.id },
        data: { removedAt: new Date(), removedBy: access.userId },
      });
      await this.event(tx, access.vendorId, 'marketplace.vendor_member.removed', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.vendor_member.remove',
        resourceType: 'vendor_member',
        resourceId: row.id,
        before: { role: row.role },
      });
    });
    return this.members(access);
  }

  /** Active members who handle orders (for notifications and assignment checks). */
  async orderHandlers(vendorId: string): Promise<{ id: string; userId: string; role: string }[]> {
    return this.db.withContext('marketplace', (tx) =>
      tx.vendorMember.findMany({
        where: { vendorId, removedAt: null },
        select: { id: true, userId: true, role: true },
      }),
    );
  }

  // ---- Listings ------------------------------------------------------------------------------

  async listings(access: VendorAccess, query: z.infer<typeof vendorListingQuerySchema>) {
    return this.db.withContext('marketplace', async (tx) => {
      const rows = await tx.listing.findMany({
        where: {
          vendorId: access.vendorId,
          ...(query.status ? { status: query.status } : { status: { not: 'archived' } }),
          ...after(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const result = page(rows, query.limit);
      return { items: result.items.map(listingView), nextCursor: result.nextCursor };
    });
  }

  async createListing(access: VendorAccess, input: z.infer<typeof createListingSchema>) {
    return this.db.withContext('marketplace', async (tx) => {
      const vendor = await this.load(tx, access.vendorId);
      const category = await this.loadCategory(tx, input.categoryId);
      if (input.status === 'active') this.assertCanPublish(vendor);
      const row = await tx.listing.create({
        data: {
          vendorId: vendor.id,
          categoryId: category.id,
          kind: category.kind,
          title: input.title,
          description: input.description,
          photoFileIds: input.photoFileIds,
          priceType: input.priceType,
          price: input.priceType === 'quote' ? null : BigInt(input.priceKobo ?? 0),
          durationMinutes: input.durationMinutes ?? null,
          status: input.status,
          createdBy: access.userId,
        },
      });
      await this.event(tx, vendor.id, 'marketplace.listing.created', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.listing.create',
        resourceType: 'listing',
        resourceId: row.id,
        after: { title: row.title, status: row.status },
      });
      return listingView(row);
    });
  }

  async updateListing(
    access: VendorAccess,
    listingId: string,
    input: z.infer<typeof updateListingSchema>,
  ) {
    return this.db.withContext('marketplace', async (tx) => {
      const vendor = await this.load(tx, access.vendorId);
      const row = await tx.listing.findFirst({ where: { id: listingId, vendorId: vendor.id } });
      if (!row) throw new NotFoundError('Listing not found', 'LISTING_NOT_FOUND');
      if (input.status === 'active') this.assertCanPublish(vendor);
      const category = input.categoryId ? await this.loadCategory(tx, input.categoryId) : undefined;
      const priceType = input.priceType ?? row.priceType;
      const price =
        priceType === 'quote'
          ? null
          : input.priceKobo !== undefined
            ? input.priceKobo === null
              ? null
              : BigInt(input.priceKobo)
            : row.price;
      if (priceType !== 'quote' && price === null)
        throw new DomainError('PRICE_REQUIRED', 'Set a price, or choose "on quote"', 422);
      const updated = await tx.listing.update({
        where: { id: row.id },
        data: {
          ...(category ? { categoryId: category.id, kind: category.kind } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.photoFileIds !== undefined ? { photoFileIds: input.photoFileIds } : {}),
          ...(input.durationMinutes !== undefined
            ? { durationMinutes: input.durationMinutes }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          priceType,
          price,
          version: { increment: 1 },
        },
      });
      await this.event(tx, vendor.id, 'marketplace.listing.updated', {
        actorType: 'user',
        actorId: access.userId,
        action: 'marketplace.listing.update',
        resourceType: 'listing',
        resourceId: row.id,
        after: Object.keys(input),
      });
      return listingView(updated);
    });
  }

  // ---- Techguard review (vendor.approve) -----------------------------------------------------

  async platformList(query: z.infer<typeof platformVendorListQuerySchema>) {
    return this.db.withContext('marketplace', async (tx) => {
      const rows = await tx.vendor.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...after(query.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const result = page(rows, query.limit);
      const items = [];
      for (const row of result.items) items.push(await this.view(tx, row, null));
      return { items, nextCursor: result.nextCursor };
    });
  }

  async platformGet(vendorId: string) {
    return this.db.withContext('marketplace', async (tx) =>
      this.view(tx, await this.load(tx, vendorId), null),
    );
  }

  async decide(
    staffUserId: string,
    vendorId: string,
    decision: 'approve' | 'reject' | 'suspend' | 'reinstate',
    reason: string | undefined,
  ) {
    const FROM: Record<typeof decision, string[]> = {
      approve: ['applied', 'under_review'],
      reject: ['applied', 'under_review'],
      suspend: ['approved'],
      reinstate: ['suspended'],
    };
    const TO = {
      approve: 'approved',
      reject: 'rejected',
      suspend: 'suspended',
      reinstate: 'approved',
    } as const;
    return this.db.withContext(
      'marketplace',
      async (tx) => {
        const vendor = await this.load(tx, vendorId);
        if (!FROM[decision].includes(vendor.status))
          throw new ConflictError(
            'VENDOR_STATUS_CONFLICT',
            `This vendor is ${vendor.status.replace('_', ' ')}, so it cannot be ${TO[decision] === 'approved' && decision === 'reinstate' ? 'reinstated' : TO[decision]}`,
          );
        const now = new Date();
        const updated = await tx.vendor.update({
          where: { id: vendor.id },
          data: {
            status: TO[decision],
            ...(decision === 'approve'
              ? { verifiedAt: now, verifiedBy: staffUserId, rejectionReason: null }
              : {}),
            ...(decision === 'reject' ? { rejectionReason: reason ?? null } : {}),
            ...(decision === 'suspend' ? { suspendedReason: reason ?? null } : {}),
            ...(decision === 'reinstate' ? { suspendedReason: null } : {}),
            version: { increment: 1 },
          },
        });
        const type = {
          approve: 'marketplace.vendor.approved',
          reject: 'marketplace.vendor.rejected',
          suspend: 'marketplace.vendor.suspended',
          reinstate: 'marketplace.vendor.reinstated',
        }[decision];
        await this.event(tx, vendor.id, type, {
          actorType: 'platform_staff',
          actorId: staffUserId,
          action: `marketplace.vendor.${decision}`,
          resourceType: 'vendor',
          resourceId: vendor.id,
          before: { status: vendor.status },
          after: { status: updated.status },
          reason: reason ?? null,
        });
        await this.notifications.request(tx, {
          intent: 'marketplace.vendor_decided',
          userIds: [vendor.ownerUserId],
          estateId: null,
          data: { vendor: vendor.name, outcome: updated.status, vendorId: vendor.id },
          dedupeKey: `vendor:${vendor.id}:${updated.status}:${updated.version}`,
        });
        return this.view(tx, updated, null);
      },
      { userId: staffUserId },
    );
  }

  async commissionRules() {
    return this.db.withContext('marketplace', async (tx) =>
      (await tx.commissionRule.findMany({ orderBy: { validFrom: 'desc' }, take: 500 })).map(
        commissionView,
      ),
    );
  }

  async allCommissionRules() {
    return this.db.withContext('marketplace', (tx) => tx.commissionRule.findMany());
  }

  /** Append-only: a new rule takes effect now and supersedes the previous one for its scope. */
  async setCommissionRule(staffUserId: string, input: z.infer<typeof setCommissionRuleSchema>) {
    return this.db.withContext(
      'marketplace',
      async (tx) => {
        if (input.scope === 'category' && input.scopeId) await this.loadCategory(tx, input.scopeId);
        if (input.scope === 'vendor' && input.scopeId) await this.load(tx, input.scopeId);
        const row = await tx.commissionRule.create({
          data: {
            scope: input.scope,
            scopeId: input.scopeId ?? null,
            bps: input.bps,
            createdBy: staffUserId,
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'marketplace.commission_rule.created',
            estateId: null,
            aggregateType: 'commission_rule',
            aggregateId: row.id,
            payload: { scope: row.scope, scopeId: row.scopeId, bps: row.bps },
            audit: {
              actorType: 'platform_staff',
              actorId: staffUserId,
              action: 'marketplace.commission_rule.create',
              resourceType: 'commission_rule',
              resourceId: row.id,
              after: { scope: row.scope, scopeId: row.scopeId, bps: row.bps },
            },
          },
        ]);
        return commissionView(row);
      },
      { userId: staffUserId },
    );
  }

  // ---- Reads used by orders ------------------------------------------------------------------

  async loadPublic(tx: Tx, vendorIds: readonly string[]) {
    if (vendorIds.length === 0) return new Map<string, ReturnType<typeof publicView>>();
    const rows = await tx.vendor.findMany({ where: { id: { in: [...vendorIds] } } });
    return new Map(rows.map((row) => [row.id, publicView(row)]));
  }

  // ---- Helpers -------------------------------------------------------------------------------

  async load(tx: Tx, vendorId: string): Promise<VendorRow> {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('Vendor not found', 'VENDOR_NOT_FOUND');
    return vendor;
  }

  private async loadMember(tx: Tx, vendorId: string, memberId: string) {
    const row = await tx.vendorMember.findFirst({
      where: { id: memberId, vendorId, removedAt: null },
    });
    if (!row) throw new NotFoundError('Team member not found', 'MEMBER_NOT_FOUND');
    return row;
  }

  private async loadCategory(tx: Tx, categoryId: string) {
    const category = await tx.serviceCategory.findFirst({
      where: { id: categoryId, status: 'active' },
    });
    if (!category) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
    return category;
  }

  private async assertCategories(tx: Tx, ids: readonly string[]) {
    const found = await tx.serviceCategory.count({
      where: { id: { in: [...ids] }, status: 'active' },
    });
    if (found !== new Set(ids).size)
      throw new DomainError('CATEGORY_NOT_FOUND', 'Choose categories from the list', 422);
  }

  private assertCanPublish(vendor: VendorRow) {
    if (vendor.status !== 'approved')
      throw new ForbiddenError(
        'Listings go live once Techguard approves your vendor account',
        'VENDOR_NOT_APPROVED',
      );
  }

  private async replaceAreas(
    tx: Tx,
    vendorId: string,
    areas: readonly { state?: string; lga?: string; estateId?: string }[],
  ) {
    await tx.vendorServiceArea.deleteMany({ where: { vendorId } });
    await tx.vendorServiceArea.createMany({
      data: areas.map((area) => ({
        vendorId,
        state: area.state ?? null,
        lga: area.lga ?? null,
        estateId: area.estateId ?? null,
      })),
    });
  }

  async areasOf(tx: Tx, vendorIds: readonly string[]): Promise<Map<string, AreaRow[]>> {
    const rows = await tx.vendorServiceArea.findMany({
      where: { vendorId: { in: [...vendorIds] } },
    });
    const map = new Map<string, AreaRow[]>();
    for (const row of rows) map.set(row.vendorId, [...(map.get(row.vendorId) ?? []), row]);
    return map;
  }

  private async view(tx: Tx, vendor: VendorRow, myRole: string | null) {
    const areas = (await this.areasOf(tx, [vendor.id])).get(vendor.id) ?? [];
    return {
      ...publicView(vendor),
      status: vendor.status as 'approved',
      verificationTier: vendor.verificationTier as 'individual' | 'business',
      cacNumber: vendor.cacNumber,
      contactEmail: vendor.contactEmail,
      serviceAreas: areas.map((a) => ({ state: a.state, lga: a.lga, estateId: a.estateId })),
      categoryIds: vendor.categoryIds,
      payout: {
        ready: vendor.payoutSubaccountCode !== null,
        bankName: vendor.payoutBankName,
        accountLast4: vendor.payoutAccountLast4,
      },
      rejectionReason: vendor.rejectionReason,
      suspendedReason: vendor.suspendedReason,
      myRole: myRole as 'vendor_owner' | null,
      createdAt: vendor.createdAt.toISOString(),
    };
  }

  private async event(tx: Tx, vendorId: string, type: string, audit: AuditInput) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: null,
        aggregateType: 'vendor',
        aggregateId: vendorId,
        payload: { vendorId },
        audit,
      },
    ]);
  }
}

export function publicView(vendor: VendorRow) {
  return {
    id: vendor.id,
    name: vendor.name,
    type: vendor.type as 'individual' | 'company',
    description: vendor.description,
    logoFileId: vendor.logoFileId,
    ratingAvg: ratingAverage(vendor.ratingSum, vendor.ratingCount),
    ratingCount: vendor.ratingCount,
    verified: vendor.verifiedAt !== null && vendor.status === 'approved',
  };
}

export function listingView(row: ListingRow) {
  return {
    id: row.id,
    vendorId: row.vendorId,
    categoryId: row.categoryId,
    kind: row.kind as 'service' | 'goods',
    title: row.title,
    description: row.description,
    photoFileIds: row.photoFileIds,
    priceType: row.priceType as 'fixed' | 'from' | 'quote',
    priceKobo: row.price === null ? null : Number(row.price),
    durationMinutes: row.durationMinutes,
    status: row.status as 'active',
    updatedAt: row.updatedAt.toISOString(),
  };
}

function commissionView(row: Prisma.CommissionRuleGetPayload<object>) {
  return {
    id: row.id,
    scope: row.scope as 'default' | 'category' | 'vendor',
    scopeId: row.scopeId,
    bps: row.bps,
    validFrom: row.validFrom.toISOString(),
  };
}
