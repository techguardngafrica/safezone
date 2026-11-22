import { Inject, Injectable } from '@nestjs/common';
import type { createTransferSchema, moneyTransferListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { UserDirectory } from '../identity/user-directory.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { PaymentsService } from './payments.service';
import { WalletStore } from './wallet-store.service';

type TransferRow = Prisma.TransferGetPayload<object>;
const cursorSchema = z.object({ createdAt: z.string(), id: z.uuid() });
const isCursor = (value: unknown): value is z.infer<typeof cursorSchema> =>
  cursorSchema.safeParse(value).success;

export function firstName(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Neighbour';
}

/**
 * Transfers between residents of one estate (ADR-0025): each is a provider charge that settles in full to
 * the recipient's own subaccount. Safezone holds nothing and takes no commission.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly payments: PaymentsService,
    private readonly wallet: WalletStore,
    private readonly tenancy: TenancyService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly users: UserDirectory,
  ) {}

  get enabled(): boolean {
    if (this.env.PAY_TRANSFERS_ENABLED) return this.env.PAY_TRANSFERS_ENABLED === 'true';
    return this.env.NODE_ENV === 'development' || this.env.NODE_ENV === 'test';
  }

  private assertEnabled() {
    if (!this.enabled)
      throw new DomainError(
        'TRANSFERS_UNAVAILABLE',
        'Sending money to neighbours is not available yet',
        503,
      );
  }

  /** People in a unit who accept transfers: first names only, never the caller themself. */
  async recipients(access: EstateAccess, unitCode: string) {
    this.assertEnabled();
    const userIds = await this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unitByCode(tx, access.estateId, unitCode);
      if (!unit) return [];
      return this.occupancy.residentUserIdsInUnits(tx, access.estateId, [unit.id]);
    });
    const others = userIds.filter((id) => id !== access.userId);
    const receivers = await this.wallet.receivers(others);
    const names = await this.users.contactsOf([...receivers.keys()]);
    return [...receivers.keys()].map((userId) => ({
      userId,
      firstName: firstName(names.get(userId)?.fullName),
    }));
  }

  async create(
    access: EstateAccess,
    input: z.infer<typeof createTransferSchema>,
    idempotencyKey: string,
  ) {
    this.assertEnabled();
    if (input.recipientUserId === access.userId)
      throw new DomainError('TRANSFER_TO_SELF', 'You cannot send money to yourself', 422);
    const existing = await this.db.withTenant(access, (tx) =>
      tx.transfer.findUnique({
        where: {
          estateId_senderUserId_idempotencyKey: {
            estateId: access.estateId,
            senderUserId: access.userId,
            idempotencyKey,
          },
        },
      }),
    );
    if (existing) return this.view(existing, access.userId);

    // The recipient must be an active member of this estate and accept transfers.
    const member = await this.tenancy.activeMembership(input.recipientUserId, access.estateId);
    const subaccount = (await this.wallet.receivers([input.recipientUserId])).get(
      input.recipientUserId,
    );
    if (!member || !subaccount)
      throw new NotFoundError(
        'This person cannot receive money in the app',
        'RECIPIENT_UNAVAILABLE',
      );

    const reference = `sz_tr_${uuidv7().replaceAll('-', '')}`;
    const row = await this.db.withTenant(access, async (tx) => {
      if (input.classifiedId) {
        const listing = await tx.classifiedListing.findFirst({
          where: { id: input.classifiedId, estateId: access.estateId },
          select: { sellerUserId: true },
        });
        if (!listing || listing.sellerUserId !== input.recipientUserId)
          throw new ForbiddenError('That listing is not from this person', 'CLASSIFIED_MISMATCH');
      }
      return tx.transfer.create({
        data: {
          estateId: access.estateId,
          senderUserId: access.userId,
          recipientUserId: input.recipientUserId,
          recipientSubaccountCode: subaccount,
          amount: BigInt(input.amountKobo),
          note: input.note ?? null,
          classifiedId: input.classifiedId ?? null,
          reference,
          idempotencyKey,
        },
      });
    });

    let authorizationUrl: string | null = null;
    try {
      const checkout = await this.payments.startTransferCharge({
        estateId: access.estateId,
        payerUserId: access.userId,
        reference,
        amountKobo: input.amountKobo,
        recipientSubaccountCode: subaccount,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
        metadata: { purpose: 'transfer', transferId: row.id },
        ...(input.saveCard ? { saveCard: true } : {}),
        ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
      });
      authorizationUrl = checkout.authorizationUrl;
    } catch (error) {
      await this.db.withTenant(access, (tx) =>
        tx.transfer.update({ where: { id: row.id }, data: { status: 'failed' } }),
      );
      throw error;
    }
    if (authorizationUrl) {
      await this.db.withTenant(access, (tx) =>
        tx.transfer.update({ where: { id: row.id }, data: { authorizationUrl } }),
      );
    } else {
      // Saved card: verify now, exactly as after checkout.
      await this.payments.processReference(reference);
    }
    return this.get(access, row.id);
  }

  async get(access: EstateAccess, id: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.transfer.findFirst({
        where: {
          id,
          estateId: access.estateId,
          OR: [{ senderUserId: access.userId }, { recipientUserId: access.userId, status: 'paid' }],
        },
      }),
    );
    if (!row) throw new NotFoundError('Transfer not found', 'TRANSFER_NOT_FOUND');
    return this.view(row, access.userId);
  }

  /** The sender back from checkout: ask the provider now. */
  async verify(access: EstateAccess, id: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.transfer.findFirst({
        where: { id, estateId: access.estateId, senderUserId: access.userId },
      }),
    );
    if (!row) throw new NotFoundError('Transfer not found', 'TRANSFER_NOT_FOUND');
    if (row.status === 'created') await this.payments.processReference(row.reference);
    return this.get(access, id);
  }

  async list(access: EstateAccess, query: z.infer<typeof moneyTransferListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isCursor) : null;
    const rows = await this.db.withTenant(access, (tx) =>
      tx.transfer.findMany({
        where: {
          estateId: access.estateId,
          AND: [
            {
              OR: [
                { senderUserId: access.userId },
                { recipientUserId: access.userId, status: 'paid' },
              ],
            },
            ...(after
              ? [
                  {
                    OR: [
                      { createdAt: { lt: new Date(after.createdAt) } },
                      { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const names = await this.users.contactsOf([
      ...new Set(page.flatMap((r) => [r.senderUserId, r.recipientUserId])),
    ]);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.shape(row, access.userId, names)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async view(row: TransferRow, userId: string) {
    const names = await this.users.contactsOf([row.senderUserId, row.recipientUserId]);
    return this.shape(row, userId, names);
  }

  private shape(row: TransferRow, userId: string, names: Map<string, { fullName: string | null }>) {
    const sent = row.senderUserId === userId;
    return {
      id: row.id,
      direction: sent ? ('sent' as const) : ('received' as const),
      counterpartyFirstName: firstName(
        names.get(sent ? row.recipientUserId : row.senderUserId)?.fullName,
      ),
      amountKobo: Number(row.amount),
      note: row.note,
      status: row.status as 'created' | 'paid' | 'failed',
      authorizationUrl: sent && row.status === 'created' ? row.authorizationUrl : null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
