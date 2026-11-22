import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  paymentIntentStatusSchema,
  type createManualPaymentSchema,
  type createPaymentIntentSchema,
  type createRefundSchema,
  type manualPaymentListQuerySchema,
  type payoutAccountSetupSchema,
  type refundListQuerySchema,
  type transactionListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { asModule, type Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  PaymentGateway,
  PaymentProviderError,
  type VerifiedCharge,
} from '../../integrations/payments/payment-gateway';
import { accounts, dateOnly, parseDateOnly, sum, toKobo } from '../billing/domain/billing';
import { formatNaira, InvoicesService } from '../billing/invoices.service';
import { LedgerService } from '../billing/ledger.service';
import { UserDirectory } from '../identity/user-directory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { checkoutMetadata, WalletStore } from './wallet-store.service';

const INTENT_TTL_MS = 60 * 60 * 1000;
const txCursorSchema = z.object({ paidAt: z.iso.datetime(), id: z.uuid() });
type IntentRow = Prisma.PaymentIntentGetPayload<object>;
type RefundRow = Prisma.RefundGetPayload<object>;
type ManualRow = Prisma.ManualPaymentGetPayload<object>;

/** Result of processing a provider reference (webhook or the payer's "check now"). */
export type ProcessResult =
  | { outcome: 'recorded'; estateId: string; transactionId: string }
  | {
      /** A verified platform charge (ADR-0018): Safezone's own sale, never estate money. */
      outcome: 'platform_paid';
      estateId: string;
      reference: string;
      amountKobo: number;
      providerTransactionId: string;
    }
  | {
      /** A verified marketplace order charge (ADR-0023): split between the vendor and Safezone. */
      outcome: 'marketplace_paid';
      estateId: string;
      reference: string;
      amountKobo: number;
      providerTransactionId: string;
    }
  | {
      /** A verified ad invoice charge (ADR-0024): Safezone's own revenue, no estate. */
      outcome: 'ad_paid';
      reference: string;
      amountKobo: number;
      providerTransactionId: string;
    }
  | { outcome: 'transfer_paid'; estateId: string; reference: string }
  | { outcome: 'duplicate' | 'pending' | 'failed' | 'unknown_reference' | 'ignored' };

function last4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

/**
 * Payments (payments.md). Money moves only through the provider and settles to the estate's subaccount;
 * a payment counts only after server-side verification, then billing allocates it in the same
 * transaction as the verified transaction row (ADR-0013).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: PaymentGateway,
    private readonly invoices: InvoicesService,
    private readonly ledger: LedgerService,
    private readonly tenancy: TenancyService,
    private readonly occupancy: OccupancyService,
    private readonly users: UserDirectory,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
    private readonly wallet: WalletStore,
  ) {}

  // ---- Estate payout account -----------------------------------------------------------------

  async banks() {
    try {
      return await this.gateway.listBanks();
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /**
   * Links the estate's bank account through a provider subaccount (payments.md §3.1). The account
   * number goes to the provider only; we keep its last 4 digits.
   */
  async setupPayout(access: EstateAccess, input: z.infer<typeof payoutAccountSetupSchema>) {
    const profile = await this.tenancy.getProfile(access);
    let resolved: { accountName: string; bankName: string };
    let subaccount: { subaccountCode: string };
    try {
      resolved = await this.gateway.resolveAccount(input.bankCode, input.accountNumber);
      subaccount = await this.gateway.createSubaccount({
        businessName: profile.name,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
      });
    } catch (error) {
      throw this.providerError(error);
    }
    return this.db.withTenant(access, async (tx) => {
      const previous = await tx.payoutAccount.findFirst({
        where: { estateId: access.estateId, provider: this.gateway.provider, status: 'active' },
      });
      if (previous) {
        await tx.payoutAccount.update({
          where: { id: previous.id },
          data: { status: 'disabled', disabledAt: new Date() },
        });
      }
      const row = await tx.payoutAccount.create({
        data: {
          estateId: access.estateId,
          provider: this.gateway.provider,
          subaccountCode: subaccount.subaccountCode,
          bankCode: input.bankCode,
          bankName: resolved.bankName,
          accountName: resolved.accountName,
          accountLast4: last4(input.accountNumber),
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.payout_account.linked',
          estateId: access.estateId,
          aggregateType: 'payout_account',
          aggregateId: row.id,
          payload: { payoutAccountId: row.id, provider: row.provider },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'payments.payout_account.link',
            resourceType: 'payout_account',
            resourceId: row.id,
            before: previous
              ? { bankName: previous.bankName, accountLast4: previous.accountLast4 }
              : undefined,
            after: { bankName: row.bankName, accountLast4: row.accountLast4 },
          },
        },
      ]);
      return this.payoutView(row);
    });
  }

  async payoutAccount(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.payoutAccount.findFirst({
        where: { estateId: access.estateId, provider: this.gateway.provider, status: 'active' },
      });
      if (!row)
        throw new NotFoundError(
          'Payments are not set up for this estate',
          'PAYOUT_ACCOUNT_NOT_FOUND',
        );
      return this.payoutView(row);
    });
  }

  private payoutView(row: Prisma.PayoutAccountGetPayload<object>) {
    return {
      id: row.id,
      provider: row.provider as 'paystack' | 'fake',
      bankName: row.bankName,
      accountName: row.accountName,
      accountLast4: row.accountLast4,
      status: row.status as 'active' | 'disabled',
      verifiedAt: row.verifiedAt.toISOString(),
    };
  }

  private async activeSubaccount(tx: Tx, estateId: string): Promise<string> {
    const row = await tx.payoutAccount.findFirst({
      where: { estateId, provider: this.gateway.provider, status: 'active' },
      select: { subaccountCode: true },
    });
    if (!row)
      throw new DomainError(
        'PAYMENTS_NOT_SET_UP',
        'This estate has not set up online payments yet',
        422,
      );
    return row.subaccountCode;
  }

  // ---- Checkout -------------------------------------------------------------------------------

  private callbackUrl(requested: string | undefined): string {
    const base = new URL(this.env.PUBLIC_WEB_URL);
    if (!requested) return new URL('/pay/return', base).toString();
    const url = new URL(requested);
    if (url.origin !== base.origin && url.protocol !== 'safezone:')
      throw new DomainError('CALLBACK_URL_NOT_ALLOWED', 'This return link is not allowed', 422);
    return url.toString();
  }

  /**
   * Starts checkout for the caller's open invoices (payments.md §5.1). The amount is computed here, never
   * taken from the client. A repeated Idempotency-Key returns the same intent.
   */
  async createIntent(
    access: EstateAccess,
    input: z.infer<typeof createPaymentIntentSchema>,
    idempotencyKey: string,
  ) {
    const callbackUrl = this.callbackUrl(input.callbackUrl);
    const prepared = await this.db.withTenant(access, async (tx) => {
      const existing = await tx.paymentIntent.findFirst({
        where: { estateId: access.estateId, payerUserId: access.userId, idempotencyKey },
      });
      if (existing) return { row: existing, fresh: false };
      const subaccountCode = await this.activeSubaccount(tx, access.estateId);
      const open = await this.invoices.openInvoices(
        tx,
        access.estateId,
        access.userId,
        input.invoiceIds,
      );
      if (input.invoiceIds && open.length !== new Set(input.invoiceIds).size)
        throw new DomainError(
          'INVOICE_NOT_PAYABLE',
          'One or more invoices are not open or are not yours to pay',
          422,
        );
      if (open.length === 0)
        throw new DomainError('NOTHING_TO_PAY', 'You have no open invoices to pay', 422);
      const amount = sum(open.map((invoice) => invoice.balance));
      const reference = `sz_${uuidv7().replaceAll('-', '')}`;
      const row = await tx.paymentIntent.create({
        data: {
          estateId: access.estateId,
          purpose: 'invoice',
          purposeIds: open.map((invoice) => invoice.id),
          payerUserId: access.userId,
          amount: BigInt(amount),
          provider: this.gateway.provider,
          reference,
          subaccountCode,
          idempotencyKey,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
      await asModule(tx, 'payments', (inner) =>
        inner.paymentRoute.create({
          data: {
            provider: row.provider,
            routeKey: reference,
            kind: 'intent',
            estateId: access.estateId,
          },
        }),
      );
      return { row, fresh: true };
    });
    if (!prepared.fresh) return this.intentView(prepared.row);

    const row = prepared.row;
    const metadata = checkoutMetadata(access.userId, input.saveCard, {
      estateId: access.estateId,
      intentId: row.id,
    });
    if (input.paymentMethodId) {
      // Saved card (ADR-0025): charge now, then verify exactly as after checkout.
      try {
        await this.chargeSaved({
          payerUserId: access.userId,
          paymentMethodId: input.paymentMethodId,
          reference: row.reference,
          amountKobo: toKobo(row.amount),
          subaccountCode: row.subaccountCode,
          metadata,
        });
      } catch (error) {
        await this.db.withTenant(access, (tx) =>
          tx.paymentIntent.update({
            where: { id: row.id },
            data: { status: 'failed', failureReason: 'saved_card_refused' },
          }),
        );
        throw error;
      }
      await this.db.withTenant(access, (tx) =>
        tx.paymentIntent.update({ where: { id: row.id }, data: { status: 'pending' } }),
      );
      await this.processReference(row.reference);
      return this.intent(access, row.id);
    }
    try {
      const checkout = await this.gateway.initialize({
        reference: row.reference,
        amountKobo: toKobo(row.amount),
        // Data minimisation: the provider gets a per-user alias, not the resident's email.
        email: `${access.userId}@payers.safezone.ng`,
        subaccountCode: row.subaccountCode,
        callbackUrl,
        metadata,
      });
      const updated = await this.db.withTenant(access, (tx) =>
        tx.paymentIntent.update({
          where: { id: row.id },
          data: { authorizationUrl: checkout.authorizationUrl, status: 'pending' },
        }),
      );
      return this.intentView(updated);
    } catch (error) {
      await this.db.withTenant(access, (tx) =>
        tx.paymentIntent.update({
          where: { id: row.id },
          data: { status: 'failed', failureReason: 'provider_unavailable' },
        }),
      );
      throw this.providerError(error);
    }
  }

  async intent(access: EstateAccess, intentId: string) {
    return this.db.withTenant(access, async (tx) =>
      this.intentView(await this.loadIntent(tx, access, intentId)),
    );
  }

  /** The payer back from checkout: verify with the provider now instead of waiting for the webhook. */
  async verifyIntent(access: EstateAccess, intentId: string) {
    const row = await this.db.withTenant(access, (tx) => this.loadIntent(tx, access, intentId));
    if (row.status === 'pending' || row.status === 'created')
      await this.processReference(row.reference);
    return this.intent(access, intentId);
  }

  private async loadIntent(tx: Tx, access: EstateAccess, intentId: string): Promise<IntentRow> {
    const row = await tx.paymentIntent.findFirst({
      where: {
        id: intentId,
        estateId: access.estateId,
        ...(isStaffWith(access, 'payment.reconcile') ? {} : { payerUserId: access.userId }),
      },
    });
    if (!row) throw new NotFoundError('Payment not found', 'PAYMENT_INTENT_NOT_FOUND');
    return row;
  }

  private intentView(row: IntentRow) {
    const open = row.status === 'pending' || row.status === 'created';
    const expired = open && row.expiresAt.getTime() < Date.now();
    return {
      id: row.id,
      purpose: 'invoice' as const,
      invoiceIds: row.purposeIds,
      amount: toKobo(row.amount),
      currency: 'NGN' as const,
      provider: row.provider as 'paystack' | 'fake',
      reference: row.reference,
      status: (expired ? 'expired' : row.status) as z.infer<typeof paymentIntentStatusSchema>,
      authorizationUrl: open && !expired ? row.authorizationUrl : null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
    };
  }

  // ---- Webhooks and verification -------------------------------------------------------------

  /**
   * Stores a signed webhook (de-duplicated on its event id) and queues it for processing. Unsigned or
   * badly signed requests are rejected and never processed (AGENTS.md §6.3).
   */
  async receiveWebhook(
    provider: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ accepted: boolean; duplicate: boolean }> {
    if (provider !== this.gateway.provider)
      throw new NotFoundError('Unknown payment provider', 'PAYMENT_PROVIDER_UNKNOWN');
    if (!rawBody || !this.gateway.verifySignature(rawBody, headers))
      throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Invalid signature', 401);
    const event = this.gateway.parseWebhook(body);
    if (!event) throw new DomainError('WEBHOOK_PAYLOAD_INVALID', 'Unrecognised payload', 400);
    return this.db.withContext('payments', async (tx) => {
      const created = await tx.paymentWebhookEvent.createMany({
        data: [
          {
            provider,
            eventId: event.eventId,
            type: event.type,
            reference: event.reference,
            customerCode: event.customerCode,
            signatureValid: true,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) return { accepted: true, duplicate: true };
      await appendOutboxEvents(tx, [
        {
          type: 'payments.webhook.received',
          estateId: null,
          aggregateType: 'payment_webhook',
          aggregateId: `${provider}:${event.eventId}`,
          payload: {
            provider,
            eventId: event.eventId,
            type: event.type,
            reference: event.reference,
            customerCode: event.customerCode,
          },
        },
      ]);
      return { accepted: true, duplicate: false };
    });
  }

  /** Worker: processes a stored webhook event. */
  async processWebhookEvent(payload: {
    provider: string;
    eventId: string;
    type: string;
    reference: string | null;
  }): Promise<void> {
    let result: string;
    if (payload.type === 'charge.success' && payload.reference) {
      result = (await this.processReference(payload.reference)).outcome;
    } else if (
      (payload.type === 'refund.processed' || payload.type === 'refund.failed') &&
      payload.reference
    ) {
      result = await this.settleRefund(payload.reference, payload.type === 'refund.processed');
    } else {
      result = 'ignored';
    }
    await this.db.withContext('payments', (tx) =>
      tx.paymentWebhookEvent.updateMany({
        where: { provider: payload.provider, eventId: payload.eventId },
        data: { processedAt: new Date(), result },
      }),
    );
  }

  /**
   * Verifies a reference with the provider and, on success, records the transaction and allocates it to
   * invoices in one transaction (payments.md §5.1 step 4, §5.2). Safe to call any number of times.
   */
  async processReference(reference: string): Promise<ProcessResult> {
    let charge: VerifiedCharge;
    try {
      charge = await this.gateway.verify(reference);
    } catch (error) {
      if (error instanceof PaymentProviderError && !error.retryable)
        return { outcome: 'unknown_reference' };
      throw error;
    }
    // Saves the card when the payer opted in; never blocks the payment (ADR-0025).
    if (charge.status === 'success') await this.wallet.capture(charge);
    const routeKey =
      charge.customerCode && !reference.startsWith('sz_') ? charge.customerCode : reference;
    const route = await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.findUnique({
        where: { provider_routeKey: { provider: this.gateway.provider, routeKey } },
      }),
    );
    if (!route) {
      this.logger.warn({
        msg: 'payment reference with no route',
        kind: routeKey === reference ? 'reference' : 'customer',
      });
      return { outcome: 'unknown_reference' };
    }
    if (route.kind === 'ad_invoice') return this.processRoutedCharge('ad', null, charge);
    const estateId = route.estateId;
    if (!estateId) {
      this.logger.error({ msg: 'payment route without an estate', kind: route.kind });
      return { outcome: 'ignored' };
    }

    if (route.kind === 'platform_purchase')
      return this.processRoutedCharge('platform', estateId, charge);
    if (route.kind === 'marketplace_order')
      return this.processRoutedCharge('marketplace', estateId, charge);
    if (route.kind === 'transfer') {
      const outcome = await this.wallet.settleTransfer(estateId, charge);
      if (outcome === 'mismatch') {
        this.logger.error({ msg: 'transfer charge amount mismatch; refunded', estateId });
        await this.gateway.refund({
          transactionReference: reference,
          amountKobo: charge.amountKobo,
        });
      }
      return outcome === 'paid'
        ? { outcome: 'transfer_paid', estateId, reference }
        : outcome === 'pending'
          ? { outcome: 'pending' }
          : { outcome: 'failed' };
    }

    if (charge.status !== 'success') {
      if (
        route.kind === 'intent' &&
        (charge.status === 'failed' || charge.status === 'abandoned')
      ) {
        await this.db.withTenant({ estateId, userId: null }, (tx) =>
          tx.paymentIntent.updateMany({
            where: { estateId, reference, status: { in: ['created', 'pending'] } },
            data: { status: 'failed', failureReason: charge.status },
          }),
        );
        return { outcome: 'failed' };
      }
      return { outcome: 'pending' };
    }
    if (
      charge.currency !== 'NGN' ||
      !Number.isSafeInteger(charge.amountKobo) ||
      charge.amountKobo <= 0
    ) {
      this.logger.error({ msg: 'verified charge with unexpected currency or amount', estateId });
      return { outcome: 'ignored' };
    }

    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      let payerUserId: string;
      let spaceId: string | null = null;
      let intent: IntentRow | null = null;
      let virtualAccountId: string | null = null;
      if (route.kind === 'intent') {
        intent = await tx.paymentIntent.findFirst({ where: { estateId, reference } });
        if (!intent) return { outcome: 'unknown_reference' as const };
        payerUserId = intent.payerUserId;
      } else {
        const account = await tx.virtualAccount.findFirst({
          where: { estateId, provider: this.gateway.provider, customerCode: routeKey },
        });
        if (!account) return { outcome: 'unknown_reference' as const };
        payerUserId = account.payerUserId;
        spaceId = account.spaceId;
        virtualAccountId = account.id;
      }
      const transactionId = uuidv7();
      const inserted = await tx.paymentTransaction.createMany({
        data: [
          {
            id: transactionId,
            estateId,
            intentId: intent?.id ?? null,
            virtualAccountId,
            payerUserId,
            provider: this.gateway.provider,
            providerTransactionId: charge.providerTransactionId,
            reference,
            channel: charge.channel,
            amount: BigInt(charge.amountKobo),
            fees: BigInt(Math.max(0, charge.feesKobo)),
            paidAt: charge.paidAt ?? new Date(),
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return { outcome: 'duplicate' as const };

      const amountDiffers = intent !== null && toKobo(intent.amount) !== charge.amountKobo;
      if (intent) {
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: 'succeeded',
            paidAt: charge.paidAt ?? new Date(),
            failureReason: amountDiffers ? 'amount_differs' : null,
          },
        });
      }
      const allocation = await this.invoices.allocate(tx, estateId, {
        payerUserId,
        spaceId,
        invoiceIds: intent?.purposeIds ?? [],
        amount: charge.amountKobo,
        sourceType: 'payment',
        sourceId: transactionId,
        channel: this.gateway.provider,
        reference,
        postedBy: null,
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.transaction.succeeded',
          estateId,
          aggregateType: 'payment_transaction',
          aggregateId: transactionId,
          payload: {
            transactionId,
            intentId: intent?.id ?? null,
            amount: charge.amountKobo,
            allocated: charge.amountKobo - allocation.remainder,
            credit: allocation.remainder,
            amountDiffers,
          },
          audit: {
            actorType: 'provider_webhook',
            action: 'payments.transaction.record',
            resourceType: 'payment_transaction',
            resourceId: transactionId,
            after: { amount: charge.amountKobo, channel: charge.channel, amountDiffers },
          },
        },
      ]);
      await this.notifications.request(tx, {
        intent: 'billing.payment_received',
        userIds: [payerUserId],
        estateId,
        data: { amount: formatNaira(charge.amountKobo), transactionId },
        dedupeKey: `payment:${transactionId}`,
      });
      return { outcome: 'recorded' as const, estateId, transactionId };
    });
  }

  // ---- Virtual accounts (bank transfers) -----------------------------------------------------

  /** A dedicated account number for the household head of a unit (payments.md §3.3, §5.2). */
  async createVirtualAccount(access: EstateAccess, spaceId: string) {
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    if (!households.some((household) => household.spaceId === spaceId && household.isHead))
      throw new ForbiddenError(
        'Only the household head who pays this unit’s bills can get its transfer account',
        'VIRTUAL_ACCOUNT_NOT_PAYER',
      );
    const existing = await this.db.withTenant(access, (tx) =>
      tx.virtualAccount.findFirst({
        where: { estateId: access.estateId, spaceId, payerUserId: access.userId, status: 'active' },
      }),
    );
    if (existing) return this.virtualView(existing);
    const subaccountCode = await this.db.withTenant(access, (tx) =>
      this.activeSubaccount(tx, access.estateId),
    );
    const contact = (await this.users.contactsOf([access.userId])).get(access.userId);
    let created: Awaited<ReturnType<PaymentGateway['createDedicatedAccount']>>;
    try {
      created = await this.gateway.createDedicatedAccount({
        reference: `${access.estateId}:${spaceId}:${access.userId}`,
        fullName: contact?.fullName ?? 'Safezone Resident',
        phone: contact?.phone ?? '',
        email: `${access.userId}@payers.safezone.ng`,
        subaccountCode,
      });
    } catch (error) {
      throw this.providerError(error);
    }
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.virtualAccount.create({
        data: {
          estateId: access.estateId,
          spaceId,
          payerUserId: access.userId,
          provider: this.gateway.provider,
          customerCode: created.customerCode,
          accountNumber: created.accountNumber,
          bankName: created.bankName,
          accountName: created.accountName,
        },
      });
      await asModule(tx, 'payments', (inner) =>
        inner.paymentRoute.create({
          data: {
            provider: row.provider,
            routeKey: created.customerCode,
            kind: 'virtual_account',
            estateId: access.estateId,
          },
        }),
      );
      return this.virtualView(row);
    });
  }

  async virtualAccounts(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.virtualAccount.findMany({
          where: { estateId: access.estateId, payerUserId: access.userId, status: 'active' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => this.virtualView(row)),
    );
  }

  private virtualView(row: Prisma.VirtualAccountGetPayload<object>) {
    return {
      id: row.id,
      spaceId: row.spaceId,
      provider: row.provider as 'paystack' | 'fake',
      accountNumber: row.accountNumber,
      bankName: row.bankName,
      accountName: row.accountName,
      status: row.status as 'active' | 'inactive',
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Transactions --------------------------------------------------------------------------

  async transactions(access: EstateAccess, query: z.infer<typeof transactionListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof txCursorSchema> =>
            txCursorSchema.safeParse(value).success,
        )
      : undefined;
    const staff = isStaffWith(access, 'payment.reconcile');
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.paymentTransaction.findMany({
        where: {
          estateId: access.estateId,
          ...(staff
            ? query.payerUserId
              ? { payerUserId: query.payerUserId }
              : {}
            : { payerUserId: access.userId }),
          ...(after
            ? {
                OR: [
                  { paidAt: { lt: new Date(after.paidAt) } },
                  { paidAt: new Date(after.paidAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          intentId: row.intentId,
          provider: row.provider as 'paystack' | 'fake',
          channel: row.channel,
          amount: toKobo(row.amount),
          fees: toKobo(row.fees),
          status: (row.amountRefunded === 0n
            ? 'succeeded'
            : row.amountRefunded === row.amount
              ? 'refunded'
              : 'partially_refunded') as 'succeeded' | 'refunded' | 'partially_refunded',
          payerUserId: row.payerUserId,
          reference: row.reference,
          paidAt: row.paidAt.toISOString(),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ paidAt: last.paidAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  // ---- Manual payments -----------------------------------------------------------------------

  /** Cash, cheque, deposit or POS received at the estate office: recorded, then approved by someone else. */
  async recordManual(access: EstateAccess, input: z.infer<typeof createManualPaymentSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.manualPayment.create({
        data: {
          estateId: access.estateId,
          payerUserId: input.payerUserId,
          spaceId: input.spaceId ?? null,
          amount: BigInt(input.amount),
          method: input.method,
          receivedOn: parseDateOnly(input.receivedOn),
          reference: input.reference ?? null,
          evidenceFileId: input.evidenceFileId ?? null,
          note: input.note ?? null,
          recordedBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.manual_payment.recorded',
          estateId: access.estateId,
          aggregateType: 'manual_payment',
          aggregateId: row.id,
          payload: { manualPaymentId: row.id, amount: input.amount },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'payments.manual_payment.record',
            resourceType: 'manual_payment',
            resourceId: row.id,
            after: { amount: input.amount, method: input.method },
          },
        },
      ]);
      return this.manualView(row);
    });
  }

  async manualPayments(access: EstateAccess, query: z.infer<typeof manualPaymentListQuerySchema>) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.manualPayment.findMany({
          where: { estateId: access.estateId, ...(query.status ? { status: query.status } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      ).map((row) => this.manualView(row)),
    );
  }

  async decideManual(
    access: EstateAccess,
    id: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ) {
    return this.db.withTenant(access, async (tx) => {
      await tx.$queryRaw`select id from tenant.manual_payments where id = ${id}::uuid for update`;
      const row = await tx.manualPayment.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Manual payment not found', 'MANUAL_PAYMENT_NOT_FOUND');
      if (row.status !== 'pending')
        throw new ConflictError(
          'MANUAL_PAYMENT_NOT_PENDING',
          'This payment has already been decided',
        );
      if (row.recordedBy === access.userId)
        throw new ForbiddenError(
          'Someone other than the person who recorded it must decide this payment',
          'MANUAL_PAYMENT_SELF_APPROVAL',
        );
      const updated = await tx.manualPayment.update({
        where: { id },
        data: {
          status: decision === 'approve' ? 'approved' : 'rejected',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      if (decision === 'approve') {
        await this.invoices.allocate(tx, access.estateId, {
          payerUserId: row.payerUserId,
          spaceId: row.spaceId,
          amount: toKobo(row.amount),
          sourceType: 'manual_payment',
          sourceId: row.id,
          channel: row.method,
          reference: row.reference,
          postedBy: access.userId,
        });
        await this.notifications.request(tx, {
          intent: 'billing.payment_received',
          userIds: [row.payerUserId],
          estateId: access.estateId,
          data: { amount: formatNaira(toKobo(row.amount)), transactionId: row.id },
          dedupeKey: `manual-payment:${row.id}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type:
            decision === 'approve'
              ? 'payments.manual_payment.approved'
              : 'payments.manual_payment.rejected',
          estateId: access.estateId,
          aggregateType: 'manual_payment',
          aggregateId: id,
          payload: { manualPaymentId: id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: `payments.manual_payment.${decision}`,
            resourceType: 'manual_payment',
            resourceId: id,
            reason,
          },
        },
      ]);
      return this.manualView(updated);
    });
  }

  private manualView(row: ManualRow) {
    return {
      id: row.id,
      payerUserId: row.payerUserId,
      spaceId: row.spaceId,
      amount: toKobo(row.amount),
      method: row.method as 'cash' | 'cheque' | 'bank_deposit' | 'pos',
      receivedOn: dateOnly(row.receivedOn),
      reference: row.reference,
      evidenceFileId: row.evidenceFileId,
      note: row.note,
      status: row.status as 'pending' | 'approved' | 'rejected',
      recordedBy: row.recordedBy,
      decidedBy: row.decidedBy,
      decisionReason: row.decisionReason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Refunds -------------------------------------------------------------------------------

  /**
   * Refunds come out of the payer's unallocated credit (ADR-0013): money already applied to invoices is
   * first released by a credit note, so the ledger never goes out of balance.
   */
  async requestRefund(access: EstateAccess, input: z.infer<typeof createRefundSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const transaction = await tx.paymentTransaction.findFirst({
        where: { id: input.transactionId, estateId: access.estateId },
      });
      if (!transaction) throw new NotFoundError('Transaction not found', 'TRANSACTION_NOT_FOUND');
      await this.assertRefundable(tx, access.estateId, transaction, input.amount);
      const row = await tx.refund.create({
        data: {
          estateId: access.estateId,
          transactionId: transaction.id,
          amount: BigInt(input.amount),
          reason: input.reason,
          requestedBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.refund.requested',
          estateId: access.estateId,
          aggregateType: 'refund',
          aggregateId: row.id,
          payload: { refundId: row.id, amount: input.amount },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'payments.refund.request',
            resourceType: 'refund',
            resourceId: row.id,
            after: { amount: input.amount, transactionId: transaction.id },
            reason: input.reason,
          },
        },
      ]);
      return this.refundView(row);
    });
  }

  private async assertRefundable(
    tx: Tx,
    estateId: string,
    transaction: Prisma.PaymentTransactionGetPayload<object>,
    amount: number,
  ) {
    const pending = await tx.refund.aggregate({
      where: {
        transactionId: transaction.id,
        status: { in: ['pending', 'approved', 'processing'] },
      },
      _sum: { amount: true },
    });
    const committed = toKobo(transaction.amountRefunded) + toKobo(pending._sum.amount ?? 0n);
    if (amount > toKobo(transaction.amount) - committed)
      throw new DomainError(
        'REFUND_EXCEEDS_PAYMENT',
        'The refund is more than what is left of this payment',
        422,
      );
    const credit = await this.ledger.creditBalance(tx, estateId, transaction.payerUserId);
    if (amount > credit)
      throw new DomainError(
        'REFUND_EXCEEDS_CREDIT',
        'The payer’s unallocated credit is less than this refund. Issue a credit note first.',
        422,
      );
  }

  async refunds(access: EstateAccess, query: z.infer<typeof refundListQuerySchema>) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.refund.findMany({
          where: { estateId: access.estateId, ...(query.status ? { status: query.status } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      ).map((row) => this.refundView(row)),
    );
  }

  /** Approve (not by the requester) → ledger Dr credits / Cr cash → provider refund. Or reject. */
  async decideRefund(
    access: EstateAccess,
    id: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ) {
    const approved = await this.db.withTenant(access, async (tx) => {
      await tx.$queryRaw`select id from tenant.refunds where id = ${id}::uuid for update`;
      const row = await tx.refund.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Refund not found', 'REFUND_NOT_FOUND');
      if (row.status !== 'pending')
        throw new ConflictError('REFUND_NOT_PENDING', 'This refund has already been decided');
      if (row.requestedBy === access.userId)
        throw new ForbiddenError(
          'Someone other than the requester must decide this refund',
          'REFUND_SELF_APPROVAL',
        );
      if (decision === 'reject') {
        const updated = await tx.refund.update({
          where: { id },
          data: {
            status: 'rejected',
            decidedBy: access.userId,
            decidedAt: new Date(),
            decisionReason: reason,
          },
        });
        await this.refundEvent(tx, access, updated, 'rejected', reason);
        return null;
      }
      const transaction = await tx.paymentTransaction.findFirstOrThrow({
        where: { id: row.transactionId },
      });
      // Re-check without counting this refund as pending.
      const credit = await this.ledger.creditBalance(tx, access.estateId, transaction.payerUserId);
      if (toKobo(row.amount) > credit)
        throw new DomainError(
          'REFUND_EXCEEDS_CREDIT',
          'The payer’s unallocated credit is less than this refund. Issue a credit note first.',
          422,
        );
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'refund',
          description: `Refund to payer: ${row.reason}`,
          sourceType: 'refund',
          sourceId: row.id,
          reference: transaction.reference,
          postedBy: access.userId,
          lines: [
            {
              account: accounts.credits(transaction.payerUserId),
              debit: toKobo(row.amount),
              credit: 0,
            },
            { account: accounts.cash(transaction.provider), debit: 0, credit: toKobo(row.amount) },
          ],
        },
      ]);
      await tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: { amountRefunded: { increment: row.amount } },
      });
      const updated = await tx.refund.update({
        where: { id },
        data: {
          status: 'approved',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionReason: reason,
          journalId: journalId as string,
        },
      });
      await this.refundEvent(tx, access, updated, 'approved', reason);
      return { refund: updated, transaction };
    });
    if (!approved) return this.refundView(await this.loadRefund(access, id));

    try {
      const result = await this.gateway.refund({
        transactionReference: approved.transaction.reference,
        amountKobo: toKobo(approved.refund.amount),
      });
      await this.db.withTenant(access, async (tx) => {
        await tx.refund.update({
          where: { id },
          data: {
            providerRef: result.providerRef,
            status:
              result.status === 'completed'
                ? 'completed'
                : result.status === 'failed'
                  ? 'approved'
                  : 'processing',
            ...(result.status === 'completed' ? { completedAt: new Date() } : {}),
          },
        });
        await asModule(tx, 'payments', (inner) =>
          inner.paymentRoute.createMany({
            data: [
              {
                provider: this.gateway.provider,
                routeKey: approved.transaction.reference,
                kind: 'refund',
                estateId: access.estateId,
              },
            ],
            skipDuplicates: true,
          }),
        );
      });
    } catch (error) {
      // The ledger entry stands; the refund stays `approved` so operations can retry the provider call.
      this.logger.warn({
        msg: 'refund provider call failed',
        refundId: id,
        error: (error as Error).name,
      });
    }
    return this.refundView(await this.loadRefund(access, id));
  }

  /** Provider confirms or fails a refund; a failure reverses the ledger entry (money back to credit). */
  private async settleRefund(transactionReference: string, succeeded: boolean): Promise<string> {
    const route = await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.findUnique({
        where: {
          provider_routeKey: { provider: this.gateway.provider, routeKey: transactionReference },
        },
      }),
    );
    if (!route?.estateId) return 'unknown_reference';
    const routeEstateId = route.estateId;
    return this.db.withTenant({ estateId: routeEstateId, userId: null }, async (tx) => {
      const transaction = await tx.paymentTransaction.findFirst({
        where: { estateId: routeEstateId, reference: transactionReference },
      });
      if (!transaction) return 'unknown_reference';
      const refund = await tx.refund.findFirst({
        where: { transactionId: transaction.id, status: 'processing' },
        orderBy: { createdAt: 'asc' },
      });
      if (!refund) return 'ignored';
      if (succeeded) {
        await tx.refund.update({
          where: { id: refund.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        return 'processed';
      }
      await this.ledger.post(tx, routeEstateId, [
        {
          type: 'refund',
          description: 'Refund failed: returned to payer credit',
          sourceType: 'refund_reversal',
          sourceId: refund.id,
          reference: transaction.reference,
          postedBy: null,
          lines: [
            {
              account: accounts.cash(transaction.provider),
              debit: toKobo(refund.amount),
              credit: 0,
            },
            {
              account: accounts.credits(transaction.payerUserId),
              debit: 0,
              credit: toKobo(refund.amount),
            },
          ],
        },
      ]);
      await tx.refund.update({ where: { id: refund.id }, data: { status: 'failed' } });
      return 'processed';
    });
  }

  private async loadRefund(access: EstateAccess, id: string): Promise<RefundRow> {
    return this.db.withTenant(access, (tx) =>
      tx.refund.findFirstOrThrow({ where: { id, estateId: access.estateId } }),
    );
  }

  private async refundEvent(
    tx: Tx,
    access: EstateAccess,
    row: RefundRow,
    verb: 'approved' | 'rejected',
    reason: string | null,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `payments.refund.${verb}`,
        estateId: access.estateId,
        aggregateType: 'refund',
        aggregateId: row.id,
        payload: { refundId: row.id, amount: toKobo(row.amount) },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: `payments.refund.${verb === 'approved' ? 'approve' : 'reject'}`,
          resourceType: 'refund',
          resourceId: row.id,
          reason,
        },
      },
    ]);
  }

  private refundView(row: RefundRow) {
    return {
      id: row.id,
      transactionId: row.transactionId,
      amount: toKobo(row.amount),
      reason: row.reason,
      status: row.status as
        'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected',
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      providerRef: row.providerRef,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Platform charges (ADR-0018) --------------------------------------------------------------

  /**
   * Starts a checkout for a service Safezone sells on its own account (prepaid tokens): no estate
   * subaccount, so the money settles to Safezone, and the route kind keeps it away from estate ledgers.
   */
  async startPlatformCharge(input: {
    estateId: string;
    payerUserId: string;
    reference: string;
    amountKobo: number;
    /** Same allowlist as estate payments: the public site or the app's own scheme. */
    callbackUrl?: string;
    metadata: Record<string, string>;
    saveCard?: boolean;
    /** Pay with a saved card instead of checkout (ADR-0025); the caller then verifies the reference. */
    paymentMethodId?: string;
  }): Promise<{ authorizationUrl: string | null }> {
    const callbackUrl = this.callbackUrl(input.callbackUrl);
    await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.upsert({
        where: {
          provider_routeKey: { provider: this.gateway.provider, routeKey: input.reference },
        },
        create: {
          provider: this.gateway.provider,
          routeKey: input.reference,
          kind: 'platform_purchase',
          estateId: input.estateId,
        },
        update: {},
      }),
    );
    const metadata = checkoutMetadata(input.payerUserId, input.saveCard, input.metadata);
    if (input.paymentMethodId) {
      await this.chargeSaved({
        payerUserId: input.payerUserId,
        paymentMethodId: input.paymentMethodId,
        reference: input.reference,
        amountKobo: input.amountKobo,
        subaccountCode: null,
        metadata,
      });
      return { authorizationUrl: null };
    }
    try {
      const checkout = await this.gateway.initialize({
        reference: input.reference,
        amountKobo: input.amountKobo,
        email: `${input.payerUserId}@payers.safezone.ng`,
        subaccountCode: null,
        callbackUrl,
        metadata,
      });
      return { authorizationUrl: checkout.authorizationUrl };
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /** Full refund of a platform charge (vend failed). */
  async refundPlatformCharge(reference: string, amountKobo: number) {
    return this.gateway.refund({ transactionReference: reference, amountKobo });
  }

  get provider(): string {
    return this.gateway.provider;
  }

  // ---- Marketplace charges (ADR-0023) -----------------------------------------------------------

  /**
   * Starts a split checkout for a marketplace order: the vendor's subaccount receives the payment less
   * Safezone's commission, which the provider settles to Safezone as the transaction charge. Nothing is
   * pooled: the route kind keeps it away from estate ledgers and invoices.
   */
  async startMarketplaceCharge(input: {
    estateId: string;
    payerUserId: string;
    reference: string;
    amountKobo: number;
    commissionKobo: number;
    vendorSubaccountCode: string;
    callbackUrl?: string;
    metadata: Record<string, string>;
    saveCard?: boolean;
    paymentMethodId?: string;
  }): Promise<{ authorizationUrl: string | null }> {
    if (
      !Number.isSafeInteger(input.commissionKobo) ||
      input.commissionKobo < 0 ||
      input.commissionKobo >= input.amountKobo
    )
      throw new DomainError('INVALID_COMMISSION', 'Commission must be less than the amount', 422);
    const callbackUrl = this.callbackUrl(input.callbackUrl);
    await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.upsert({
        where: {
          provider_routeKey: { provider: this.gateway.provider, routeKey: input.reference },
        },
        create: {
          provider: this.gateway.provider,
          routeKey: input.reference,
          kind: 'marketplace_order',
          estateId: input.estateId,
        },
        update: {},
      }),
    );
    const metadata = checkoutMetadata(input.payerUserId, input.saveCard, input.metadata);
    if (input.paymentMethodId) {
      await this.chargeSaved({
        payerUserId: input.payerUserId,
        paymentMethodId: input.paymentMethodId,
        reference: input.reference,
        amountKobo: input.amountKobo,
        subaccountCode: input.vendorSubaccountCode,
        transactionChargeKobo: input.commissionKobo,
        metadata,
      });
      return { authorizationUrl: null };
    }
    try {
      const checkout = await this.gateway.initialize({
        reference: input.reference,
        amountKobo: input.amountKobo,
        email: `${input.payerUserId}@payers.safezone.ng`,
        subaccountCode: input.vendorSubaccountCode,
        transactionChargeKobo: input.commissionKobo,
        callbackUrl,
        metadata,
      });
      return { authorizationUrl: checkout.authorizationUrl };
    } catch (error) {
      throw this.providerError(error);
    }
  }

  // ---- Saved cards and transfers (ADR-0025) ----------------------------------------------------

  /**
   * Charges the payer's own saved card for a reference that already has its route. The result is never
   * trusted on its own: callers verify the reference (processReference) like any other payment.
   */
  async chargeSaved(input: {
    payerUserId: string;
    paymentMethodId: string;
    reference: string;
    amountKobo: number;
    subaccountCode: string | null;
    transactionChargeKobo?: number;
    metadata: Record<string, string>;
  }): Promise<'success' | 'failed' | 'pending'> {
    const authorizationCode = await this.wallet.authorizationFor(
      input.payerUserId,
      input.paymentMethodId,
    );
    try {
      const result = await this.gateway.chargeAuthorization({
        reference: input.reference,
        amountKobo: input.amountKobo,
        email: `${input.payerUserId}@payers.safezone.ng`,
        authorizationCode,
        subaccountCode: input.subaccountCode,
        ...(input.transactionChargeKobo
          ? { transactionChargeKobo: input.transactionChargeKobo }
          : {}),
        metadata: input.metadata,
      });
      if (result.status === 'failed')
        throw new DomainError(
          'SAVED_CARD_DECLINED',
          'Your bank declined this card. Try another way to pay.',
          402,
        );
      return result.status;
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /** Checkout (or saved card) for a transfer: settles in full to the recipient's subaccount, no commission. */
  async startTransferCharge(input: {
    estateId: string;
    payerUserId: string;
    reference: string;
    amountKobo: number;
    recipientSubaccountCode: string;
    callbackUrl?: string;
    metadata: Record<string, string>;
    saveCard?: boolean;
    paymentMethodId?: string;
  }): Promise<{ authorizationUrl: string | null }> {
    const callbackUrl = this.callbackUrl(input.callbackUrl);
    await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.upsert({
        where: {
          provider_routeKey: { provider: this.gateway.provider, routeKey: input.reference },
        },
        create: {
          provider: this.gateway.provider,
          routeKey: input.reference,
          kind: 'transfer',
          estateId: input.estateId,
        },
        update: {},
      }),
    );
    const metadata = checkoutMetadata(input.payerUserId, input.saveCard, input.metadata);
    if (input.paymentMethodId) {
      await this.chargeSaved({
        payerUserId: input.payerUserId,
        paymentMethodId: input.paymentMethodId,
        reference: input.reference,
        amountKobo: input.amountKobo,
        subaccountCode: input.recipientSubaccountCode,
        metadata,
      });
      return { authorizationUrl: null };
    }
    try {
      const checkout = await this.gateway.initialize({
        reference: input.reference,
        amountKobo: input.amountKobo,
        email: `${input.payerUserId}@payers.safezone.ng`,
        subaccountCode: input.recipientSubaccountCode,
        callbackUrl,
        metadata,
      });
      return { authorizationUrl: checkout.authorizationUrl };
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /** Refund of (part of) a marketplace charge: cancellation after payment or a dispute decision. */
  async refundMarketplaceCharge(reference: string, amountKobo: number) {
    try {
      return await this.gateway.refund({ transactionReference: reference, amountKobo });
    } catch (error) {
      throw this.providerError(error);
    }
  }

  // ---- Ad invoices (ADR-0024) -------------------------------------------------------------------

  /** Checkout for an advertising invoice on Safezone's own account (all ad revenue is Safezone's). */
  async startAdCharge(input: {
    payerUserId: string;
    reference: string;
    amountKobo: number;
    callbackUrl?: string;
    metadata: Record<string, string>;
  }): Promise<{ authorizationUrl: string }> {
    const callbackUrl = this.callbackUrl(input.callbackUrl);
    await this.db.withContext('payments', (tx) =>
      tx.paymentRoute.upsert({
        where: {
          provider_routeKey: { provider: this.gateway.provider, routeKey: input.reference },
        },
        create: {
          provider: this.gateway.provider,
          routeKey: input.reference,
          kind: 'ad_invoice',
          estateId: null,
        },
        update: {},
      }),
    );
    try {
      const checkout = await this.gateway.initialize({
        reference: input.reference,
        amountKobo: input.amountKobo,
        email: `${input.payerUserId}@payers.safezone.ng`,
        subaccountCode: null,
        callbackUrl,
        metadata: input.metadata,
      });
      return { authorizationUrl: checkout.authorizationUrl };
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /**
   * Links a vendor's bank account through a provider subaccount (marketplace.md §2.4). The account
   * number goes to the provider only; the caller keeps its last 4 digits.
   */
  async linkVendorPayout(input: { businessName: string; bankCode: string; accountNumber: string }) {
    try {
      const resolved = await this.gateway.resolveAccount(input.bankCode, input.accountNumber);
      const subaccount = await this.gateway.createSubaccount(input);
      return {
        provider: this.gateway.provider,
        subaccountCode: subaccount.subaccountCode,
        bankName: resolved.bankName,
        accountName: resolved.accountName,
        accountLast4: last4(input.accountNumber),
      };
    } catch (error) {
      throw this.providerError(error);
    }
  }

  /** Verification result of a platform or marketplace charge, announced as an event for its owner. */
  private async processRoutedCharge(
    kind: 'platform' | 'marketplace' | 'ad',
    estateId: string | null,
    charge: VerifiedCharge,
  ): Promise<ProcessResult> {
    if (charge.status === 'pending') return { outcome: 'pending' };
    const succeeded =
      charge.status === 'success' &&
      charge.currency === 'NGN' &&
      Number.isSafeInteger(charge.amountKobo) &&
      charge.amountKobo > 0;
    const write = (fn: (tx: Tx) => Promise<void>) =>
      estateId
        ? this.db.withTenant({ estateId, userId: null }, fn)
        : this.db.withContext('payments', fn);
    await write((tx) =>
      appendOutboxEvents(tx, [
        {
          type: `payments.${kind}_charge.${succeeded ? 'succeeded' : 'failed'}`,
          estateId,
          aggregateType: `${kind}_charge`,
          aggregateId: charge.reference,
          payload: {
            reference: charge.reference,
            amountKobo: charge.amountKobo,
            providerTransactionId: charge.providerTransactionId,
          },
        },
      ]),
    );
    if (!succeeded) return { outcome: 'failed' };
    if (kind === 'ad' || !estateId)
      return {
        outcome: 'ad_paid',
        reference: charge.reference,
        amountKobo: charge.amountKobo,
        providerTransactionId: charge.providerTransactionId,
      };
    return {
      outcome: kind === 'platform' ? 'platform_paid' : 'marketplace_paid',
      estateId,
      reference: charge.reference,
      amountKobo: charge.amountKobo,
      providerTransactionId: charge.providerTransactionId,
    };
  }

  private providerError(error: unknown): DomainError {
    if (error instanceof PaymentProviderError) {
      return error.retryable
        ? new DomainError(
            'PAYMENT_PROVIDER_UNAVAILABLE',
            'The payment provider is not responding. Try again shortly.',
            502,
          )
        : new DomainError(
            'PAYMENT_PROVIDER_REJECTED',
            'The payment provider could not complete this request',
            422,
          );
    }
    if (error instanceof DomainError) return error;
    throw error;
  }
}
