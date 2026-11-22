import { Injectable, Logger } from '@nestjs/common';
import {
  type createTopupSchema,
  normalizeNigerianPhone,
  type topupListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { EstateAccess } from '../../../common/auth/auth.decorators';
import { DatabaseService } from '../../../common/database/database.service';
import { DomainError, NotFoundError } from '../../../common/errors/domain-error';
import { uuidv7 } from '../../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { QueueService } from '../../../common/queues/queue.service';
import { QUEUES } from '../../../common/queues/queues';
import {
  type Network,
  TopUpProvider,
  TopUpProviderError,
  type TopUpResult,
  vtpassRequestId,
} from '../../../integrations/bills/topup-provider';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { onPaid } from '../domain/purchases';
import {
  AIRTIME_MAX_KOBO,
  AIRTIME_MIN_KOBO,
  airtimeProblem,
  maskedPhone,
  nextRequeryDelay,
  TOPUP_FEE_KOBO,
  topupStuck,
} from '../domain/topups';

type Row = Prisma.TopupPurchaseGetPayload<object>;
const cursorSchema = z.object({ createdAt: z.string(), id: z.uuid() });
const isCursor = (value: unknown): value is z.infer<typeof cursorSchema> =>
  cursorSchema.safeParse(value).success;
const AMOUNT_MESSAGES = {
  not_naira: 'Enter a whole naira amount',
  too_small: `The smallest airtime top-up is ₦${AIRTIME_MIN_KOBO / 100}`,
  too_large: `The largest airtime top-up is ₦${(AIRTIME_MAX_KOBO / 100).toLocaleString('en-NG')}`,
} as const;

/**
 * Airtime and data (ADR-0025): Safezone sells on its own account (platform charge), then delivers through
 * the aggregator after the payment is verified. A paid purchase ends delivered or fully refunded; a pending
 * answer is requeried, never refunded blindly (it may still deliver).
 */
@Injectable()
export class TopupsService {
  private readonly logger = new Logger('Topups');

  constructor(
    private readonly db: DatabaseService,
    private readonly provider: TopUpProvider,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
  ) {}

  limits() {
    return {
      available: this.provider.available,
      airtimeMinKobo: AIRTIME_MIN_KOBO,
      airtimeMaxKobo: AIRTIME_MAX_KOBO,
      feeKobo: TOPUP_FEE_KOBO,
    };
  }

  async dataPlans(network: Network) {
    this.assertAvailable();
    try {
      return await this.provider.dataPlans(network);
    } catch {
      throw new DomainError(
        'TOPUP_PROVIDER_UNAVAILABLE',
        'Data plans are not available right now. Try again shortly.',
        502,
      );
    }
  }

  async create(
    access: EstateAccess,
    input: z.infer<typeof createTopupSchema>,
    idempotencyKey: string,
  ) {
    this.assertAvailable();
    const existing = await this.db.withTenant(access, (tx) =>
      tx.topupPurchase.findUnique({
        where: {
          estateId_userId_idempotencyKey: {
            estateId: access.estateId,
            userId: access.userId,
            idempotencyKey,
          },
        },
      }),
    );
    if (existing) return view(existing);

    const phone = normalizeNigerianPhone(input.phone);
    if (!phone) throw new DomainError('PHONE_INVALID', 'Enter a valid Nigerian phone number', 422);
    let amountKobo: number;
    let planName: string | null = null;
    if (input.kind === 'airtime') {
      const problem = airtimeProblem(input.amountKobo ?? 0);
      if (problem) throw new DomainError('AMOUNT_INVALID', AMOUNT_MESSAGES[problem], 422);
      amountKobo = input.amountKobo ?? 0;
    } else {
      // The plan's own price, never the client's.
      const plan = (await this.dataPlans(input.network)).find((p) => p.code === input.planCode);
      if (!plan) throw new DomainError('DATA_PLAN_NOT_FOUND', 'Choose a plan from the list', 422);
      amountKobo = plan.amountKobo;
      planName = plan.name;
    }
    const total = amountKobo + TOPUP_FEE_KOBO;
    const row = await this.db.withTenant(access, (tx) =>
      tx.topupPurchase.create({
        data: {
          estateId: access.estateId,
          userId: access.userId,
          kind: input.kind,
          network: input.network,
          phone,
          variationCode: input.kind === 'data' ? (input.planCode ?? null) : null,
          planName,
          amount: BigInt(amountKobo),
          fee: BigInt(TOPUP_FEE_KOBO),
          total: BigInt(total),
          paymentReference: `sz_top_${uuidv7().replace(/-/g, '')}`,
          idempotencyKey,
          provider: this.provider.name,
        },
      }),
    );
    try {
      const checkout = await this.payments.startPlatformCharge({
        estateId: access.estateId,
        payerUserId: access.userId,
        reference: row.paymentReference,
        amountKobo: total,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
        metadata: { purpose: 'topup', topupId: row.id },
        ...(input.saveCard ? { saveCard: true } : {}),
        ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
      });
      await this.db.withTenant(access, (tx) =>
        tx.topupPurchase.update({
          where: { id: row.id },
          data: { authorizationUrl: checkout.authorizationUrl },
        }),
      );
      if (!checkout.authorizationUrl) return this.verify(access, row.id);
    } catch (error) {
      await this.db.withTenant(access, (tx) =>
        tx.topupPurchase.update({
          where: { id: row.id },
          data: { status: 'failed', failureReason: 'checkout_unavailable' },
        }),
      );
      throw error;
    }
    return this.get(access, row.id);
  }

  async list(access: EstateAccess, query: z.infer<typeof topupListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isCursor) : null;
    const rows = await this.db.withTenant(access, (tx) =>
      tx.topupPurchase.findMany({
        where: {
          estateId: access.estateId,
          userId: access.userId,
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
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(view),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async get(access: EstateAccess, id: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.topupPurchase.findFirst({
        where: { id, estateId: access.estateId, userId: access.userId },
      }),
    );
    if (!row) throw new NotFoundError('Purchase not found', 'TOPUP_NOT_FOUND');
    return view(row);
  }

  /** The buyer back from checkout: ask the provider now instead of waiting for the webhook. */
  async verify(access: EstateAccess, id: string) {
    const current = await this.get(access, id);
    if (current.status === 'created') {
      const row = await this.db.withTenant(access, (tx) =>
        tx.topupPurchase.findFirstOrThrow({ where: { id } }),
      );
      const result = await this.payments.processReference(row.paymentReference);
      if (result.outcome === 'platform_paid')
        await this.handlePaid(result.estateId, result.reference, result.amountKobo);
    }
    return this.get(access, id);
  }

  // ---- Worker steps (idempotent) -------------------------------------------------------------

  async handlePaid(estateId: string, reference: string, paidKobo: number): Promise<void> {
    const outcome = await this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.topupPurchase.findFirst({
        where: { estateId, paymentReference: reference },
      });
      if (!row) return null;
      const next = onPaid(row.status as 'created', paidKobo, Number(row.total));
      if (next === 'ignore') return null;
      const updated = await tx.topupPurchase.updateMany({
        where: { id: row.id, status: 'created' },
        data: {
          status: next,
          paidAt: new Date(),
          authorizationUrl: null,
          ...(next === 'refund_pending' ? { failureReason: 'amount_short' } : {}),
        },
      });
      if (updated.count !== 1) return null;
      await this.event(tx, row, next === 'paid' ? 'paid' : 'paid_short');
      return { id: row.id, next };
    });
    if (!outcome) return;
    if (outcome.next === 'paid')
      await this.queue('topups.deliver', estateId, outcome.id, 0, `topup-deliver-${outcome.id}`);
    else await this.queue('topups.refund', estateId, outcome.id, 0, `topup-refund-${outcome.id}`);
  }

  async handleChargeFailed(estateId: string, reference: string): Promise<void> {
    await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.topupPurchase.updateMany({
        where: { estateId, paymentReference: reference, status: 'created' },
        data: { status: 'failed', failureReason: 'payment_failed', authorizationUrl: null },
      }),
    );
  }

  /** First delivery attempt. The request id is fixed here and reused by every requery. */
  async deliver(estateId: string, id: string): Promise<void> {
    const context = { estateId, userId: null };
    const row = await this.db.withTenant(context, async (tx) => {
      const found = await tx.topupPurchase.findFirst({ where: { id, estateId } });
      if (!found || found.status !== 'paid') return null;
      return tx.topupPurchase.update({
        where: { id },
        data: {
          status: 'delivering',
          requestId: found.requestId ?? vtpassRequestId(id, new Date()),
        },
      });
    });
    if (!row?.requestId) return;
    let result: TopUpResult;
    try {
      result =
        row.kind === 'airtime'
          ? await this.provider.airtime({
              requestId: row.requestId,
              network: row.network as Network,
              phone: row.phone,
              amountKobo: Number(row.amount),
            })
          : await this.provider.data({
              requestId: row.requestId,
              network: row.network as Network,
              phone: row.phone,
              planCode: row.variationCode ?? '',
            });
    } catch (error) {
      // A refused request was not charged at the aggregator; anything else is pending until requeried.
      result =
        error instanceof TopUpProviderError && !error.retryable
          ? { status: 'failed', providerRef: null, reason: error.message.slice(0, 80) }
          : { status: 'pending', providerRef: null, reason: 'provider_error' };
    }
    await this.apply(estateId, id, result);
  }

  /** Requery while the aggregator says pending (VTpass guidance); stop after the schedule and alert. */
  async requery(estateId: string, id: string): Promise<void> {
    const row = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.topupPurchase.findFirst({ where: { id, estateId, status: 'delivering' } }),
    );
    if (!row?.requestId) return;
    let result: TopUpResult;
    try {
      result = await this.provider.requery(row.requestId);
    } catch {
      result = { status: 'pending', providerRef: null, reason: 'requery_error' };
    }
    await this.apply(estateId, id, result);
  }

  async refund(estateId: string, id: string): Promise<'refunded' | 'skip' | 'failed'> {
    const context = { estateId, userId: null };
    const row = await this.db.withTenant(context, (tx) =>
      tx.topupPurchase.findFirst({ where: { id, estateId, status: 'refund_pending' } }),
    );
    if (!row) return 'skip';
    try {
      const result = await this.payments.refundPlatformCharge(
        row.paymentReference,
        Number(row.total),
      );
      if (result.status === 'failed') throw new Error('Refund failed at the provider');
      await this.db.withTenant(context, async (tx) => {
        await tx.topupPurchase.update({
          where: { id },
          data: { status: 'refunded', refundedAt: new Date() },
        });
        await this.event(tx, row, 'refunded');
        await this.notifications.request(tx, {
          intent: 'utilities.topup_refunded',
          userIds: [row.userId],
          estateId,
          data: {
            amount: `₦${(Number(row.total) / 100).toLocaleString('en-NG')}`,
            phone: maskedPhone(row.phone),
            topupId: row.id,
          },
          dedupeKey: `topup-refund:${row.id}`,
        });
      });
      return 'refunded';
    } catch (error) {
      this.logger.error({
        msg: 'top-up refund failed',
        estateId,
        topupId: id,
        error: (error as Error).name,
      });
      return 'failed';
    }
  }

  /** Every 5 minutes: retry pending refunds; alert once on anything paid and unsettled for 30 minutes. */
  async sweep(estateId: string, now = new Date()) {
    const rows = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.topupPurchase.findMany({
        where: { estateId, status: { in: ['paid', 'delivering', 'refund_pending'] } },
        take: 500,
      }),
    );
    for (const row of rows) {
      if (row.status === 'refund_pending')
        await this.queue(
          'topups.refund',
          estateId,
          row.id,
          0,
          `topup-refund-${row.id}-${now.getTime()}`,
        );
      if (!topupStuck(row.status, row.paidAt, now) || row.alertedAt) continue;
      this.logger.error({
        msg: 'ALERT top-up paid but not delivered or refunded after 30 minutes',
        estateId,
        topupId: row.id,
        status: row.status,
      });
      await this.db.withTenant({ estateId, userId: null }, (tx) =>
        tx.topupPurchase.update({ where: { id: row.id }, data: { alertedAt: now } }),
      );
    }
  }

  private async apply(estateId: string, id: string, result: TopUpResult) {
    const context = { estateId, userId: null };
    if (result.status === 'pending') {
      const row = await this.db.withTenant(context, (tx) =>
        tx.topupPurchase.update({ where: { id }, data: { attempts: { increment: 1 } } }),
      );
      const delay = nextRequeryDelay(row.attempts - 1);
      if (delay !== null)
        await this.queue(
          'topups.requery',
          estateId,
          id,
          delay,
          `topup-requery-${id}-${row.attempts}`,
        );
      return;
    }
    await this.db.withTenant(context, async (tx) => {
      const row = await tx.topupPurchase.findFirstOrThrow({ where: { id } });
      if (row.status !== 'delivering') return;
      if (result.status === 'delivered') {
        await tx.topupPurchase.update({
          where: { id },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
            providerRef: result.providerRef,
            failureReason: null,
          },
        });
        await this.event(tx, row, 'delivered');
        await this.notifications.request(tx, {
          intent: 'utilities.topup_delivered',
          userIds: [row.userId],
          estateId,
          data: {
            phone: maskedPhone(row.phone),
            product: row.kind === 'airtime' ? 'airtime' : (row.planName ?? 'data'),
            topupId: row.id,
          },
          dedupeKey: `topup:${row.id}`,
        });
      } else {
        await tx.topupPurchase.update({
          where: { id },
          data: {
            status: 'refund_pending',
            failureReason: (result.reason ?? 'not_delivered').slice(0, 80),
          },
        });
        await this.event(tx, row, 'not_delivered');
      }
    });
    if (result.status === 'failed')
      await this.queue('topups.refund', estateId, id, 0, `topup-refund-${id}`);
  }

  private async queue(name: string, estateId: string, id: string, delay: number, jobId: string) {
    await this.queues.add(
      QUEUES.utilities,
      name,
      { estateId, purchaseId: id },
      { jobId, delay, attempts: 3 },
    );
  }

  private assertAvailable() {
    if (!this.provider.available)
      throw new DomainError('TOPUP_UNAVAILABLE', 'Airtime and data are not available yet', 503);
  }

  private async event(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    row: Row,
    what: string,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `utilities.topup.${what}`,
        estateId: row.estateId,
        aggregateType: 'topup_purchase',
        aggregateId: row.id,
        payload: { topupId: row.id, kind: row.kind, network: row.network },
      },
    ]);
  }
}

function view(row: Row) {
  return {
    id: row.id,
    kind: row.kind as 'airtime' | 'data',
    network: row.network as Network,
    phone: row.phone,
    planName: row.planName,
    amountKobo: Number(row.amount),
    feeKobo: Number(row.fee),
    totalKobo: Number(row.total),
    status: row.status as 'created',
    authorizationUrl: row.status === 'created' ? row.authorizationUrl : null,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
  };
}
