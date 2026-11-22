import { Controller, Get } from '@nestjs/common';
import {
  platformTransactionListQuerySchema,
  platformTransactionSchema,
  type PlatformTransactionStatus,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { Can } from '../../common/auth/auth.decorators';
import { Contract, ValidQuery } from '../../common/contract/contract';
import { DatabaseService } from '../../common/database/database.service';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { TenancyService } from '../tenancy/tenancy.service';

const cursorSchema = z.object({ id: z.uuid() });
const isIdCursor = (value: unknown): value is { id: string } =>
  cursorSchema.safeParse(value).success;

/** Cross-estate payment monitoring for Platform Finance Officers (super-admin.md §6.7, ADR-0022). */
@Controller('v1/platform/transactions')
export class PlatformTransactionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
  ) {}

  @Get()
  @Can('platform.finance')
  @Contract({
    summary: 'Cross-estate payment transactions (newest first, no resident PII)',
    tags: ['platform'],
    query: platformTransactionListQuerySchema,
    response: platformTransactionSchema,
    paginated: true,
  })
  async list(@ValidQuery() query: z.infer<typeof platformTransactionListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isIdCursor) : null;
    const rows = await this.db.withContext('platform_finance', (tx) => {
      // Status is derived from amount_refunded vs amount, so filter in SQL (before paging) using a
      // column reference; filtering the page in memory returned empty pages with a next cursor.
      const amount = tx.paymentTransaction.fields.amount;
      const statusWhere: Prisma.PaymentTransactionWhereInput =
        query.status === 'succeeded'
          ? { amountRefunded: 0n }
          : query.status === 'partially_refunded'
            ? { AND: [{ amountRefunded: { gt: 0n } }, { amountRefunded: { lt: amount } }] }
            : query.status === 'refunded'
              ? { amountRefunded: { gt: 0n, gte: amount } }
              : {};
      return tx.paymentTransaction.findMany({
        where: {
          ...(query.estateId ? { estateId: query.estateId } : {}),
          ...(query.provider ? { provider: query.provider } : {}),
          ...(after ? { id: { lt: after.id } } : {}),
          ...statusWhere,
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const estateNames = await this.tenancy.estateNamesByIds(page.map((row) => row.estateId));
    const items = page.map((row) => {
      const status: PlatformTransactionStatus =
        row.amountRefunded > 0n
          ? row.amountRefunded >= row.amount
            ? 'refunded'
            : 'partially_refunded'
          : 'succeeded';
      return {
        id: row.id,
        estateId: row.estateId,
        estateName: estateNames.get(row.estateId) ?? null,
        reference: row.reference,
        provider: row.provider,
        channel: row.channel,
        status,
        amountKobo: Number(row.amount),
        currency: 'NGN',
        paidAt: row.paidAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }
}
