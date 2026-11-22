import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { KeyVault } from '../../integrations/keys/key-vault';
import {
  PaymentGateway,
  PaymentProviderError,
  type VerifiedCharge,
} from '../../integrations/payments/payment-gateway';
import { NotificationsService } from '../notifications/notifications.service';

type MethodRow = Prisma.PaymentMethodGetPayload<object>;
type PayoutRow = Prisma.UserPayoutAccountGetPayload<object>;

/** Metadata keys a checkout carries so a verified card can be saved for its payer (ADR-0025). */
export const SAVE_CARD_KEY = 'save_card';
export const PAYER_KEY = 'payer';

export function checkoutMetadata(
  payerUserId: string,
  saveCard: boolean | undefined,
  base: Record<string, string>,
): Record<string, string> {
  return { ...base, [PAYER_KEY]: payerUserId, ...(saveCard ? { [SAVE_CARD_KEY]: '1' } : {}) };
}

/**
 * Saved cards, resident payout accounts and transfer settlement (ADR-0025). No stored balance: cards are
 * provider authorizations (wrapped), payout accounts are provider subaccounts.
 */
@Injectable()
export class WalletStore {
  private readonly logger = new Logger('WalletStore');

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: PaymentGateway,
    private readonly vault: KeyVault,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Saved cards ---------------------------------------------------------------------------

  /**
   * Saves the card of a verified successful charge when its payer opted in. Never throws: saving a card
   * must not break the payment it came with.
   */
  async capture(charge: VerifiedCharge): Promise<void> {
    try {
      const auth = charge.authorization;
      const payer = charge.metadata[PAYER_KEY];
      if (charge.status !== 'success' || charge.metadata[SAVE_CARD_KEY] !== '1') return;
      if (!auth?.reusable || !payer || !/^[0-9a-f-]{36}$/i.test(payer)) return;
      await this.db.withContext('payments', async (tx) => {
        const existing = await tx.paymentMethod.findFirst({
          where: {
            userId: payer,
            provider: this.gateway.provider,
            signature: auth.signature,
            removedAt: null,
          },
        });
        if (existing) {
          await tx.paymentMethod.update({
            where: { id: existing.id },
            data: {
              authorizationWrapped: this.vault.wrap(Buffer.from(auth.code, 'utf8')),
              expMonth: auth.expMonth,
              expYear: auth.expYear,
            },
          });
          return;
        }
        const row = await tx.paymentMethod.create({
          data: {
            userId: payer,
            provider: this.gateway.provider,
            authorizationWrapped: this.vault.wrap(Buffer.from(auth.code, 'utf8')),
            signature: auth.signature,
            brand: auth.brand.slice(0, 40),
            last4: auth.last4.slice(-4),
            expMonth: auth.expMonth,
            expYear: auth.expYear,
            bank: auth.bank,
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'payments.payment_method.saved',
            estateId: null,
            aggregateType: 'payment_method',
            aggregateId: row.id,
            payload: { paymentMethodId: row.id },
            audit: {
              actorType: 'user',
              actorId: payer,
              action: 'payments.payment_method.save',
              resourceType: 'payment_method',
              resourceId: row.id,
              after: { brand: row.brand, last4: row.last4 },
            },
          },
        ]);
      });
    } catch (error) {
      this.logger.error({ msg: 'could not save card', error: (error as Error).name });
    }
  }

  async methods(userId: string) {
    const rows = await this.db.withUser(userId, (tx) =>
      tx.paymentMethod.findMany({
        where: { userId, removedAt: null },
        orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
    );
    return rows.map(methodView);
  }

  async removeMethod(userId: string, id: string) {
    await this.db.withUser(userId, async (tx) => {
      const row = await tx.paymentMethod.findFirst({ where: { id, userId, removedAt: null } });
      if (!row) throw new NotFoundError('Card not found', 'PAYMENT_METHOD_NOT_FOUND');
      await tx.paymentMethod.update({ where: { id }, data: { removedAt: new Date() } });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.payment_method.removed',
          estateId: null,
          aggregateType: 'payment_method',
          aggregateId: id,
          payload: { paymentMethodId: id },
          audit: {
            actorType: 'user',
            actorId: userId,
            action: 'payments.payment_method.remove',
            resourceType: 'payment_method',
            resourceId: id,
            before: { brand: row.brand, last4: row.last4 },
          },
        },
      ]);
    });
    return this.methods(userId);
  }

  /** The authorization code of the user's own saved card, for one charge. */
  async authorizationFor(userId: string, id: string): Promise<string> {
    const row = await this.db.withUser(userId, async (tx) => {
      const found = await tx.paymentMethod.findFirst({ where: { id, userId, removedAt: null } });
      if (found) await tx.paymentMethod.update({ where: { id }, data: { lastUsedAt: new Date() } });
      return found;
    });
    if (!row) throw new NotFoundError('Card not found', 'PAYMENT_METHOD_NOT_FOUND');
    if (row.provider !== this.gateway.provider)
      throw new DomainError(
        'PAYMENT_METHOD_UNAVAILABLE',
        'This card cannot be used right now',
        409,
      );
    return this.vault.unwrap(row.authorizationWrapped).toString('utf8');
  }

  // ---- Resident payout accounts --------------------------------------------------------------

  async payoutAccount(userId: string) {
    const row = await this.db.withUser(userId, (tx) =>
      tx.userPayoutAccount.findFirst({ where: { userId, status: 'active' } }),
    );
    return row ? payoutView(row) : null;
  }

  /** Bank details go to the provider; we keep the subaccount, bank name and last four digits. */
  async linkPayout(userId: string, displayName: string, bankCode: string, accountNumber: string) {
    let resolved: { accountName: string; bankName: string };
    let subaccount: { subaccountCode: string };
    try {
      resolved = await this.gateway.resolveAccount(bankCode, accountNumber);
      subaccount = await this.gateway.createSubaccount({
        businessName: displayName,
        bankCode,
        accountNumber,
      });
    } catch (error) {
      if (error instanceof PaymentProviderError)
        throw new DomainError(
          error.retryable ? 'PAYMENT_PROVIDER_UNAVAILABLE' : 'PAYMENT_PROVIDER_REJECTED',
          error.retryable
            ? 'The payment provider is not responding. Try again shortly.'
            : 'The bank account could not be verified',
          error.retryable ? 502 : 422,
        );
      throw error;
    }
    const row = await this.db.withUser(userId, async (tx) => {
      const previous = await tx.userPayoutAccount.findFirst({
        where: { userId, status: 'active' },
      });
      if (previous)
        await tx.userPayoutAccount.update({
          where: { id: previous.id },
          data: { status: 'disabled', disabledAt: new Date() },
        });
      const created = await tx.userPayoutAccount.create({
        data: {
          userId,
          provider: this.gateway.provider,
          subaccountCode: subaccount.subaccountCode,
          bankName: resolved.bankName,
          accountLast4: accountNumber.slice(-4),
          acceptTransfers: previous?.acceptTransfers ?? true,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.user_payout_account.linked',
          estateId: null,
          aggregateType: 'user_payout_account',
          aggregateId: created.id,
          payload: { payoutAccountId: created.id },
          audit: {
            actorType: 'user',
            actorId: userId,
            action: 'payments.user_payout_account.link',
            resourceType: 'user_payout_account',
            resourceId: created.id,
            before: previous
              ? { bankName: previous.bankName, accountLast4: previous.accountLast4 }
              : undefined,
            after: { bankName: created.bankName, accountLast4: created.accountLast4 },
          },
        },
      ]);
      return created;
    });
    return payoutView(row);
  }

  async setAcceptTransfers(userId: string, accept: boolean) {
    const row = await this.db.withUser(userId, async (tx) => {
      const current = await tx.userPayoutAccount.findFirst({ where: { userId, status: 'active' } });
      if (!current)
        throw new NotFoundError('Link a payout account first', 'PAYOUT_ACCOUNT_REQUIRED');
      return tx.userPayoutAccount.update({
        where: { id: current.id },
        data: { acceptTransfers: accept },
      });
    });
    return payoutView(row);
  }

  /** Active payout accounts that accept transfers, for these users (recipient lookup). */
  async receivers(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.withContext('payments', (tx) =>
      tx.userPayoutAccount.findMany({
        where: {
          userId: { in: [...userIds] },
          status: 'active',
          acceptTransfers: true,
          provider: this.gateway.provider,
        },
        select: { userId: true, subaccountCode: true },
      }),
    );
    return new Map(rows.map((r) => [r.userId, r.subaccountCode]));
  }

  // ---- Transfer settlement (called from verification) ----------------------------------------

  /** Marks a verified transfer paid (or failed); idempotent. Returns true when the charge was a mismatch. */
  async settleTransfer(
    estateId: string,
    charge: VerifiedCharge,
  ): Promise<'paid' | 'failed' | 'pending' | 'mismatch' | 'unknown'> {
    if (charge.status === 'pending') return 'pending';
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.transfer.findUnique({ where: { reference: charge.reference } });
      if (!row) return 'unknown' as const;
      if (row.status !== 'created')
        return row.status === 'paid' ? ('paid' as const) : ('failed' as const);
      if (charge.status !== 'success') {
        await tx.transfer.update({ where: { id: row.id }, data: { status: 'failed' } });
        return 'failed' as const;
      }
      if (charge.currency !== 'NGN' || charge.amountKobo !== Number(row.amount)) {
        await tx.transfer.update({ where: { id: row.id }, data: { status: 'failed' } });
        return 'mismatch' as const;
      }
      await tx.transfer.update({
        where: { id: row.id },
        data: { status: 'paid', paidAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'payments.transfer.paid',
          estateId,
          aggregateType: 'transfer',
          aggregateId: row.id,
          payload: { transferId: row.id, amountKobo: Number(row.amount) },
          audit: {
            actorType: 'provider_webhook',
            action: 'payments.transfer.pay',
            resourceType: 'transfer',
            resourceId: row.id,
            after: { amountKobo: Number(row.amount) },
          },
        },
      ]);
      await this.notifications.request(tx, {
        intent: 'payments.transfer_received',
        userIds: [row.recipientUserId],
        estateId,
        data: { amount: (Number(row.amount) / 100).toLocaleString('en-NG'), transferId: row.id },
        dedupeKey: `transfer:${row.id}:paid`,
      });
      return 'paid' as const;
    });
  }
}

function methodView(row: MethodRow) {
  return {
    id: row.id,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.expMonth,
    expYear: row.expYear,
    bank: row.bank,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function payoutView(row: PayoutRow) {
  return {
    bankName: row.bankName,
    accountLast4: row.accountLast4,
    acceptTransfers: row.acceptTransfers,
    createdAt: row.createdAt.toISOString(),
  };
}
