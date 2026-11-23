import { Injectable, Logger } from '@nestjs/common';
import type {
  disputeListQuerySchema,
  marketplaceBrowseQuerySchema,
  openDisputeSchema,
  OrderStatus,
  orderListQuerySchema,
  placeOrderSchema,
  resolveDisputeSchema,
  reviewOrderSchema,
  setVendorApprovalSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess, VendorAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { NotificationsService } from '../notifications/notifications.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { PaymentsService } from '../payments/payments.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  canAcceptWithoutQuote,
  checkTransition,
  commissionBpsAt,
  type CommissionRuleRow,
  type OrderAction,
  type OrderActor,
  refundableKobo,
  servesEstate,
  splitAmount,
  type TransitionRefusal,
  vendorVisibleToEstate,
} from './domain/marketplace';
import { listingView, publicView, VendorsService } from './vendors.service';

type OrderRow = Prisma.MarketplaceOrderGetPayload<object>;

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
function nextCursor<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const last = rows.slice(0, limit).at(-1);
  return rows.length > limit && last
    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null;
}

const REFUSALS: Record<TransitionRefusal, (action: OrderAction) => DomainError> = {
  wrong_status: () =>
    new ConflictError('ORDER_STATUS_CONFLICT', 'The order cannot do that in its current status'),
  wrong_actor: () => new ForbiddenError(),
  not_paid: () =>
    new ConflictError('ORDER_NOT_PAID', 'This needs the payment to be confirmed first'),
};

const EVENT_VERBS: Record<OrderAction, string> = {
  quote: 'quoted',
  accept: 'accepted',
  accept_quote: 'accepted',
  decline: 'declined',
  schedule: 'scheduled',
  start: 'started',
  complete: 'completed',
  review: 'reviewed',
  cancel_by_resident: 'cancelled',
  cancel_by_vendor: 'cancelled',
  dispute: 'disputed',
  resolve_refund: 'refunded',
  resolve_no_action: 'resolved',
};

/** Vendor actions that a suspended vendor can no longer take (marketplace.md rule 8). */
const NEW_WORK: readonly OrderAction[] = ['quote', 'accept', 'schedule'];
/** Order handlers notified about every order; service personnel only about orders assigned to them. */
const HANDLER_ROLES = ['vendor_owner', 'vendor_administrator', 'vendor_employee'];

/**
 * Marketplace orders (marketplace.md §3 to §6, ADR-0023). Residents act in their estate (tenant RLS);
 * vendors act through the marketplace context with app.vendor_id, plus the order's estate for its events.
 * Payment is a split charge: vendor subaccount gets the vendor share, Safezone the commission.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('MarketplaceOrders');

  constructor(
    private readonly db: DatabaseService,
    private readonly vendors: VendorsService,
    private readonly payments: PaymentsService,
    private readonly tenancy: TenancyService,
    private readonly occupancy: OccupancyService,
    private readonly notifications: NotificationsService,
  ) {}

  private asResident<T>(access: EstateAccess, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withContext('marketplace', fn, {
      estateId: access.estateId,
      userId: access.userId,
    });
  }

  // ---- Visibility ----------------------------------------------------------------------------

  /** Vendors the estate's residents may see and order from (marketplace.md rules 1 and 2). */
  async visibleVendorIds(access: EstateAccess): Promise<Set<string>> {
    const [profile, settings] = await Promise.all([
      this.tenancy.getProfile(access),
      this.tenancy.getSettings(access),
    ]);
    const allowAll = settings['marketplace.allow_all_verified_vendors'];
    return this.asResident(access, async (tx) => {
      const approvals = await tx.estateVendorApproval.findMany({
        where: { estateId: access.estateId },
      });
      const decided = new Map(approvals.map((a) => [a.vendorId, a.status as 'approved']));
      const candidateIds = new Set(
        approvals.filter((a) => a.status === 'approved').map((a) => a.vendorId),
      );
      if (allowAll) {
        const areas = await tx.vendorServiceArea.findMany({
          where: {
            OR: [
              { estateId: access.estateId },
              ...(profile.state
                ? [{ state: { equals: profile.state, mode: 'insensitive' as const } }]
                : []),
            ],
          },
          select: { vendorId: true },
        });
        for (const area of areas) candidateIds.add(area.vendorId);
      }
      if (candidateIds.size === 0) return new Set<string>();
      const vendors = await tx.vendor.findMany({
        where: { id: { in: [...candidateIds] }, status: 'approved' },
        select: { id: true, status: true, payoutSubaccountCode: true },
      });
      const areas = await this.vendors.areasOf(
        tx,
        vendors.map((v) => v.id),
      );
      const estate = { id: access.estateId, state: profile.state, lga: profile.lga };
      return new Set(
        vendors
          .filter((v) =>
            vendorVisibleToEstate({
              vendorStatus: v.status,
              payoutReady: v.payoutSubaccountCode !== null,
              approval: decided.get(v.id) ?? null,
              allowAllVerified: allowAll,
              servesEstate: servesEstate(areas.get(v.id) ?? [], estate),
            }),
          )
          .map((v) => v.id),
      );
    });
  }

  async browse(access: EstateAccess, query: z.infer<typeof marketplaceBrowseQuerySchema>) {
    const visible = await this.visibleVendorIds(access);
    const vendorIds = query.vendorId
      ? visible.has(query.vendorId)
        ? [query.vendorId]
        : []
      : [...visible];
    if (vendorIds.length === 0) return { items: [], nextCursor: null };
    return this.asResident(access, async (tx) => {
      const rows = await tx.listing.findMany({
        where: {
          vendorId: { in: vendorIds },
          status: 'active',
          ...(query.category ? { categoryId: query.category } : {}),
          ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
          ...after(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const pageRows = rows.slice(0, query.limit);
      const vendors = await this.vendors.loadPublic(
        tx,
        pageRows.map((r) => r.vendorId),
      );
      return {
        items: pageRows.flatMap((row) => {
          const vendor = vendors.get(row.vendorId);
          if (!vendor) return [];
          const { status: _status, ...listing } = listingView(row);
          return [{ ...listing, vendor }];
        }),
        nextCursor: nextCursor(rows, query.limit),
      };
    });
  }

  /** A visible vendor's profile with its live listings and this estate's reviews. */
  async vendorProfile(access: EstateAccess, vendorId: string) {
    if (!(await this.visibleVendorIds(access)).has(vendorId))
      throw new NotFoundError('Vendor not found', 'VENDOR_NOT_FOUND');
    return this.asResident(access, async (tx) => {
      const vendor = await this.vendors.load(tx, vendorId);
      const listings = await tx.listing.findMany({
        where: { vendorId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const reviews = await tx.marketplaceReview.findMany({
        where: { estateId: access.estateId, vendorId, status: 'visible' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return {
        vendor: publicView(vendor),
        listings: listings.map((row) => {
          const { status: _status, ...listing } = listingView(row);
          return { ...listing, vendor: publicView(vendor) };
        }),
        reviews: reviews.map(reviewView),
      };
    });
  }

  // ---- Estate approval (marketplace.moderate) ------------------------------------------------

  /** Approved and blocked vendors, plus verified vendors serving the estate not decided yet. */
  async estateVendors(access: EstateAccess) {
    const profile = await this.tenancy.getProfile(access);
    return this.asResident(access, async (tx) => {
      const approvals = await tx.estateVendorApproval.findMany({
        where: { estateId: access.estateId },
      });
      const areaVendors = await tx.vendorServiceArea.findMany({
        where: {
          OR: [
            { estateId: access.estateId },
            ...(profile.state
              ? [{ state: { equals: profile.state, mode: 'insensitive' as const } }]
              : []),
          ],
        },
        select: { vendorId: true },
      });
      const ids = new Set([
        ...approvals.map((a) => a.vendorId),
        ...areaVendors.map((a) => a.vendorId),
      ]);
      const vendors = await tx.vendor.findMany({
        where: { id: { in: [...ids] }, status: 'approved' },
        orderBy: { name: 'asc' },
      });
      const areas = await this.vendors.areasOf(
        tx,
        vendors.map((v) => v.id),
      );
      const estate = { id: access.estateId, state: profile.state, lga: profile.lga };
      const byVendor = new Map(approvals.map((a) => [a.vendorId, a]));
      return vendors
        .filter((v) => byVendor.has(v.id) || servesEstate(areas.get(v.id) ?? [], estate))
        .map((v) => {
          const approval = byVendor.get(v.id);
          return {
            vendor: publicView(v),
            status: (approval?.status ?? null) as 'approved' | 'blocked' | null,
            decidedAt: approval?.decidedAt.toISOString() ?? null,
          };
        });
    });
  }

  async setApproval(access: EstateAccess, input: z.infer<typeof setVendorApprovalSchema>) {
    await this.asResident(access, async (tx) => {
      await this.vendors.load(tx, input.vendorId);
      const previous = await tx.estateVendorApproval.findUnique({
        where: { estateId_vendorId: { estateId: access.estateId, vendorId: input.vendorId } },
      });
      await tx.estateVendorApproval.upsert({
        where: { estateId_vendorId: { estateId: access.estateId, vendorId: input.vendorId } },
        create: {
          estateId: access.estateId,
          vendorId: input.vendorId,
          status: input.status,
          reason: input.reason ?? null,
          decidedBy: access.userId,
        },
        update: {
          status: input.status,
          reason: input.reason ?? null,
          decidedBy: access.userId,
          decidedAt: new Date(),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: `marketplace.estate_vendor.${input.status}`,
          estateId: access.estateId,
          aggregateType: 'vendor',
          aggregateId: input.vendorId,
          payload: { vendorId: input.vendorId, status: input.status },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: `marketplace.estate_vendor.${input.status === 'approved' ? 'approve' : 'block'}`,
            resourceType: 'vendor',
            resourceId: input.vendorId,
            before: previous ? { status: previous.status } : undefined,
            after: { status: input.status },
            reason: input.reason ?? null,
          },
        },
      ]);
    });
    return this.estateVendors(access);
  }

  // ---- Resident side -------------------------------------------------------------------------

  async place(access: EstateAccess, input: z.infer<typeof placeOrderSchema>) {
    const visible = await this.visibleVendorIds(access);
    if (input.spaceId) {
      const units = (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
        (h) => h.spaceId,
      );
      if (!units.includes(input.spaceId))
        throw new ForbiddenError('Choose a unit in your own household', 'SPACE_NOT_YOURS');
    }
    const { order, vendorName, listingTitle } = await this.asResident(access, async (tx) => {
      const listing = await tx.listing.findFirst({
        where: { id: input.listingId, status: 'active' },
      });
      if (!listing || !visible.has(listing.vendorId))
        throw new NotFoundError('Listing not found', 'LISTING_NOT_FOUND');
      const vendor = await this.vendors.load(tx, listing.vendorId);
      const row = await tx.marketplaceOrder.create({
        data: {
          estateId: access.estateId,
          vendorId: vendor.id,
          listingId: listing.id,
          residentUserId: access.userId,
          spaceId: input.spaceId ?? null,
          details: input.details,
          preferredAt: input.preferredAt ? new Date(input.preferredAt) : null,
          amount: listing.priceType === 'fixed' ? listing.price : null,
          status: 'requested',
        },
      });
      await this.history(tx, row, null, 'requested', 'resident', access.userId, null);
      await appendOutboxEvents(tx, [
        {
          type: 'marketplace.order.placed',
          estateId: access.estateId,
          aggregateType: 'marketplace_order',
          aggregateId: row.id,
          payload: { orderId: row.id, vendorId: vendor.id, listingId: listing.id },
        },
      ]);
      return { order: row, vendorName: vendor.name, listingTitle: listing.title };
    });
    await this.notifyVendor(order, 'marketplace.order_placed', listingTitle, vendorName);
    return this.residentDetail(access, order.id);
  }

  async myOrders(access: EstateAccess, query: z.infer<typeof orderListQuerySchema>) {
    return this.asResident(access, async (tx) => {
      const rows = await tx.marketplaceOrder.findMany({
        where: {
          estateId: access.estateId,
          residentUserId: access.userId,
          ...(query.status ? { status: query.status } : {}),
          ...after(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const pageRows = rows.slice(0, query.limit);
      const names = await this.names(tx, pageRows);
      return {
        items: pageRows.map((row) => this.view(row, names, 'resident')),
        nextCursor: nextCursor(rows, query.limit),
      };
    });
  }

  async residentDetail(access: EstateAccess, orderId: string) {
    return this.asResident(access, async (tx) => {
      const row = await this.loadResidentOrder(tx, access, orderId);
      return this.detailView(tx, row, 'resident');
    });
  }

  async acceptQuote(access: EstateAccess, orderId: string) {
    return this.residentAction(access, orderId, 'accept_quote', (row) => ({
      amount: row.quoteAmount,
    }));
  }

  async cancelByResident(access: EstateAccess, orderId: string, reason: string) {
    return this.residentAction(access, orderId, 'cancel_by_resident', () => ({
      cancelReason: reason,
    }));
  }

  async review(access: EstateAccess, orderId: string, input: z.infer<typeof reviewOrderSchema>) {
    return this.residentAction(
      access,
      orderId,
      'review',
      () => ({}),
      async (tx, row) => {
        await tx.marketplaceReview.create({
          data: {
            estateId: row.estateId,
            vendorId: row.vendorId,
            orderId: row.id,
            authorUserId: access.userId,
            rating: input.rating,
            comment: input.comment ?? null,
          },
        });
        await tx.vendor.update({
          where: { id: row.vendorId },
          data: { ratingSum: { increment: input.rating }, ratingCount: { increment: 1 } },
        });
      },
    );
  }

  async dispute(access: EstateAccess, orderId: string, input: z.infer<typeof openDisputeSchema>) {
    return this.residentAction(
      access,
      orderId,
      'dispute',
      () => ({}),
      async (tx, row) => {
        if (await tx.marketplaceDispute.findUnique({ where: { orderId: row.id } }))
          throw new ConflictError('DISPUTE_EXISTS', 'This order already had a dispute');
        await tx.marketplaceDispute.create({
          data: {
            estateId: row.estateId,
            vendorId: row.vendorId,
            orderId: row.id,
            openedBy: access.userId,
            reason: input.reason,
            evidenceFileIds: input.evidenceFileIds,
          },
        });
      },
    );
  }

  /**
   * Starts (or restarts) checkout for an accepted order. The commission rule in force now is fixed on the
   * order with the split; a fresh reference is issued each time, and an earlier unpaid one is checked first.
   */
  async pay(
    access: EstateAccess,
    orderId: string,
    options: { callbackUrl?: string; paymentMethodId?: string; saveCard?: boolean },
  ) {
    const current = await this.asResident(access, (tx) =>
      this.loadResidentOrder(tx, access, orderId),
    );
    if (current.paymentReference && !current.paidAt) {
      const result = await this.payments.processReference(current.paymentReference);
      if (result.outcome === 'marketplace_paid') {
        await this.handlePaid(result.estateId, result.reference, result.amountKobo);
        throw new ConflictError('ORDER_ALREADY_PAID', 'This order is already paid');
      }
    }
    const rules = await this.vendors.allCommissionRules();
    const prepared = await this.asResident(access, async (tx) => {
      const row = await this.loadResidentOrder(tx, access, orderId);
      if (row.paidAt) throw new ConflictError('ORDER_ALREADY_PAID', 'This order is already paid');
      if (row.status !== 'accepted' || row.amount === null)
        throw new ConflictError('ORDER_NOT_PAYABLE', 'Pay once the vendor accepts the order');
      const vendor = await this.vendors.load(tx, row.vendorId);
      if (vendor.status !== 'approved' || !vendor.payoutSubaccountCode)
        throw new ConflictError('VENDOR_UNAVAILABLE', 'This vendor cannot take payments now');
      const listing = await tx.listing.findUniqueOrThrow({ where: { id: row.listingId } });
      const bps = commissionBpsAt(
        rules.map((r): CommissionRuleRow => ({
          scope: r.scope as CommissionRuleRow['scope'],
          scopeId: r.scopeId,
          bps: r.bps,
          validFrom: r.validFrom,
        })),
        { vendorId: vendor.id, categoryId: listing.categoryId },
        new Date(),
      );
      const amountKobo = Number(row.amount);
      const split = splitAmount(amountKobo, bps);
      const reference = `sz_mkt_${uuidv7()}`;
      const updated = await tx.marketplaceOrder.updateMany({
        where: { id: row.id, version: row.version, paidAt: null },
        data: {
          paymentReference: reference,
          commissionBps: bps,
          commissionAmount: BigInt(split.commissionKobo),
          vendorAmount: BigInt(split.vendorKobo),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictError('ORDER_CHANGED', 'The order changed. Refresh and try again.');
      return {
        reference,
        amountKobo,
        commissionKobo: split.commissionKobo,
        subaccount: vendor.payoutSubaccountCode,
      };
    });
    const checkout = await this.payments.startMarketplaceCharge({
      estateId: access.estateId,
      payerUserId: access.userId,
      reference: prepared.reference,
      amountKobo: prepared.amountKobo,
      commissionKobo: prepared.commissionKobo,
      vendorSubaccountCode: prepared.subaccount,
      ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
      metadata: { purpose: 'marketplace_order', orderId },
      ...(options.saveCard ? { saveCard: true } : {}),
      ...(options.paymentMethodId ? { paymentMethodId: options.paymentMethodId } : {}),
    });
    // Saved card (ADR-0025): verify now, exactly as after checkout.
    if (!checkout.authorizationUrl) await this.verifyPayment(access, orderId);
    return {
      orderId,
      amountKobo: prepared.amountKobo,
      authorizationUrl: checkout.authorizationUrl,
    };
  }

  /** The payer's return from checkout: ask the provider now instead of waiting for the webhook. */
  async verifyPayment(access: EstateAccess, orderId: string) {
    const row = await this.asResident(access, (tx) => this.loadResidentOrder(tx, access, orderId));
    if (row.paymentReference && !row.paidAt) {
      const result = await this.payments.processReference(row.paymentReference);
      if (result.outcome === 'marketplace_paid')
        await this.handlePaid(result.estateId, result.reference, result.amountKobo);
    }
    return this.residentDetail(access, orderId);
  }

  // ---- Vendor side ---------------------------------------------------------------------------

  private asVendor<T>(
    access: VendorAccess,
    estateId: string | null,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.withContext('marketplace', fn, {
      vendorId: access.vendorId,
      userId: access.userId,
      ...(estateId ? { estateId } : {}),
    });
  }

  /** Service personnel see only orders assigned to them; other roles see all of the vendor's orders. */
  private personnelOnly(access: VendorAccess): boolean {
    return !access.permissions.has('vendor.order.manage');
  }

  async vendorOrders(access: VendorAccess, query: z.infer<typeof orderListQuerySchema>) {
    return this.asVendor(access, null, async (tx) => {
      const rows = await tx.marketplaceOrder.findMany({
        where: {
          vendorId: access.vendorId,
          ...(this.personnelOnly(access) ? { assignedMemberId: access.memberId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...after(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const pageRows = rows.slice(0, query.limit);
      const names = await this.names(tx, pageRows);
      return {
        items: pageRows.map((row) => this.view(row, names, 'vendor')),
        nextCursor: nextCursor(rows, query.limit),
      };
    });
  }

  async vendorDetail(access: VendorAccess, orderId: string) {
    return this.asVendor(access, null, async (tx) =>
      this.detailView(tx, await this.loadVendorOrder(tx, access, orderId), 'vendor'),
    );
  }

  async vendorAction(
    access: VendorAccess,
    orderId: string,
    action: OrderAction,
    input: { amountKobo?: number; scheduledAt?: string; reason?: string; note?: string } = {},
  ) {
    const located = await this.asVendor(access, null, (tx) =>
      this.loadVendorOrder(tx, access, orderId),
    );
    if (this.personnelOnly(access) && !['start', 'complete'].includes(action))
      throw new ForbiddenError();
    if (access.vendorStatus !== 'approved' && NEW_WORK.includes(action))
      throw new ForbiddenError('Your vendor account is not active', 'VENDOR_NOT_APPROVED');
    const { row, refundTarget } = await this.asVendor(access, located.estateId, async (tx) => {
      const order = await this.loadVendorOrder(tx, access, orderId);
      if (action === 'accept') {
        const listing = await tx.listing.findUniqueOrThrow({ where: { id: order.listingId } });
        if (!canAcceptWithoutQuote(listing.priceType as 'fixed') || order.amount === null)
          throw new ConflictError('QUOTE_REQUIRED', 'Send a quote for this order first');
      }
      if (action === 'schedule' && input.scheduledAt && new Date(input.scheduledAt) <= new Date())
        throw new DomainError('SCHEDULE_IN_PAST', 'Choose a time in the future', 422);
      const patch: Prisma.MarketplaceOrderUpdateManyMutationInput = {
        ...(action === 'quote' ? { quoteAmount: BigInt(input.amountKobo ?? 0) } : {}),
        ...(action === 'schedule' && input.scheduledAt
          ? { scheduledAt: new Date(input.scheduledAt) }
          : {}),
        ...(action === 'decline' || action === 'cancel_by_vendor'
          ? { cancelReason: input.reason ?? null }
          : {}),
      };
      const updated = await this.transition(
        tx,
        order,
        action,
        'vendor',
        access.userId,
        patch,
        input.note ?? input.reason ?? null,
      );
      return {
        row: updated,
        refundTarget: action === 'cancel_by_vendor' && updated.paidAt ? Number(updated.amount) : 0,
      };
    });
    if (refundTarget > 0) await this.requestRefund(row, refundTarget, 'cancelled_by_vendor');
    await this.notifyResident(row);
    return this.vendorDetail(access, orderId);
  }

  async assign(access: VendorAccess, orderId: string, memberId: string) {
    const handlers = await this.vendors.orderHandlers(access.vendorId);
    if (!handlers.some((h) => h.id === memberId))
      throw new NotFoundError('Team member not found', 'MEMBER_NOT_FOUND');
    const located = await this.asVendor(access, null, (tx) =>
      this.loadVendorOrder(tx, access, orderId),
    );
    await this.asVendor(access, located.estateId, async (tx) => {
      const row = await this.loadVendorOrder(tx, access, orderId);
      await tx.marketplaceOrder.update({
        where: { id: row.id },
        data: { assignedMemberId: memberId, version: { increment: 1 } },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'marketplace.order.assigned',
          estateId: row.estateId,
          aggregateType: 'marketplace_order',
          aggregateId: row.id,
          payload: { orderId: row.id, memberId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'marketplace.order.assign',
            resourceType: 'marketplace_order',
            resourceId: row.id,
            after: { memberId },
          },
        },
      ]);
    });
    return this.vendorDetail(access, orderId);
  }

  async respondToReview(access: VendorAccess, orderId: string, response: string) {
    const located = await this.asVendor(access, null, (tx) =>
      this.loadVendorOrder(tx, access, orderId),
    );
    await this.asVendor(access, located.estateId, async (tx) => {
      const review = await tx.marketplaceReview.findFirst({
        where: { orderId, vendorId: access.vendorId },
      });
      if (!review) throw new NotFoundError('Review not found', 'REVIEW_NOT_FOUND');
      if (review.vendorResponse !== null)
        throw new ConflictError('ALREADY_RESPONDED', 'You have already responded to this review');
      await tx.marketplaceReview.update({
        where: { id: review.id },
        data: { vendorResponse: response, respondedAt: new Date() },
      });
    });
    return this.vendorDetail(access, orderId);
  }

  async earnings(access: VendorAccess) {
    return this.asVendor(access, null, async (tx) => {
      const sums = await tx.marketplaceOrder.aggregate({
        where: { vendorId: access.vendorId, paidAt: { not: null } },
        _count: { _all: true },
        _sum: { amount: true, commissionAmount: true, vendorAmount: true, refundedAmount: true },
      });
      return {
        paidOrders: sums._count._all,
        grossKobo: Number(sums._sum.amount ?? 0n),
        commissionKobo: Number(sums._sum.commissionAmount ?? 0n),
        vendorKobo: Number(sums._sum.vendorAmount ?? 0n),
        refundedKobo: Number(sums._sum.refundedAmount ?? 0n),
      };
    });
  }

  async vendorReviews(access: VendorAccess) {
    return this.asVendor(access, null, async (tx) =>
      (
        await tx.marketplaceReview.findMany({
          where: { vendorId: access.vendorId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      ).map(reviewView),
    );
  }

  /** Estates that have explicitly approved this vendor (public-web.md §8: Vendor Portal /vendor/estates). */
  async vendorApprovedEstates(access: VendorAccess) {
    const rows = await this.asVendor(access, null, (tx) =>
      tx.estateVendorApproval.findMany({
        where: { vendorId: access.vendorId, status: 'approved' },
        orderBy: { decidedAt: 'desc' },
        take: 200,
      }),
    );
    const summaries = await this.tenancy.estateSummariesByIds(rows.map((r) => r.estateId));
    return rows.map((row) => {
      const summary = summaries.get(row.estateId);
      return {
        estateId: row.estateId,
        estateName: summary?.name ?? 'Estate',
        state: summary?.state ?? null,
        lga: summary?.lga ?? null,
        decidedAt: row.decidedAt.toISOString(),
      };
    });
  }

  /** Open disputes and outcomes for this vendor (public-web.md §8: Vendor Portal /vendor/disputes). */
  async vendorDisputes(access: VendorAccess, query: z.infer<typeof disputeListQuerySchema>) {
    const {
      page,
      nextCursor: cursor,
      orders,
      listings,
    } = await this.asVendor(access, null, async (tx) => {
      const rows = await tx.marketplaceDispute.findMany({
        where: {
          vendorId: access.vendorId,
          ...(query.status ? { status: query.status } : {}),
          ...after(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const items = rows.slice(0, query.limit);
      const orderIds = [...new Set(items.map((r) => r.orderId))];
      const orderRows =
        orderIds.length === 0
          ? []
          : await tx.marketplaceOrder.findMany({
              where: { id: { in: orderIds }, vendorId: access.vendorId },
              select: { id: true, listingId: true, amount: true },
            });
      const listingIds = [...new Set(orderRows.map((o) => o.listingId))];
      const listingRows =
        listingIds.length === 0
          ? []
          : await tx.listing.findMany({
              where: { id: { in: listingIds } },
              select: { id: true, title: true },
            });
      return {
        page: items,
        nextCursor: nextCursor(rows, query.limit),
        orders: new Map(orderRows.map((o) => [o.id, o])),
        listings: new Map(listingRows.map((l) => [l.id, l.title])),
      };
    });
    const estateNames = await this.tenancy.estateNamesByIds(page.map((r) => r.estateId));
    return {
      items: page.map((row) => {
        const order = orders.get(row.orderId);
        return {
          ...disputeView(row),
          estateName: estateNames.get(row.estateId) ?? 'Estate',
          listingTitle: (order ? listings.get(order.listingId) : undefined) ?? 'Order',
          orderAmountKobo:
            order?.amount === undefined || order.amount === null ? null : Number(order.amount),
        };
      }),
      nextCursor: cursor,
    };
  }

  // ---- Messages ------------------------------------------------------------------------------

  async residentMessages(access: EstateAccess, orderId: string) {
    return this.asResident(access, async (tx) => {
      await this.loadResidentOrder(tx, access, orderId);
      return this.messages(tx, orderId);
    });
  }

  async postResidentMessage(access: EstateAccess, orderId: string, body: string) {
    const { row, listingTitle, vendorName } = await this.asResident(access, async (tx) => {
      const order = await this.loadResidentOrder(tx, access, orderId);
      await tx.marketplaceOrderMessage.create({
        data: {
          estateId: order.estateId,
          vendorId: order.vendorId,
          orderId,
          authorKind: 'resident',
          authorId: access.userId,
          body,
        },
      });
      const names = await this.names(tx, [order]);
      return {
        row: order,
        listingTitle: names.listings.get(order.listingId) ?? '',
        vendorName: names.vendors.get(order.vendorId) ?? '',
      };
    });
    await this.notifyVendor(row, 'marketplace.order_message', listingTitle, vendorName);
    return this.residentMessages(access, orderId);
  }

  async vendorMessages(access: VendorAccess, orderId: string) {
    return this.asVendor(access, null, async (tx) => {
      await this.loadVendorOrder(tx, access, orderId);
      return this.messages(tx, orderId);
    });
  }

  async postVendorMessage(access: VendorAccess, orderId: string, body: string) {
    const located = await this.asVendor(access, null, (tx) =>
      this.loadVendorOrder(tx, access, orderId),
    );
    await this.asVendor(access, located.estateId, async (tx) => {
      await tx.marketplaceOrderMessage.create({
        data: {
          estateId: located.estateId,
          vendorId: access.vendorId,
          orderId,
          authorKind: 'vendor',
          authorId: access.userId,
          body,
        },
      });
      const names = await this.names(tx, [located]);
      await this.notifications.request(tx, {
        intent: 'marketplace.order_message',
        userIds: [located.residentUserId],
        estateId: located.estateId,
        data: { listing: names.listings.get(located.listingId) ?? '', orderId },
        dedupeKey: `order-message:${orderId}:${Date.now()}`,
      });
    });
    return this.vendorMessages(access, orderId);
  }

  // ---- Payments, refunds and disputes (system and Techguard) ----------------------------------

  /**
   * A verified marketplace charge. Unknown references and amount mismatches are refunded in full; a
   * payment that lands after the order was cancelled is recorded and refunded.
   */
  async handlePaid(estateId: string, reference: string, amountKobo: number): Promise<void> {
    const outcome = await this.db.withContext(
      'marketplace',
      async (tx) => {
        const row = await tx.marketplaceOrder.findFirst({
          where: { estateId, paymentReference: reference },
        });
        if (!row) return { kind: 'orphan' as const };
        if (row.paidAt) return { kind: 'duplicate' as const };
        if (row.amount === null || Number(row.amount) !== amountKobo)
          return { kind: 'mismatch' as const };
        const updated = await tx.marketplaceOrder.update({
          where: { id: row.id },
          data: { paidAt: new Date(), version: { increment: 1 } },
        });
        await this.history(
          tx,
          updated,
          row.status as OrderStatus,
          row.status as OrderStatus,
          'system',
          null,
          'Payment confirmed',
        );
        await appendOutboxEvents(tx, [
          {
            type: 'marketplace.order.paid',
            estateId,
            aggregateType: 'marketplace_order',
            aggregateId: row.id,
            payload: { orderId: row.id, amountKobo },
          },
        ]);
        const cancelled =
          row.status === 'cancelled_by_resident' || row.status === 'cancelled_by_vendor';
        return { kind: cancelled ? ('late' as const) : ('paid' as const), row: updated };
      },
      { estateId },
    );
    if (outcome.kind === 'orphan' || outcome.kind === 'mismatch') {
      this.logger.error({ msg: 'marketplace charge refunded', reason: outcome.kind, estateId });
      await this.payments.refundMarketplaceCharge(reference, amountKobo);
      return;
    }
    if (outcome.kind === 'late') {
      await this.requestRefund(outcome.row, Number(outcome.row.amount), 'paid_after_cancellation');
      return;
    }
    if (outcome.kind === 'paid') {
      const names = await this.db.withContext('marketplace', (tx) => this.names(tx, [outcome.row]));
      await this.notifyVendor(
        outcome.row,
        'marketplace.order_updated',
        names.listings.get(outcome.row.listingId) ?? '',
        names.vendors.get(outcome.row.vendorId) ?? '',
      );
    }
  }

  /** Worker: refunds up to `targetKobo` in total for the order (idempotent: only the remainder is sent). */
  async processRefund(estateId: string, orderId: string, targetKobo: number): Promise<void> {
    const row = await this.db.withContext(
      'marketplace',
      (tx) => tx.marketplaceOrder.findFirst({ where: { id: orderId, estateId } }),
      { estateId },
    );
    if (!row || !row.paidAt || !row.paymentReference || row.amount === null) return;
    const due = Math.min(
      refundableKobo(Number(row.amount), Number(row.refundedAmount)),
      Math.max(0, targetKobo - Number(row.refundedAmount)),
    );
    if (due <= 0) return;
    await this.payments.refundMarketplaceCharge(row.paymentReference, due);
    await this.db.withContext(
      'marketplace',
      async (tx) => {
        await tx.marketplaceOrder.updateMany({
          where: { id: row.id, refundedAmount: row.refundedAmount },
          data: { refundedAmount: { increment: BigInt(due) }, version: { increment: 1 } },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'marketplace.order.refund_sent',
            estateId,
            aggregateType: 'marketplace_order',
            aggregateId: row.id,
            payload: { orderId: row.id, amountKobo: due },
            audit: {
              actorType: 'system',
              action: 'marketplace.order.refund',
              resourceType: 'marketplace_order',
              resourceId: row.id,
              after: { amountKobo: due },
            },
          },
        ]);
      },
      { estateId },
    );
  }

  async platformDisputes(query: z.infer<typeof disputeListQuerySchema>) {
    return this.db.withContext('marketplace_admin', async (tx) => {
      const rows = await tx.marketplaceDispute.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...after(query.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      return {
        items: rows.slice(0, query.limit).map(disputeView),
        nextCursor: nextCursor(rows, query.limit),
      };
    });
  }

  async platformDispute(disputeId: string) {
    return this.db.withContext('marketplace_admin', async (tx) => {
      const row = await tx.marketplaceDispute.findUnique({ where: { id: disputeId } });
      if (!row) throw new NotFoundError('Dispute not found', 'DISPUTE_NOT_FOUND');
      return disputeView(row);
    });
  }

  async resolveDispute(
    staffUserId: string,
    disputeId: string,
    input: z.infer<typeof resolveDisputeSchema>,
  ) {
    const located = await this.platformDispute(disputeId);
    const { order, refundKobo } = await this.db.withContext(
      'marketplace_admin',
      async (tx) => {
        const dispute = await tx.marketplaceDispute.findUniqueOrThrow({ where: { id: disputeId } });
        if (dispute.status !== 'open')
          throw new ConflictError('DISPUTE_RESOLVED', 'This dispute is already resolved');
        const row = await tx.marketplaceOrder.findUniqueOrThrow({ where: { id: dispute.orderId } });
        const amount = Number(row.amount ?? 0n);
        const refund =
          input.resolution === 'refund'
            ? amount
            : input.resolution === 'partial_refund'
              ? (input.refundKobo ?? 0)
              : 0;
        if (input.resolution === 'partial_refund' && refund >= amount)
          throw new DomainError(
            'REFUND_TOO_LARGE',
            'A partial refund must be less than the amount paid; choose a full refund instead',
            422,
          );
        const updated = await this.transition(
          tx,
          row,
          input.resolution === 'refund' ? 'resolve_refund' : 'resolve_no_action',
          'platform',
          staffUserId,
          {},
          input.note,
        );
        await tx.marketplaceDispute.update({
          where: { id: dispute.id },
          data: {
            status: 'resolved',
            resolution: input.resolution,
            refundAmount: refund > 0 ? BigInt(refund) : null,
            note: input.note,
            handledBy: staffUserId,
            resolvedAt: new Date(),
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'marketplace.dispute.resolved',
            estateId: row.estateId,
            aggregateType: 'marketplace_dispute',
            aggregateId: dispute.id,
            payload: {
              disputeId: dispute.id,
              orderId: row.id,
              resolution: input.resolution,
              refundKobo: refund,
            },
            audit: {
              actorType: 'platform_staff',
              actorId: staffUserId,
              action: 'marketplace.dispute.resolve',
              resourceType: 'marketplace_dispute',
              resourceId: dispute.id,
              after: { resolution: input.resolution, refundKobo: refund },
              reason: input.note,
            },
          },
        ]);
        return { order: updated, refundKobo: refund };
      },
      { estateId: located.estateId, userId: staffUserId },
    );
    if (refundKobo > 0) await this.requestRefund(order, refundKobo, 'dispute');
    await this.notifyResident(order);
    return this.platformDispute(disputeId);
  }

  // ---- Helpers -------------------------------------------------------------------------------

  private async residentAction(
    access: EstateAccess,
    orderId: string,
    action: OrderAction,
    patch: (row: OrderRow) => Prisma.MarketplaceOrderUpdateManyMutationInput,
    extra?: (tx: Tx, row: OrderRow) => Promise<void>,
  ) {
    const row = await this.asResident(access, async (tx) => {
      const order = await this.loadResidentOrder(tx, access, orderId);
      const updated = await this.transition(
        tx,
        order,
        action,
        'resident',
        access.userId,
        patch(order),
        null,
      );
      if (extra) await extra(tx, updated);
      return updated;
    });
    if (action === 'cancel_by_resident' && row.paidAt)
      await this.requestRefund(row, Number(row.amount), 'cancelled_by_resident');
    const names = await this.db.withContext('marketplace', (tx) => this.names(tx, [row]));
    await this.notifyVendor(
      row,
      'marketplace.order_updated',
      names.listings.get(row.listingId) ?? '',
      names.vendors.get(row.vendorId) ?? '',
    );
    return this.residentDetail(access, orderId);
  }

  /** Applies a state-machine transition with optimistic locking and appends the history row and event. */
  private async transition(
    tx: Tx,
    order: OrderRow,
    action: OrderAction,
    actor: OrderActor,
    actorUserId: string,
    patch: Prisma.MarketplaceOrderUpdateManyMutationInput,
    note: string | null,
  ): Promise<OrderRow> {
    const check = checkTransition(
      action,
      { status: order.status as OrderStatus, paid: order.paidAt !== null },
      actor,
    );
    if (!check.ok) throw REFUSALS[check.reason](action);
    const result = await tx.marketplaceOrder.updateMany({
      where: { id: order.id, version: order.version },
      data: { ...patch, status: check.to, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new ConflictError('ORDER_CHANGED', 'The order changed. Refresh and try again.');
    const updated = await tx.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    await this.history(
      tx,
      updated,
      order.status as OrderStatus,
      check.to,
      actor,
      actorUserId,
      note,
    );
    await appendOutboxEvents(tx, [
      {
        type: `marketplace.order.${EVENT_VERBS[action]}`,
        estateId: order.estateId,
        aggregateType: 'marketplace_order',
        aggregateId: order.id,
        payload: { orderId: order.id, from: order.status, to: check.to },
        audit: {
          actorType: actor === 'platform' ? 'platform_staff' : 'user',
          actorId: actorUserId,
          action: `marketplace.order.${action}`,
          resourceType: 'marketplace_order',
          resourceId: order.id,
          before: { status: order.status },
          after: { status: check.to },
          reason: note,
        },
      },
    ]);
    return updated;
  }

  private async history(
    tx: Tx,
    row: OrderRow,
    from: OrderStatus | null,
    to: OrderStatus,
    actorKind: OrderActor | 'system',
    actorUserId: string | null,
    note: string | null,
  ) {
    await tx.marketplaceOrderEvent.create({
      data: {
        estateId: row.estateId,
        vendorId: row.vendorId,
        orderId: row.id,
        fromStatus: from,
        toStatus: to,
        actorKind,
        actorUserId,
        note,
      },
    });
  }

  /** Refunds happen in the worker (marketplace queue) so a provider outage never loses one. */
  private async requestRefund(row: OrderRow, targetKobo: number, reason: string) {
    await this.db.withContext(
      'marketplace',
      (tx) =>
        appendOutboxEvents(tx, [
          {
            type: 'marketplace.order.refund_requested',
            estateId: row.estateId,
            aggregateType: 'marketplace_order',
            aggregateId: row.id,
            payload: { orderId: row.id, targetKobo, reason },
          },
        ]),
      { estateId: row.estateId },
    );
  }

  private async loadResidentOrder(tx: Tx, access: EstateAccess, orderId: string) {
    const row = await tx.marketplaceOrder.findFirst({
      where: { id: orderId, estateId: access.estateId, residentUserId: access.userId },
    });
    if (!row) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    return row;
  }

  private async loadVendorOrder(tx: Tx, access: VendorAccess, orderId: string) {
    const row = await tx.marketplaceOrder.findFirst({
      where: {
        id: orderId,
        vendorId: access.vendorId,
        ...(this.personnelOnly(access) ? { assignedMemberId: access.memberId } : {}),
      },
    });
    if (!row) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    return row;
  }

  private async names(tx: Tx, rows: readonly OrderRow[]) {
    const [vendors, listings] = await Promise.all([
      tx.vendor.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.vendorId))] } },
        select: { id: true, name: true },
      }),
      tx.listing.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.listingId))] } },
        select: { id: true, title: true },
      }),
    ]);
    return {
      vendors: new Map(vendors.map((v) => [v.id, v.name])),
      listings: new Map(listings.map((l) => [l.id, l.title])),
    };
  }

  private view(
    row: OrderRow,
    names: { vendors: Map<string, string>; listings: Map<string, string> },
    viewer: 'resident' | 'vendor',
  ) {
    const money = (value: bigint | null) => (value === null ? null : Number(value));
    return {
      id: row.id,
      estateId: row.estateId,
      vendorId: row.vendorId,
      vendorName: names.vendors.get(row.vendorId) ?? '',
      listingId: row.listingId,
      listingTitle: names.listings.get(row.listingId) ?? '',
      spaceId: row.spaceId,
      details: row.details,
      status: row.status as OrderStatus,
      preferredAt: row.preferredAt?.toISOString() ?? null,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      quoteKobo: money(row.quoteAmount),
      amountKobo: money(row.amount),
      commissionKobo: viewer === 'vendor' ? money(row.commissionAmount) : null,
      vendorAmountKobo: viewer === 'vendor' ? money(row.vendorAmount) : null,
      paid: row.paidAt !== null,
      paidAt: row.paidAt?.toISOString() ?? null,
      assignedMemberId: viewer === 'vendor' ? row.assignedMemberId : null,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async detailView(tx: Tx, row: OrderRow, viewer: 'resident' | 'vendor') {
    const [names, events, review] = await Promise.all([
      this.names(tx, [row]),
      tx.marketplaceOrderEvent.findMany({
        where: { orderId: row.id },
        orderBy: { createdAt: 'asc' },
      }),
      tx.marketplaceReview.findUnique({ where: { orderId: row.id } }),
    ]);
    return {
      ...this.view(row, names, viewer),
      events: events.map((e) => ({
        fromStatus: e.fromStatus as OrderStatus | null,
        toStatus: e.toStatus as OrderStatus,
        actorKind: e.actorKind as 'resident',
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      review: review
        ? { rating: review.rating, comment: review.comment, vendorResponse: review.vendorResponse }
        : null,
    };
  }

  private async messages(tx: Tx, orderId: string) {
    return (
      await tx.marketplaceOrderMessage.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        take: 500,
      })
    ).map((m) => ({
      id: m.id,
      authorKind: m.authorKind as 'resident' | 'vendor',
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async notifyVendor(
    row: OrderRow,
    intent: 'marketplace.order_placed' | 'marketplace.order_updated' | 'marketplace.order_message',
    listingTitle: string,
    vendorName: string,
  ) {
    const handlers = await this.vendors.orderHandlers(row.vendorId);
    const userIds = handlers
      .filter((h) => HANDLER_ROLES.includes(h.role) || h.id === row.assignedMemberId)
      .map((h) => h.userId);
    if (userIds.length === 0) return;
    await this.db.withContext(
      'marketplace',
      (tx) =>
        this.notifications.request(tx, {
          intent,
          userIds,
          estateId: row.estateId,
          data: { listing: listingTitle, vendor: vendorName, orderId: row.id },
          dedupeKey: `order:${row.id}:${intent}:${row.version}`,
        }),
      { estateId: row.estateId },
    );
  }

  private async notifyResident(row: OrderRow) {
    await this.db.withContext(
      'marketplace',
      async (tx) => {
        const names = await this.names(tx, [row]);
        await this.notifications.request(tx, {
          intent: 'marketplace.order_updated',
          userIds: [row.residentUserId],
          estateId: row.estateId,
          data: {
            listing: names.listings.get(row.listingId) ?? '',
            vendor: names.vendors.get(row.vendorId) ?? '',
            orderId: row.id,
          },
          dedupeKey: `order:${row.id}:resident:${row.version}`,
        });
      },
      { estateId: row.estateId },
    );
  }
}

function reviewView(row: Prisma.MarketplaceReviewGetPayload<object>) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    vendorResponse: row.vendorResponse,
    createdAt: row.createdAt.toISOString(),
  };
}

function disputeView(row: Prisma.MarketplaceDisputeGetPayload<object>) {
  return {
    id: row.id,
    orderId: row.orderId,
    estateId: row.estateId,
    vendorId: row.vendorId,
    reason: row.reason,
    evidenceFileIds: row.evidenceFileIds,
    status: row.status as 'open' | 'resolved',
    resolution: row.resolution as 'refund' | 'partial_refund' | 'no_action' | null,
    refundKobo: row.refundAmount === null ? null : Number(row.refundAmount),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
