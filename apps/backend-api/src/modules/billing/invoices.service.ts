import { Injectable } from '@nestjs/common';
import type {
  createCreditNoteSchema,
  createInvoiceSchema,
  createWaiverSchema,
  invoiceListQuerySchema,
  statementQuerySchema,
  waiverListQuerySchema,
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
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents, type OutboxEventInput } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  accounts,
  allocateOldestFirst,
  canReduceBy,
  dateOnly,
  deriveInvoiceStatus,
  displayInvoiceStatus,
  formatInvoiceNumber,
  invoiceJournal,
  parseDateOnly,
  sum,
  todayInLagos,
  toKobo,
  waiverNeedsSecondApprover,
} from './domain/billing';
import { LedgerService } from './ledger.service';

type InvoiceRow = Prisma.InvoiceGetPayload<object>;
const invoiceCursorSchema = z.object({ issueDate: z.iso.date(), number: z.string() });

export interface NewInvoice {
  spaceId: string;
  unitCode: string;
  householdId: string | null;
  payerUserId: string;
  payerType: 'occupant' | 'owner';
  billingRunId: string | null;
  penaltyForInvoiceId?: string | null;
  description: string;
  issueDate: string;
  dueDate: string;
  createdBy: string | null;
  lines: readonly {
    chargeId: string | null;
    chargeType: string;
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
  }[];
}

export interface AllocationInput {
  payerUserId: string;
  /** Allocate only to this unit's invoices; otherwise every open invoice of the payer. */
  spaceId?: string | null;
  /** Specific invoices to pay first (checkout for chosen invoices); the rest goes oldest first. */
  invoiceIds?: readonly string[];
  amount: number;
  sourceType: 'payment' | 'manual_payment' | 'credit';
  sourceId: string;
  /** Cash account channel, e.g. paystack, flutterwave, bank_transfer, cash. */
  channel: string;
  reference?: string | null;
  postedBy: string | null;
}

export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Invoices, credit notes, waivers and allocation (billing.md). Issued invoice terms never change
 * (enforced by a trigger); every money movement posts a balanced journal in the same transaction.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Issuing (also used by billing runs) ---------------------------------------------------

  /**
   * Issues invoices in the caller's transaction: numbers from the estate sequence, lines, one journal
   * each (Dr receivable / Cr income), events and payer notifications. Returns the invoice ids.
   */
  async issue(tx: Tx, estateId: string, invoices: readonly NewInvoice[]): Promise<string[]> {
    if (invoices.length === 0) return [];
    const first = await this.reserveNumbers(tx, estateId, invoices.length);
    const rows = invoices.map((invoice, index) => {
      const total = sum(invoice.lines.map((line) => line.amount));
      return { id: uuidv7(), number: formatInvoiceNumber(first + index), total, invoice };
    });
    await tx.invoice.createMany({
      data: rows.map(({ id, number, total, invoice }) => ({
        id,
        estateId,
        number,
        spaceId: invoice.spaceId,
        householdId: invoice.householdId,
        payerUserId: invoice.payerUserId,
        payerType: invoice.payerType,
        billingRunId: invoice.billingRunId,
        penaltyForInvoiceId: invoice.penaltyForInvoiceId ?? null,
        description: invoice.description,
        issueDate: parseDateOnly(invoice.issueDate),
        dueDate: parseDateOnly(invoice.dueDate),
        subtotal: BigInt(total),
        total: BigInt(total),
        balance: BigInt(total),
        status: total === 0 ? 'paid' : 'issued',
        createdBy: invoice.createdBy,
      })),
    });
    await tx.invoiceLine.createMany({
      data: rows.flatMap(({ id, invoice }) =>
        invoice.lines.map((line, position) => ({
          estateId,
          invoiceId: id,
          chargeId: line.chargeId,
          chargeType: line.chargeType,
          description: line.description,
          quantity: line.quantity,
          unitAmount: BigInt(line.unitAmount),
          amount: BigInt(line.amount),
          position,
        })),
      ),
    });
    await this.ledger.post(
      tx,
      estateId,
      rows
        .filter((row) => row.total > 0)
        .map(({ id, number, invoice }) => ({
          type: 'invoice' as const,
          description: `Invoice ${number}: ${invoice.description}`,
          sourceType: 'invoice',
          sourceId: id,
          reference: number,
          postedBy: invoice.createdBy,
          lines: invoiceJournal(
            accounts.receivable(invoice.payerUserId, invoice.spaceId, invoice.unitCode),
            invoice.lines,
          ),
        })),
    );
    const events: OutboxEventInput[] = rows.map(({ id, number, total, invoice }) => ({
      type: 'billing.invoice.issued',
      estateId,
      aggregateType: 'invoice',
      aggregateId: id,
      payload: {
        invoiceId: id,
        number,
        spaceId: invoice.spaceId,
        payerUserId: invoice.payerUserId,
        total,
        dueDate: invoice.dueDate,
        billingRunId: invoice.billingRunId,
      },
    }));
    await appendOutboxEvents(tx, events);
    for (const { id, number, total, invoice } of rows) {
      if (total === 0) continue;
      await this.notifications.request(tx, {
        intent: 'billing.invoice_issued',
        userIds: [invoice.payerUserId],
        estateId,
        data: { number, amount: formatNaira(total), dueDate: invoice.dueDate, invoiceId: id },
        dedupeKey: `invoice:${id}`,
      });
    }
    return rows.map((row) => row.id);
  }

  private async reserveNumbers(tx: Tx, estateId: string, count: number): Promise<number> {
    const rows = await tx.$queryRaw<{ next: number }[]>`
      insert into tenant.invoice_counters (estate_id, next) values (${estateId}::uuid, ${count + 1})
      on conflict (estate_id) do update set next = tenant.invoice_counters.next + ${count}
      returning next`;
    const next = rows[0]?.next;
    if (next === undefined) throw new Error('Invoice counter not returned');
    return next - count;
  }

  /** A one-off invoice for a unit's current occupant (billing.md §2.4). */
  async createOneOff(access: EstateAccess, input: z.infer<typeof createInvoiceSchema>) {
    return this.db.withTenant(access, (tx) => this.createOneOffIn(tx, access, input));
  }

  /**
   * The same one-off invoice inside the caller's transaction, so an import can record its idempotency
   * key atomically with the invoice (tenancy.md §7.8).
   */
  async createOneOffIn(tx: Tx, access: EstateAccess, input: z.infer<typeof createInvoiceSchema>) {
    const today = todayInLagos();
    if (input.dueDate < today)
      throw new DomainError('INVOICE_DUE_DATE_PAST', 'The due date cannot be in the past', 422);
    const unit = await this.property.unit(tx, access.estateId, input.spaceId);
    if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
    const occupant = (await this.occupancy.billingOccupants(tx, access.estateId, [unit.id])).get(
      unit.id,
    );
    if (!occupant)
      throw new DomainError('INVOICE_NO_PAYER', 'This unit has no active household to bill', 422);
    const chargeIds = input.lines.flatMap((line) => (line.chargeId ? [line.chargeId] : []));
    const charges = await tx.charge.findMany({
      where: { estateId: access.estateId, id: { in: chargeIds } },
      select: { id: true, type: true },
    });
    if (charges.length !== new Set(chargeIds).size)
      throw new NotFoundError('Charge not found', 'CHARGE_NOT_FOUND');
    const typeOf = new Map(charges.map((charge) => [charge.id, charge.type]));
    const [id] = await this.issue(tx, access.estateId, [
      {
        spaceId: unit.id,
        unitCode: unit.code,
        householdId: occupant.householdId,
        payerUserId: occupant.payerUserId,
        payerType: 'occupant',
        billingRunId: null,
        description: input.description,
        issueDate: today,
        dueDate: input.dueDate,
        createdBy: access.userId,
        lines: input.lines.map((line) => ({
          chargeId: line.chargeId ?? null,
          chargeType: (line.chargeId && typeOf.get(line.chargeId)) || 'custom',
          description: line.description,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          amount: line.quantity * line.unitAmount,
        })),
      },
    ]);
    await appendOutboxEvents(tx, [
      {
        type: 'billing.invoice.created',
        estateId: access.estateId,
        aggregateType: 'invoice',
        aggregateId: id as string,
        payload: { invoiceId: id as string },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: 'billing.invoice.create',
          resourceType: 'invoice',
          resourceId: id as string,
          after: { spaceId: unit.id, lines: input.lines.length },
        },
      },
    ]);
    return this.detailIn(tx, access, id as string);
  }

  // ---- Reading -------------------------------------------------------------------------------

  /** Units whose bills this resident may see (viewBills household permission). */
  private async viewableUnits(access: EstateAccess): Promise<string[]> {
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    return households
      .filter((household) => household.isHead || household.permissions.viewBills)
      .map((household) => household.spaceId);
  }

  private async visibility(access: EstateAccess): Promise<Prisma.InvoiceWhereInput | null> {
    if (isStaffWith(access, 'invoice.read')) return null;
    const units = await this.viewableUnits(access);
    return {
      OR: [
        { payerUserId: access.userId },
        ...(units.length > 0 ? [{ spaceId: { in: units } }] : []),
      ],
    };
  }

  /** Staff with invoice.read see all; residents see invoices they pay or their household's. */
  async list(access: EstateAccess, query: z.infer<typeof invoiceListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof invoiceCursorSchema> =>
            invoiceCursorSchema.safeParse(value).success,
        )
      : undefined;
    const visible = await this.visibility(access);
    const today = todayInLagos();
    const statusFilter: Prisma.InvoiceWhereInput =
      query.status === 'overdue'
        ? {
            status: { in: ['issued', 'partially_paid'] },
            OR: [{ dueDate: { lt: parseDateOnly(today) } }, { overdueAt: { not: null } }],
          }
        : query.status === 'issued' || query.status === 'partially_paid'
          ? { status: query.status, dueDate: { gte: parseDateOnly(today) }, overdueAt: null }
          : query.status
            ? { status: query.status }
            : {};
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          estateId: access.estateId,
          ...statusFilter,
          ...(query.spaceId ? { spaceId: query.spaceId } : {}),
          ...(query.payerUserId ? { payerUserId: query.payerUserId } : {}),
          ...(query.billingRunId ? { billingRunId: query.billingRunId } : {}),
          AND: [
            ...(visible ? [visible] : []),
            ...(after
              ? [
                  {
                    OR: [
                      { issueDate: { lt: parseDateOnly(after.issueDate) } },
                      { issueDate: parseDateOnly(after.issueDate), number: { lt: after.number } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const units = new Map(
        (
          await this.property.spacesByIds(
            tx,
            access.estateId,
            page.map((row) => row.spaceId),
          )
        ).map((space) => [space.id, space.code]),
      );
      const last = page.at(-1);
      return {
        items: page.map((row) => this.view(row, units.get(row.spaceId) ?? null, today)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ issueDate: dateOnly(last.issueDate), number: last.number })
            : null,
      };
    });
  }

  async detail(access: EstateAccess, invoiceId: string) {
    return this.db.withTenant(access, (tx) => this.detailIn(tx, access, invoiceId));
  }

  private async detailIn(tx: Tx, access: EstateAccess, invoiceId: string) {
    const visible = await this.visibility(access);
    const row = await tx.invoice.findFirst({
      where: { id: invoiceId, estateId: access.estateId, ...(visible ? { AND: [visible] } : {}) },
      include: {
        lines: { orderBy: { position: 'asc' } },
        creditNotes: { orderBy: { createdAt: 'asc' } },
        waivers: { orderBy: { createdAt: 'asc' } },
        allocations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundError('Invoice not found', 'INVOICE_NOT_FOUND');
    const [space] = await this.property.spacesByIds(tx, access.estateId, [row.spaceId]);
    return {
      ...this.view(row, space?.code ?? null, todayInLagos()),
      lines: row.lines.map((line) => ({
        id: line.id,
        chargeId: line.chargeId,
        description: line.description,
        quantity: line.quantity,
        unitAmount: toKobo(line.unitAmount),
        amount: toKobo(line.amount),
      })),
      creditNotes: row.creditNotes.map((note) => ({
        id: note.id,
        amount: toKobo(note.amount),
        reason: note.reason,
        createdAt: note.createdAt.toISOString(),
      })),
      waivers: row.waivers.map((waiver) => ({
        id: waiver.id,
        amount: toKobo(waiver.amount),
        reason: waiver.reason,
        status: waiver.status as 'pending' | 'approved' | 'rejected',
        createdAt: waiver.createdAt.toISOString(),
      })),
      allocations: row.allocations.map((allocation) => ({
        id: allocation.id,
        amount: toKobo(allocation.amount),
        sourceType: allocation.sourceType,
        createdAt: allocation.createdAt.toISOString(),
      })),
    };
  }

  /** Statements: staff for anyone; residents only for themselves. */
  async statement(access: EstateAccess, query: z.infer<typeof statementQuerySchema>) {
    if (!isStaffWith(access, 'invoice.read')) {
      if (query.payerUserId && query.payerUserId !== access.userId)
        throw new ForbiddenError('You can only see your own statement');
      return this.ledger.statement(access, { ...query, payerUserId: access.userId });
    }
    if (!query.payerUserId && !query.spaceId)
      throw new DomainError(
        'STATEMENT_PARTY_REQUIRED',
        'Choose a payer or a unit for the statement',
        422,
      );
    return this.ledger.statement(access, query);
  }

  // ---- Credit notes and waivers ----------------------------------------------------------------

  /** Locks the invoice row for a money change in this transaction. */
  private async lockInvoice(tx: Tx, estateId: string, invoiceId: string): Promise<InvoiceRow> {
    await tx.$queryRaw`select id from tenant.invoices where id = ${invoiceId}::uuid for update`;
    const row = await tx.invoice.findFirst({ where: { id: invoiceId, estateId } });
    if (!row) throw new NotFoundError('Invoice not found', 'INVOICE_NOT_FOUND');
    return row;
  }

  private amounts(row: InvoiceRow) {
    return {
      total: toKobo(row.total),
      amountPaid: toKobo(row.amountPaid),
      amountCredited: toKobo(row.amountCredited),
      amountWaived: toKobo(row.amountWaived),
    };
  }

  /** Writes new amounts and the derived status; emits billing.invoice.paid when it settles. */
  private async applyAmounts(
    tx: Tx,
    row: InvoiceRow,
    change: { paid?: number; credited?: number; waived?: number },
  ): Promise<void> {
    const before = this.amounts(row);
    const after = {
      total: before.total,
      amountPaid: before.amountPaid + (change.paid ?? 0),
      amountCredited: before.amountCredited + (change.credited ?? 0),
      amountWaived: before.amountWaived + (change.waived ?? 0),
    };
    const status = deriveInvoiceStatus(after);
    await tx.invoice.update({
      where: { id: row.id },
      data: {
        amountPaid: BigInt(after.amountPaid),
        amountCredited: BigInt(after.amountCredited),
        amountWaived: BigInt(after.amountWaived),
        balance: BigInt(after.total - after.amountPaid - after.amountCredited - after.amountWaived),
        status,
      },
    });
    if (status === 'paid' && row.status !== 'paid') {
      await appendOutboxEvents(tx, [
        {
          type: 'billing.invoice.paid',
          estateId: row.estateId,
          aggregateType: 'invoice',
          aggregateId: row.id,
          payload: { invoiceId: row.id, number: row.number, payerUserId: row.payerUserId },
        },
      ]);
    }
  }

  private async unitCode(tx: Tx, estateId: string, spaceId: string): Promise<string> {
    const [space] = await this.property.spacesByIds(tx, estateId, [spaceId]);
    return space?.code ?? spaceId;
  }

  /** Credit note (billing.md §2.8): reduces what is owed and reverses income. Approvers only. */
  async creditNote(
    access: EstateAccess,
    invoiceId: string,
    input: z.infer<typeof createCreditNoteSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.lockInvoice(tx, access.estateId, invoiceId);
      if (!canReduceBy(this.amounts(row), input.amount))
        throw new DomainError(
          'INVOICE_AMOUNT_EXCEEDS_BALANCE',
          'The amount is more than what is still owed on this invoice',
          422,
        );
      const noteId = uuidv7();
      const code = await this.unitCode(tx, access.estateId, row.spaceId);
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'credit_note',
          description: `Credit note on ${row.number}: ${input.reason}`,
          sourceType: 'credit_note',
          sourceId: noteId,
          reference: row.number,
          postedBy: access.userId,
          lines: [
            { account: accounts.incomeAdjustments(), debit: input.amount, credit: 0 },
            {
              account: accounts.receivable(row.payerUserId, row.spaceId, code),
              debit: 0,
              credit: input.amount,
            },
          ],
        },
      ]);
      const note = await tx.creditNote.create({
        data: {
          id: noteId,
          estateId: access.estateId,
          invoiceId,
          amount: BigInt(input.amount),
          reason: input.reason,
          createdBy: access.userId,
          journalId: journalId as string,
        },
      });
      await this.applyAmounts(tx, row, { credited: input.amount });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.credit_note.issued',
          estateId: access.estateId,
          aggregateType: 'invoice',
          aggregateId: invoiceId,
          payload: { invoiceId, creditNoteId: noteId, amount: input.amount },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.credit_note.issue',
            resourceType: 'invoice',
            resourceId: invoiceId,
            after: { amount: input.amount },
            reason: input.reason,
          },
        },
      ]);
      return {
        id: note.id,
        invoiceId,
        amount: input.amount,
        reason: note.reason,
        createdBy: note.createdBy,
        createdAt: note.createdAt.toISOString(),
      };
    });
  }

  /**
   * Waiver request (billing.md §2.7, rule 6). An approver's request at or below the estate threshold is
   * approved at once; anything else waits for a different approver.
   */
  async requestWaiver(
    access: EstateAccess,
    invoiceId: string,
    input: z.infer<typeof createWaiverSchema>,
  ) {
    const settings = await this.tenancy.getSettings(access);
    const selfApprove =
      access.permissions.has('billing.run.approve') &&
      !waiverNeedsSecondApprover(settings['billing.waiver_threshold_kobo'], input.amount);
    return this.db.withTenant(access, async (tx) => {
      const row = await this.lockInvoice(tx, access.estateId, invoiceId);
      const pending = await tx.waiver.aggregate({
        where: { invoiceId, status: 'pending' },
        _sum: { amount: true },
      });
      const pendingAmount = toKobo(pending._sum.amount ?? 0n);
      if (!canReduceBy(this.amounts(row), input.amount + pendingAmount))
        throw new DomainError(
          'INVOICE_AMOUNT_EXCEEDS_BALANCE',
          'The amount is more than what is still owed on this invoice',
          422,
        );
      const waiver = await tx.waiver.create({
        data: {
          estateId: access.estateId,
          invoiceId,
          amount: BigInt(input.amount),
          reason: input.reason,
          requestedBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.waiver.requested',
          estateId: access.estateId,
          aggregateType: 'waiver',
          aggregateId: waiver.id,
          payload: { waiverId: waiver.id, invoiceId, amount: input.amount },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.waiver.request',
            resourceType: 'invoice',
            resourceId: invoiceId,
            after: { amount: input.amount },
            reason: input.reason,
          },
        },
      ]);
      if (selfApprove) return this.approveWaiverIn(tx, access, row, waiver.id, null, true);
      return this.waiverView(waiver);
    });
  }

  async decideWaiver(
    access: EstateAccess,
    invoiceId: string,
    waiverId: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.lockInvoice(tx, access.estateId, invoiceId);
      const waiver = await tx.waiver.findFirst({
        where: { id: waiverId, invoiceId, estateId: access.estateId },
      });
      if (!waiver) throw new NotFoundError('Waiver not found', 'WAIVER_NOT_FOUND');
      if (waiver.status !== 'pending')
        throw new ConflictError('WAIVER_NOT_PENDING', 'This waiver has already been decided');
      if (waiver.requestedBy === access.userId)
        throw new ForbiddenError(
          'Someone other than the requester must decide this waiver',
          'WAIVER_SELF_APPROVAL',
        );
      if (decision === 'approve')
        return this.approveWaiverIn(tx, access, row, waiverId, reason, false);
      const updated = await tx.waiver.update({
        where: { id: waiverId },
        data: {
          status: 'rejected',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.waiver.rejected',
          estateId: access.estateId,
          aggregateType: 'waiver',
          aggregateId: waiverId,
          payload: { waiverId, invoiceId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.waiver.reject',
            resourceType: 'invoice',
            resourceId: invoiceId,
            reason,
          },
        },
      ]);
      return this.waiverView(updated);
    });
  }

  private async approveWaiverIn(
    tx: Tx,
    access: EstateAccess,
    row: InvoiceRow,
    waiverId: string,
    reason: string | null,
    automatic: boolean,
  ) {
    const waiver = await tx.waiver.findFirstOrThrow({ where: { id: waiverId } });
    const amount = toKobo(waiver.amount);
    if (!canReduceBy(this.amounts(row), amount))
      throw new DomainError(
        'INVOICE_AMOUNT_EXCEEDS_BALANCE',
        'The amount is more than what is still owed on this invoice',
        422,
      );
    const code = await this.unitCode(tx, access.estateId, row.spaceId);
    const [journalId] = await this.ledger.post(tx, access.estateId, [
      {
        type: 'waiver',
        description: `Waiver on ${row.number}: ${waiver.reason}`,
        sourceType: 'waiver',
        sourceId: waiverId,
        reference: row.number,
        postedBy: access.userId,
        lines: [
          { account: accounts.waivers(), debit: amount, credit: 0 },
          {
            account: accounts.receivable(row.payerUserId, row.spaceId, code),
            debit: 0,
            credit: amount,
          },
        ],
      },
    ]);
    const updated = await tx.waiver.update({
      where: { id: waiverId },
      data: {
        status: 'approved',
        decidedBy: access.userId,
        decidedAt: new Date(),
        decisionReason: reason ?? (automatic ? 'Within the estate waiver threshold' : null),
        journalId: journalId as string,
      },
    });
    await this.applyAmounts(tx, row, { waived: amount });
    await appendOutboxEvents(tx, [
      {
        type: 'billing.waiver.approved',
        estateId: access.estateId,
        aggregateType: 'waiver',
        aggregateId: waiverId,
        payload: { waiverId, invoiceId: row.id, amount },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: 'billing.waiver.approve',
          resourceType: 'invoice',
          resourceId: row.id,
          after: { amount, automatic },
          reason,
        },
      },
    ]);
    return this.waiverView(updated);
  }

  async waivers(access: EstateAccess, query: z.infer<typeof waiverListQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.waiver.findMany({
        where: { estateId: access.estateId, ...(query.status ? { status: query.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((row) => this.waiverView(row));
    });
  }

  private waiverView(row: Prisma.WaiverGetPayload<object>) {
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      amount: toKobo(row.amount),
      reason: row.reason,
      status: row.status as 'pending' | 'approved' | 'rejected',
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      decisionReason: row.decisionReason,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  // ---- Allocation (called by payments) ---------------------------------------------------------

  /**
   * Applies money received to the payer's open invoices, chosen invoices first then oldest due first,
   * in the caller's transaction: Dr cash / Cr receivable per invoice, any remainder Cr payer credit.
   * Idempotent per source: a source already allocated returns its earlier result.
   */
  async allocate(tx: Tx, estateId: string, input: AllocationInput) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
      throw new RangeError('Allocation amount must be a positive integer');
    const existing = await tx.journal.findFirst({
      where: { estateId, sourceType: input.sourceType, sourceId: input.sourceId, type: 'payment' },
      select: { id: true },
    });
    if (existing) {
      const previous = await tx.allocation.findMany({
        where: { estateId, sourceType: input.sourceType, sourceId: input.sourceId },
      });
      const applied = sum(previous.map((row) => toKobo(row.amount)));
      return {
        allocations: previous.map((row) => ({
          invoiceId: row.invoiceId,
          amount: toKobo(row.amount),
        })),
        remainder: input.amount - applied,
        journalId: existing.id,
        duplicate: true,
      };
    }
    const open = await tx.invoice.findMany({
      where: {
        estateId,
        payerUserId: input.payerUserId,
        status: { in: ['issued', 'partially_paid'] },
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
    if (open.length > 0) {
      await tx.$queryRaw`select id from tenant.invoices where id = any(${open.map((row) => row.id)}::uuid[]) for update`;
    }
    const chosen = new Set(input.invoiceIds ?? []);
    const toOpen = (row: InvoiceRow) => ({
      id: row.id,
      balance: toKobo(row.balance),
      dueDate: dateOnly(row.dueDate),
      issueDate: dateOnly(row.issueDate),
      number: row.number,
    });
    const first = allocateOldestFirst(
      open.filter((row) => chosen.has(row.id)).map(toOpen),
      input.amount,
    );
    const rest =
      first.remainder > 0
        ? allocateOldestFirst(
            open.filter((row) => !chosen.has(row.id)).map(toOpen),
            first.remainder,
          )
        : { allocations: [], remainder: 0 };
    const allocations = [...first.allocations, ...rest.allocations];
    const remainder = rest.remainder;
    const byId = new Map(open.map((row) => [row.id, row]));
    const codes = new Map(
      (
        await this.property.spacesByIds(
          tx,
          estateId,
          allocations.map((allocation) => (byId.get(allocation.invoiceId) as InvoiceRow).spaceId),
        )
      ).map((space) => [space.id, space.code]),
    );
    const [journalId] = await this.ledger.post(tx, estateId, [
      {
        type: 'payment',
        description:
          allocations.length > 0
            ? `Payment for ${allocations.map((a) => (byId.get(a.invoiceId) as InvoiceRow).number).join(', ')}`
            : 'Payment held as credit',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reference: input.reference ?? null,
        postedBy: input.postedBy,
        lines: [
          { account: accounts.cash(input.channel), debit: input.amount, credit: 0 },
          ...allocations.map((allocation) => {
            const row = byId.get(allocation.invoiceId) as InvoiceRow;
            return {
              account: accounts.receivable(
                row.payerUserId,
                row.spaceId,
                codes.get(row.spaceId) ?? row.spaceId,
              ),
              debit: 0,
              credit: allocation.amount,
            };
          }),
          ...(remainder > 0
            ? [{ account: accounts.credits(input.payerUserId), debit: 0, credit: remainder }]
            : []),
        ],
      },
    ]);
    if (allocations.length > 0) {
      await tx.allocation.createMany({
        data: allocations.map((allocation) => ({
          estateId,
          invoiceId: allocation.invoiceId,
          amount: BigInt(allocation.amount),
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          journalId: journalId as string,
        })),
      });
    }
    for (const allocation of allocations) {
      await this.applyAmounts(tx, byId.get(allocation.invoiceId) as InvoiceRow, {
        paid: allocation.amount,
      });
    }
    return { allocations, remainder, journalId: journalId as string, duplicate: false };
  }

  /**
   * Cancels what is still owed on an invoice with a credit note, in the caller's transaction (e.g. an
   * unpaid facility hold that expired). No-op when nothing is owed.
   */
  async cancelBalance(
    tx: Tx,
    estateId: string,
    invoiceId: string,
    reason: string,
    actorId: string | null,
  ) {
    const row = await this.lockInvoice(tx, estateId, invoiceId);
    const owed = toKobo(row.balance);
    if (owed === 0) return 0;
    const noteId = uuidv7();
    const code = await this.unitCode(tx, estateId, row.spaceId);
    const [journalId] = await this.ledger.post(tx, estateId, [
      {
        type: 'credit_note',
        description: `Credit note on ${row.number}: ${reason}`,
        sourceType: 'credit_note',
        sourceId: noteId,
        reference: row.number,
        postedBy: actorId,
        lines: [
          { account: accounts.incomeAdjustments(), debit: owed, credit: 0 },
          {
            account: accounts.receivable(row.payerUserId, row.spaceId, code),
            debit: 0,
            credit: owed,
          },
        ],
      },
    ]);
    await tx.creditNote.create({
      data: {
        id: noteId,
        estateId,
        invoiceId,
        amount: BigInt(owed),
        reason,
        createdBy: actorId ?? row.payerUserId,
        journalId: journalId as string,
      },
    });
    await this.applyAmounts(tx, row, { credited: owed });
    return owed;
  }

  /**
   * Gives money back on a paid invoice as payer credit (Dr income adjustments / Cr payer credit), e.g. a
   * facility cancellation refund. The credit can pay later invoices or be refunded through payments.
   */
  async refundToCredit(
    tx: Tx,
    estateId: string,
    invoiceId: string,
    amount: number,
    reason: string,
    actorId: string | null,
  ) {
    const row = await this.lockInvoice(tx, estateId, invoiceId);
    if (amount <= 0) return 0;
    if (amount > toKobo(row.amountPaid))
      throw new DomainError(
        'REFUND_EXCEEDS_PAYMENT',
        'The refund is more than was paid on this invoice',
        422,
      );
    await this.ledger.post(tx, estateId, [
      {
        type: 'adjustment',
        description: `Refund to credit on ${row.number}: ${reason}`,
        sourceType: 'invoice_refund',
        sourceId: `${invoiceId}:${uuidv7()}`,
        reference: row.number,
        postedBy: actorId,
        lines: [
          { account: accounts.incomeAdjustments(), debit: amount, credit: 0 },
          { account: accounts.credits(row.payerUserId), debit: 0, credit: amount },
        ],
      },
    ]);
    await appendOutboxEvents(tx, [
      {
        type: 'billing.invoice.refunded_to_credit',
        estateId,
        aggregateType: 'invoice',
        aggregateId: invoiceId,
        payload: { invoiceId, amount },
      },
    ]);
    return amount;
  }

  /** Status of an invoice, for modules that wait on payment (facility bookings). */
  async invoiceStatus(tx: Tx, estateId: string, invoiceId: string): Promise<string | null> {
    const row = await tx.invoice.findFirst({
      where: { id: invoiceId, estateId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /** What is still owed on a unit's open invoices (move-out checks, archive checks). */
  async unitOutstanding(tx: Tx, estateId: string, spaceId: string): Promise<number> {
    const total = await tx.invoice.aggregate({
      where: { estateId, spaceId, status: { in: ['issued', 'partially_paid'] } },
      _sum: { balance: true },
    });
    return toKobo(total._sum.balance ?? 0n);
  }

  /** Open balance a payer owes (for checkout and virtual-account matching). */
  async openInvoices(
    tx: Tx,
    estateId: string,
    payerUserId: string,
    invoiceIds?: readonly string[],
  ) {
    const rows = await tx.invoice.findMany({
      where: {
        estateId,
        payerUserId,
        status: { in: ['issued', 'partially_paid'] },
        ...(invoiceIds ? { id: { in: [...invoiceIds] } } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      spaceId: row.spaceId,
      balance: toKobo(row.balance),
      dueDate: dateOnly(row.dueDate),
    }));
  }

  view(row: InvoiceRow, unitCode: string | null, today: string) {
    return {
      id: row.id,
      number: row.number,
      spaceId: row.spaceId,
      unitCode,
      payerUserId: row.payerUserId,
      payerType: row.payerType as 'occupant' | 'owner',
      billingRunId: row.billingRunId,
      penaltyForInvoiceId: row.penaltyForInvoiceId,
      description: row.description,
      issueDate: dateOnly(row.issueDate),
      dueDate: dateOnly(row.dueDate),
      currency: 'NGN' as const,
      subtotal: toKobo(row.subtotal),
      total: toKobo(row.total),
      amountPaid: toKobo(row.amountPaid),
      amountCredited: toKobo(row.amountCredited),
      amountWaived: toKobo(row.amountWaived),
      balance: toKobo(row.balance),
      status: displayInvoiceStatus(
        row.status,
        dateOnly(row.dueDate),
        today,
        row.overdueAt !== null,
      ),
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Reads for other modules (search, reports), inside the caller's tenant transaction ----------

  /** Invoices whose number contains `q` (global search; the caller checks staff `invoice.read`). */
  async searchInvoices(tx: Tx, estateId: string, q: string, take: number) {
    return tx.invoice.findMany({
      where: { estateId, number: { contains: q, mode: 'insensitive' } },
      select: { id: true, number: true, status: true },
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Amounts of non-void invoices created in the window (estate reports). */
  async invoicesCreatedBetween(tx: Tx, estateId: string, from: Date, to: Date) {
    return tx.invoice.findMany({
      where: { estateId, createdAt: { gte: from, lte: to }, status: { not: 'void' } },
      select: { total: true, amountPaid: true, dueDate: true, status: true },
    });
  }
}
