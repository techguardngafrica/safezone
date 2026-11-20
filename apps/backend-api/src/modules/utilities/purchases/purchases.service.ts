import { Injectable, Logger } from '@nestjs/common';
import type {
  createUtilityPurchaseSchema,
  utilityPurchaseListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { EstateAccess } from '../../../common/auth/auth.decorators';
import { DatabaseService } from '../../../common/database/database.service';
import type { Tx } from '../../../common/database/tenant-context';
import { DomainError, NotFoundError } from '../../../common/errors/domain-error';
import { uuidv7 } from '../../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { QueueService } from '../../../common/queues/queue.service';
import { QUEUES } from '../../../common/queues/queues';
import { BillsProvider, BillsProviderError } from '../../../integrations/bills/bills-provider';
import { KeyVault } from '../../../integrations/keys/key-vault';
import { NotificationsService } from '../../notifications/notifications.service';
import { OccupancyService } from '../../occupancy/occupancy.service';
import { PaymentsService } from '../../payments/payments.service';
import { PropertyService } from '../../property/property.service';
import {
  afterVendFailure,
  amountProblem,
  formatToken,
  isStuck,
  MAX_PURCHASE_KOBO,
  MIN_PURCHASE_KOBO,
  onPaid,
  OPEN_PAID_STATUSES,
  PURCHASE_FEE_KOBO,
  VEND_BACKOFF_MS,
} from '../domain/purchases';

type PurchaseRow = Prisma.UtilityPurchaseGetPayload<{ include: { events: true } }>;
type PurchaseBase = Prisma.UtilityPurchaseGetPayload<object>;

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

const AMOUNT_MESSAGES = {
  not_naira: 'Enter a whole naira amount',
  too_small: `The least you can buy is ₦${MIN_PURCHASE_KOBO / 100}`,
  too_large: `The most you can buy at once is ₦${MAX_PURCHASE_KOBO / 100}`,
} as const;

/**
 * Prepaid electricity token purchases (ADR-0018): the resident pays Safezone, Safezone buys the token from
 * the bills aggregator. A token exists only after a verified payment and a successful vend; a paid
 * purchase always ends vended or fully refunded.
 */
@Injectable()
export class PurchasesService {
  private readonly logger = new Logger('UtilityPurchases');

  constructor(
    private readonly db: DatabaseService,
    private readonly bills: BillsProvider,
    private readonly vault: KeyVault,
    private readonly payments: PaymentsService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
  ) {}

  limits() {
    return {
      available: this.bills.canVend,
      minKobo: MIN_PURCHASE_KOBO,
      maxKobo: MAX_PURCHASE_KOBO,
      feeKobo: PURCHASE_FEE_KOBO,
    };
  }

  private async householdUnits(access: EstateAccess): Promise<string[]> {
    return (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
      (h) => h.spaceId,
    );
  }

  async create(
    access: EstateAccess,
    input: z.infer<typeof createUtilityPurchaseSchema>,
    idempotencyKey: string,
  ) {
    if (!this.bills.canVend)
      throw new DomainError('TOKENS_UNAVAILABLE', 'Token purchases are not available yet', 503);
    const problem = amountProblem(input.amountKobo);
    if (problem) throw new DomainError('AMOUNT_INVALID', AMOUNT_MESSAGES[problem], 422);
    const units = await this.householdUnits(access);

    const prepared = await this.db.withTenant(access, async (tx) => {
      const existing = await tx.utilityPurchase.findUnique({
        where: {
          estateId_userId_idempotencyKey: {
            estateId: access.estateId,
            userId: access.userId,
            idempotencyKey,
          },
        },
      });
      if (existing) return { row: existing, fresh: false };
      const meter = await tx.meter.findFirst({
        where: { id: input.meterId, estateId: access.estateId, status: 'active' },
      });
      // Only meters of the buyer's own household units (no buying for strangers' meters).
      if (!meter || !units.includes(meter.spaceId))
        throw new NotFoundError('Meter not found', 'METER_NOT_FOUND');
      if (meter.type !== 'electricity' || meter.supply !== 'public' || !meter.prepaid)
        throw new DomainError(
          'METER_NOT_PREPAID',
          'Tokens are sold for prepaid DisCo meters only',
          422,
        );
      if (!meter.verifiedAt)
        throw new DomainError('METER_NOT_VERIFIED', 'Verify this meter before buying', 422);
      const row = await tx.utilityPurchase.create({
        data: {
          estateId: access.estateId,
          meterId: meter.id,
          spaceId: meter.spaceId,
          userId: access.userId,
          amount: BigInt(input.amountKobo),
          fee: BigInt(PURCHASE_FEE_KOBO),
          total: BigInt(input.amountKobo + PURCHASE_FEE_KOBO),
          provider: this.payments.provider,
          paymentReference: `szt_${uuidv7().replace(/-/g, '')}`,
          idempotencyKey,
        },
      });
      await this.event(tx, row, 'created', null);
      return { row, fresh: true };
    });
    if (!prepared.fresh) return this.detail(access, prepared.row.id);

    const row = prepared.row;
    try {
      const checkout = await this.payments.startPlatformCharge({
        estateId: access.estateId,
        payerUserId: access.userId,
        reference: row.paymentReference,
        amountKobo: Number(row.total),
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
        metadata: { purpose: 'utility_purchase', purchaseId: row.id },
      });
      await this.db.withTenant(access, (tx) =>
        tx.utilityPurchase.update({
          where: { id: row.id },
          data: { authorizationUrl: checkout.authorizationUrl },
        }),
      );
    } catch (error) {
      await this.db.withTenant(access, async (tx) => {
        await tx.utilityPurchase.update({
          where: { id: row.id },
          data: { status: 'failed', failureReason: 'checkout_unavailable' },
        });
        await this.event(tx, row, 'checkout_failed', null);
      });
      throw error;
    }
    return this.detail(access, row.id);
  }

  async list(access: EstateAccess, query: z.infer<typeof utilityPurchaseListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const units = await this.householdUnits(access);
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.utilityPurchase.findMany({
        where: {
          estateId: access.estateId,
          OR: [{ userId: access.userId }, { spaceId: { in: units } }],
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
      });
      const page = rows.slice(0, query.limit);
      const context = await this.context(tx, access.estateId, page);
      const last = page.at(-1);
      return {
        items: page.map((row) => this.view(row, context)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  /** The buyer and their household members see the token (utilities.md rule 4). */
  async detail(access: EstateAccess, purchaseId: string) {
    const units = await this.householdUnits(access);
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.utilityPurchase.findFirst({
        where: {
          id: purchaseId,
          estateId: access.estateId,
          OR: [{ userId: access.userId }, { spaceId: { in: units } }],
        },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      });
      if (!row) throw new NotFoundError('Purchase not found', 'PURCHASE_NOT_FOUND');
      return this.detailView(row, await this.context(tx, access.estateId, [row]));
    });
  }

  /** The buyer's return from checkout: ask the provider now instead of waiting for the webhook. */
  async verify(access: EstateAccess, purchaseId: string) {
    const current = await this.detail(access, purchaseId);
    if (current.status === 'created') {
      const reference = await this.db.withTenant(access, async (tx) => {
        const row = await tx.utilityPurchase.findFirstOrThrow({ where: { id: purchaseId } });
        return row.paymentReference;
      });
      const result = await this.payments.processReference(reference);
      if (result.outcome === 'platform_paid')
        await this.handlePaid(
          result.estateId,
          result.reference,
          result.amountKobo,
          result.providerTransactionId,
        );
    }
    return this.detail(access, purchaseId);
  }

  // ---- Worker steps (idempotent) -------------------------------------------------------------

  /** A verified payment (webhook or verify). Queues the vend, or a refund for a short payment. */
  async handlePaid(
    estateId: string,
    reference: string,
    paidKobo: number,
    providerTransactionId: string,
  ): Promise<void> {
    const outcome = await this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.utilityPurchase.findFirst({
        where: { estateId, paymentReference: reference },
      });
      if (!row) return null;
      const next = onPaid(row.status, paidKobo, Number(row.total));
      if (next === 'ignore') return null;
      const updated = await tx.utilityPurchase.updateMany({
        where: { id: row.id, status: 'created' },
        data: {
          status: next,
          paidAt: new Date(),
          providerTransactionId,
          authorizationUrl: null,
          ...(next === 'refund_pending' ? { failureReason: 'amount_short' } : {}),
        },
      });
      if (updated.count !== 1) return null;
      await this.event(tx, row, next === 'paid' ? 'paid' : 'paid_short', null);
      return { id: row.id, next };
    });
    if (!outcome) return;
    if (outcome.next === 'paid') await this.queueVend(estateId, outcome.id);
    else await this.queueRefund(estateId, outcome.id);
  }

  /** A failed or abandoned checkout. */
  async handleChargeFailed(estateId: string, reference: string): Promise<void> {
    await this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.utilityPurchase.findFirst({
        where: { estateId, paymentReference: reference, status: 'created' },
      });
      if (!row) return;
      await tx.utilityPurchase.update({
        where: { id: row.id },
        data: { status: 'failed', failureReason: 'payment_failed', authorizationUrl: null },
      });
      await this.event(tx, row, 'payment_failed', null);
    });
  }

  /**
   * One vend attempt. Retryable failures throw so the queue retries with backoff; the last failure (or a
   * permanent one) moves the purchase to refund.
   */
  async vend(
    estateId: string,
    purchaseId: string,
  ): Promise<'vended' | 'retry' | 'refund' | 'skip'> {
    const context = { estateId, userId: null };
    const claimed = await this.db.withTenant(context, async (tx) => {
      const row = await tx.utilityPurchase.findFirst({ where: { id: purchaseId, estateId } });
      if (!row || (row.status !== 'paid' && row.status !== 'vending')) return null;
      const meter = await tx.meter.findFirst({ where: { id: row.meterId, estateId } });
      const updated = await tx.utilityPurchase.update({
        where: { id: row.id },
        data: { status: 'vending', attempts: { increment: 1 } },
      });
      return meter ? { row: updated, meter } : null;
    });
    if (!claimed) return 'skip';
    const { row, meter } = claimed;
    try {
      const result = await this.bills.vend({
        requestId: row.id,
        providerCode: meter.providerCode,
        meterNumber: meter.meterNumber,
        amountKobo: Number(row.amount),
      });
      await this.db.withTenant(context, async (tx) => {
        await tx.utilityPurchase.update({
          where: { id: row.id },
          data: {
            status: 'vended',
            vendedAt: new Date(),
            vendRef: result.providerRef,
            tokenWrapped: this.vault.wrap(Buffer.from(result.token, 'utf8')),
            unitsKwh: result.unitsKwh,
            failureReason: null,
          },
        });
        await this.event(tx, row, 'vended', null);
        // The token itself never goes into notifications or the outbox (it would be stored in plain text).
        await this.notifications.request(tx, {
          intent: 'utilities.token_ready',
          userIds: [row.userId],
          estateId,
          data: { meterNumber: meter.meterNumber, purchaseId: row.id },
          dedupeKey: `token:${row.id}`,
        });
      });
      return 'vended';
    } catch (error) {
      const retryable = error instanceof BillsProviderError ? error.retryable : true;
      const next = afterVendFailure(row.attempts, retryable);
      await this.db.withTenant(context, (tx) =>
        this.event(
          tx,
          row,
          'vend_failed',
          error instanceof Error ? error.message.slice(0, 120) : null,
        ),
      );
      if (next === 'retry') return 'retry';
      await this.db.withTenant(context, (tx) =>
        tx.utilityPurchase.update({
          where: { id: row.id },
          data: { status: 'refund_pending', failureReason: 'vend_failed' },
        }),
      );
      await this.queueRefund(estateId, row.id);
      return 'refund';
    }
  }

  /** Full refund of a paid purchase that could not be vended. Stays refund_pending (and alerts) on failure. */
  async refund(estateId: string, purchaseId: string): Promise<'refunded' | 'skip' | 'failed'> {
    const context = { estateId, userId: null };
    const row = await this.db.withTenant(context, (tx) =>
      tx.utilityPurchase.findFirst({
        where: { id: purchaseId, estateId, status: 'refund_pending' },
      }),
    );
    if (!row) return 'skip';
    try {
      const result = await this.payments.refundPlatformCharge(
        row.paymentReference,
        Number(row.total),
      );
      if (result.status === 'failed') throw new Error('Refund failed at the provider');
      await this.db.withTenant(context, async (tx) => {
        await tx.utilityPurchase.update({
          where: { id: row.id },
          data: { status: 'refunded', refundedAt: new Date(), refundRef: result.providerRef },
        });
        await this.event(tx, row, 'refunded', null);
        await this.notifications.request(tx, {
          intent: 'utilities.purchase_refunded',
          userIds: [row.userId],
          estateId,
          data: {
            amount: `₦${(Number(row.total) / 100).toLocaleString('en-NG')}`,
            purchaseId: row.id,
          },
          dedupeKey: `token-refund:${row.id}`,
        });
      });
      return 'refunded';
    } catch (error) {
      this.logger.error({
        msg: 'token purchase refund failed',
        estateId,
        purchaseId: row.id,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return 'failed';
    }
  }

  /** Paid purchases with no token or refund after 15 minutes raise an alert once, and refunds retry. */
  async sweep(estateId: string): Promise<{ stuck: number }> {
    const context = { estateId, userId: null };
    const now = new Date();
    const rows = await this.db.withTenant(context, (tx) =>
      tx.utilityPurchase.findMany({
        where: { estateId, status: { in: [...OPEN_PAID_STATUSES] } },
        take: 500,
      }),
    );
    let stuck = 0;
    for (const row of rows) {
      if (row.status === 'refund_pending') await this.queueRefund(estateId, row.id);
      if (!isStuck(row.status, row.paidAt, now)) continue;
      stuck += 1;
      if (row.alertedAt) continue;
      this.logger.error({
        msg: 'ALERT token purchase paid but not vended or refunded after 15 minutes',
        estateId,
        purchaseId: row.id,
        status: row.status,
      });
      await this.db.withTenant(context, async (tx) => {
        await tx.utilityPurchase.update({ where: { id: row.id }, data: { alertedAt: now } });
        await this.event(tx, row, 'alerted', null);
      });
    }
    return { stuck };
  }

  private async queueVend(estateId: string, purchaseId: string) {
    await this.queues.add(
      QUEUES.utilities,
      'utilities.vend',
      { estateId, purchaseId },
      { jobId: `vend-${purchaseId}`, attempts: 1 },
    );
  }

  /** Re-queues a vend after the backoff for this attempt. */
  async retryVend(estateId: string, purchaseId: string, attempts: number) {
    const delay = VEND_BACKOFF_MS[Math.min(attempts, VEND_BACKOFF_MS.length) - 1] ?? 60_000;
    await this.queues.add(
      QUEUES.utilities,
      'utilities.vend',
      { estateId, purchaseId },
      { jobId: `vend-${purchaseId}-${attempts}`, delay, attempts: 1 },
    );
  }

  private async queueRefund(estateId: string, purchaseId: string) {
    await this.queues.add(
      QUEUES.utilities,
      'utilities.refund',
      { estateId, purchaseId },
      { jobId: `refund-${purchaseId}-${Math.floor(Date.now() / 300_000)}`, attempts: 1 },
    );
  }

  async attemptsOf(estateId: string, purchaseId: string): Promise<number> {
    const row = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.utilityPurchase.findFirst({
        where: { id: purchaseId, estateId },
        select: { attempts: true },
      }),
    );
    return row?.attempts ?? 0;
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async event(tx: Tx, row: PurchaseBase, type: string, detail: string | null) {
    await tx.utilityPurchaseEvent.create({
      data: { estateId: row.estateId, purchaseId: row.id, type, detail },
    });
    if (['paid', 'vended', 'refunded', 'alerted'].includes(type))
      await appendOutboxEvents(tx, [
        {
          type: `utilities.purchase.${type}`,
          estateId: row.estateId,
          aggregateType: 'utility_purchase',
          aggregateId: row.id,
          payload: { purchaseId: row.id, total: Number(row.total) },
          audit: {
            actorType: 'system',
            action: `utilities.purchase.${type}`,
            resourceType: 'utility_purchase',
            resourceId: row.id,
          },
        },
      ]);
  }

  private async context(tx: Tx, estateId: string, rows: readonly PurchaseBase[]) {
    const meterIds = [...new Set(rows.map((row) => row.meterId))];
    const [meters, units] = await Promise.all([
      meterIds.length > 0
        ? tx.meter.findMany({
            where: { estateId, id: { in: meterIds } },
            select: { id: true, meterNumber: true, providerCode: true },
          })
        : [],
      this.property.spacesByIds(
        tx,
        estateId,
        rows.map((row) => row.spaceId),
      ),
    ]);
    return {
      meters: new Map(meters.map((meter) => [meter.id, meter])),
      units: new Map(units.map((unit) => [unit.id, unit.code])),
    };
  }

  private view(
    row: PurchaseBase,
    context: {
      meters: Map<string, { meterNumber: string; providerCode: string }>;
      units: Map<string, string>;
    },
  ) {
    const meter = context.meters.get(row.meterId);
    return {
      id: row.id,
      meterId: row.meterId,
      meterNumber: meter?.meterNumber ?? '',
      providerCode: meter?.providerCode ?? '',
      unitCode: context.units.get(row.spaceId) ?? null,
      amountKobo: Number(row.amount),
      feeKobo: Number(row.fee),
      totalKobo: Number(row.total),
      status: row.status as 'created',
      authorizationUrl: row.status === 'created' ? row.authorizationUrl : null,
      unitsKwh: row.unitsKwh === null ? null : Number(row.unitsKwh),
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      vendedAt: row.vendedAt?.toISOString() ?? null,
      refundedAt: row.refundedAt?.toISOString() ?? null,
    };
  }

  private detailView(row: PurchaseRow, context: Parameters<PurchasesService['view']>[1]) {
    return {
      ...this.view(row, context),
      token:
        row.status === 'vended' && row.tokenWrapped
          ? formatToken(this.vault.unwrap(row.tokenWrapped).toString('utf8'))
          : null,
      events: row.events.map((event) => ({
        type: event.type,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}
