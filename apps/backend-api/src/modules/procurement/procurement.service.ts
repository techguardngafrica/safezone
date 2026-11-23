import { Injectable } from '@nestjs/common';
import type {
  createAssetSchema,
  createGoodsReceiptSchema,
  createInventoryItemSchema,
  createPurchaseOrderSchema,
  createPurchaseRequestSchema,
  createQuotationSchema,
  createStockLocationSchema,
  createStockMovementSchema,
  createSupplierSchema,
  disposeAssetSchema,
  matchSupplierInvoiceSchema,
  poListQuerySchema,
  prDecisionSchema,
  prListQuerySchema,
  selectQuotationSchema,
  updateAssetSchema,
  updateSupplierSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AccountingService } from '../accounting/accounting.service';
import { dateOnly, parseDateOnly, toKobo } from '../billing/domain/billing';
import { MaintenanceService } from '../maintenance/maintenance.service';
import {
  computeWeightedAverageCost,
  isWithinThreeWayTolerance,
  QUOTE_THRESHOLD_KOBO,
  requiredApprovalRoles,
  signedQtyDelta,
} from './domain/procurement';

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/**
 * Procurement & Inventory (procurement.md, ADR-0026).
 * Integrates with AccountingService (3-way matched payables) and MaintenanceService (stock issued to WOs).
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accounting: AccountingService,
    private readonly maintenance: MaintenanceService,
  ) {}

  // ---- Suppliers --------------------------------------------------------------------------------

  async listSuppliers(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.supplier.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => this.supplierView(r));
    });
  }

  async createSupplier(access: EstateAccess, input: z.infer<typeof createSupplierSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.supplier.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          categories: input.categories,
          vendorId: input.vendorId ?? null,
          bankRef: input.bankRef ?? null,
          rating: input.rating ?? null,
        },
      });
      return this.supplierView(row);
    });
  }

  async updateSupplier(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateSupplierSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { estateId: access.estateId, id } });
      if (!existing) throw new NotFoundError('Supplier not found', 'SUPPLIER_NOT_FOUND');
      const row = await tx.supplier.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.categories !== undefined ? { categories: input.categories } : {}),
          ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
          ...(input.bankRef !== undefined ? { bankRef: input.bankRef } : {}),
          ...(input.rating !== undefined ? { rating: input.rating } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      return this.supplierView(row);
    });
  }

  // ---- Purchase Requests ------------------------------------------------------------------------

  async listPurchaseRequests(access: EstateAccess, query: z.infer<typeof prListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (v): v is z.infer<typeof cursorSchema> => cursorSchema.safeParse(v).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.purchaseRequest.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: { items: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const steps = await tx.approvalStep.findMany({
        where: {
          estateId: access.estateId,
          subjectType: 'purchase_request',
          subjectId: { in: page.map((r) => r.id) },
        },
        orderBy: { step: 'asc' },
      });
      const stepsByPr = new Map<string, typeof steps>();
      for (const s of steps) {
        const list = stepsByPr.get(s.subjectId) ?? [];
        list.push(s);
        stepsByPr.set(s.subjectId, list);
      }
      const last = page.at(-1);
      return {
        items: page.map((r) => this.prView(r, stepsByPr.get(r.id) ?? [])),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async createPurchaseRequest(
    access: EstateAccess,
    input: z.infer<typeof createPurchaseRequestSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const estimatedTotal = input.items.reduce(
        (sum, item) => sum + Math.round(item.qty * item.estUnitCostKobo),
        0,
      );
      const count = await tx.purchaseRequest.count({ where: { estateId: access.estateId } });
      const number = `PR-${String(count + 1).padStart(6, '0')}`;
      const row = await tx.purchaseRequest.create({
        data: {
          estateId: access.estateId,
          number,
          requestedBy: access.userId,
          department: input.department,
          reason: input.reason,
          requiredBy: input.requiredBy ? parseDateOnly(input.requiredBy) : null,
          estimatedTotalKobo: BigInt(estimatedTotal),
          workOrderId: input.workOrderId ?? null,
          budgetLineId: input.budgetLineId ?? null,
          status: 'draft',
          items: {
            create: input.items.map((i) => ({
              estateId: access.estateId,
              description: i.description,
              inventoryItemId: i.inventoryItemId ?? null,
              qty: i.qty,
              estUnitCostKobo: BigInt(i.estUnitCostKobo),
            })),
          },
        },
        include: { items: true },
      });
      return this.prView(row, []);
    });
  }

  async submitPurchaseRequest(access: EstateAccess, prId: string) {
    return this.db.withTenant(access, async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { estateId: access.estateId, id: prId },
        include: { items: true },
      });
      if (!pr) throw new NotFoundError('Purchase request not found', 'PR_NOT_FOUND');
      if (pr.status !== 'draft') {
        throw new ConflictError('PR_NOT_DRAFT', 'Only draft purchase requests can be submitted');
      }
      const roles = requiredApprovalRoles(toKobo(pr.estimatedTotalKobo));
      await tx.approvalStep.createMany({
        data: roles.map((role, idx) => ({
          estateId: access.estateId,
          subjectType: 'purchase_request',
          subjectId: pr.id,
          step: idx + 1,
          approverRole: role,
          decision: 'pending',
        })),
      });
      const updated = await tx.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: 'submitted' },
        include: { items: true },
      });
      const steps = await tx.approvalStep.findMany({
        where: { estateId: access.estateId, subjectType: 'purchase_request', subjectId: pr.id },
        orderBy: { step: 'asc' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'procurement.pr.submitted',
          estateId: access.estateId,
          aggregateType: 'purchase_request',
          aggregateId: pr.id,
          payload: {
            prId: pr.id,
            number: pr.number,
            estimatedTotalKobo: toKobo(pr.estimatedTotalKobo),
          },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'procurement.pr.submit',
            resourceType: 'purchase_request',
            resourceId: pr.id,
          },
        },
      ]);
      return this.prView(updated, steps);
    });
  }

  async approvePurchaseRequest(
    access: EstateAccess,
    prId: string,
    input: z.infer<typeof prDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { estateId: access.estateId, id: prId },
        include: { items: true },
      });
      if (!pr) throw new NotFoundError('Purchase request not found', 'PR_NOT_FOUND');
      if (pr.status !== 'submitted') {
        throw new ConflictError('PR_NOT_SUBMITTED', 'Purchase request is not awaiting approval');
      }
      if (pr.requestedBy === access.userId) {
        throw new DomainError(
          'SELF_APPROVAL_FORBIDDEN',
          'The requester cannot approve their own PR',
          403,
        );
      }
      const steps = await tx.approvalStep.findMany({
        where: { estateId: access.estateId, subjectType: 'purchase_request', subjectId: pr.id },
        orderBy: { step: 'asc' },
      });
      const next = steps.find((s) => s.decision === 'pending');
      if (!next) throw new ConflictError('PR_NO_PENDING_STEP', 'No pending approval step');
      await tx.approvalStep.update({
        where: { id: next.id },
        data: {
          decision: 'approved',
          approverId: access.userId,
          decidedAt: new Date(),
          comment: input.comment ?? null,
        },
      });
      const allDone = steps.every((s) => s.id === next.id || s.decision === 'approved');
      const updated = allDone
        ? await tx.purchaseRequest.update({
            where: { id: pr.id },
            data: { status: 'approved' },
            include: { items: true },
          })
        : pr;
      const freshSteps = await tx.approvalStep.findMany({
        where: { estateId: access.estateId, subjectType: 'purchase_request', subjectId: pr.id },
        orderBy: { step: 'asc' },
      });
      if (allDone) {
        await appendOutboxEvents(tx, [
          {
            type: 'procurement.pr.approved',
            estateId: access.estateId,
            aggregateType: 'purchase_request',
            aggregateId: pr.id,
            payload: { prId: pr.id, number: pr.number },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'procurement.pr.approve',
              resourceType: 'purchase_request',
              resourceId: pr.id,
            },
          },
        ]);
      }
      return this.prView(updated, freshSteps);
    });
  }

  async rejectPurchaseRequest(
    access: EstateAccess,
    prId: string,
    input: z.infer<typeof prDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { estateId: access.estateId, id: prId },
        include: { items: true },
      });
      if (!pr) throw new NotFoundError('Purchase request not found', 'PR_NOT_FOUND');
      if (pr.status !== 'submitted') {
        throw new ConflictError('PR_NOT_SUBMITTED', 'Purchase request is not awaiting approval');
      }
      const next = await tx.approvalStep.findFirst({
        where: {
          estateId: access.estateId,
          subjectType: 'purchase_request',
          subjectId: pr.id,
          decision: 'pending',
        },
        orderBy: { step: 'asc' },
      });
      if (next) {
        await tx.approvalStep.update({
          where: { id: next.id },
          data: {
            decision: 'rejected',
            approverId: access.userId,
            decidedAt: new Date(),
            comment: input.comment ?? null,
          },
        });
      }
      const updated = await tx.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: 'rejected' },
        include: { items: true },
      });
      const freshSteps = await tx.approvalStep.findMany({
        where: { estateId: access.estateId, subjectType: 'purchase_request', subjectId: pr.id },
        orderBy: { step: 'asc' },
      });
      return this.prView(updated, freshSteps);
    });
  }

  // ---- Quotations -------------------------------------------------------------------------------

  async listQuotations(access: EstateAccess, prId: string) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.quotation.findMany({
        where: { estateId: access.estateId, prId },
        include: { supplier: { select: { name: true } } },
        orderBy: { totalKobo: 'asc' },
      });
      return rows.map((r) => this.quotationView(r));
    });
  }

  async addQuotation(access: EstateAccess, input: z.infer<typeof createQuotationSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { estateId: access.estateId, id: input.prId },
      });
      if (!pr) throw new NotFoundError('Purchase request not found', 'PR_NOT_FOUND');
      if (!['approved', 'rfq', 'quoted'].includes(pr.status)) {
        throw new ConflictError('PR_NOT_APPROVED', 'Quotations can only be added to approved PRs');
      }
      const supplier = await tx.supplier.findFirst({
        where: { estateId: access.estateId, id: input.supplierId },
      });
      if (!supplier) throw new NotFoundError('Supplier not found', 'SUPPLIER_NOT_FOUND');
      const row = await tx.quotation.create({
        data: {
          estateId: access.estateId,
          prId: pr.id,
          supplierId: supplier.id,
          totalKobo: BigInt(input.totalKobo),
          validUntil: input.validUntil ? parseDateOnly(input.validUntil) : null,
          fileId: input.fileId ?? null,
          notes: input.notes ?? null,
        },
        include: { supplier: { select: { name: true } } },
      });
      if (pr.status === 'approved' || pr.status === 'rfq') {
        await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: 'quoted' } });
      }
      return this.quotationView(row);
    });
  }

  async selectQuotation(
    access: EstateAccess,
    quotationId: string,
    input: z.infer<typeof selectQuotationSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const quote = await tx.quotation.findFirst({
        where: { estateId: access.estateId, id: quotationId },
        include: { pr: true, supplier: { select: { name: true } } },
      });
      if (!quote) throw new NotFoundError('Quotation not found', 'QUOTATION_NOT_FOUND');
      const count = await tx.quotation.count({
        where: { estateId: access.estateId, prId: quote.prId },
      });
      if (
        toKobo(quote.totalKobo) >= QUOTE_THRESHOLD_KOBO &&
        count < 3 &&
        !input.soleSourceJustification
      ) {
        throw new DomainError(
          'QUOTES_REQUIRED',
          'Purchases at or above ₦100,000 require at least 3 quotations or a sole-source justification',
          422,
        );
      }
      await tx.quotation.updateMany({
        where: { estateId: access.estateId, prId: quote.prId },
        data: { selected: false },
      });
      const updated = await tx.quotation.update({
        where: { id: quote.id },
        data: { selected: true },
        include: { supplier: { select: { name: true } } },
      });
      if (input.soleSourceJustification) {
        await tx.purchaseRequest.update({
          where: { id: quote.prId },
          data: { soleSourceJustification: input.soleSourceJustification },
        });
      }
      return this.quotationView(updated);
    });
  }

  // ---- Purchase Orders & Goods Receipts ---------------------------------------------------------

  async listPurchaseOrders(access: EstateAccess, query: z.infer<typeof poListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (v): v is z.infer<typeof cursorSchema> => cursorSchema.safeParse(v).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.purchaseOrder.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: { supplier: { select: { name: true } }, items: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => this.poView(r)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async createPurchaseOrder(
    access: EstateAccess,
    input: z.infer<typeof createPurchaseOrderSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { estateId: access.estateId, id: input.prId },
      });
      if (!pr) throw new NotFoundError('Purchase request not found', 'PR_NOT_FOUND');
      if (!['approved', 'quoted', 'rfq'].includes(pr.status)) {
        throw new ConflictError('PR_NOT_APPROVED', 'A PO can only be created from an approved PR');
      }
      const supplier = await tx.supplier.findFirst({
        where: { estateId: access.estateId, id: input.supplierId },
      });
      if (!supplier) throw new NotFoundError('Supplier not found', 'SUPPLIER_NOT_FOUND');
      const total = input.items.reduce((sum, i) => sum + Math.round(i.qty * i.unitCostKobo), 0);
      const count = await tx.purchaseOrder.count({ where: { estateId: access.estateId } });
      const number = `PO-${String(count + 1).padStart(6, '0')}`;
      const row = await tx.purchaseOrder.create({
        data: {
          estateId: access.estateId,
          number,
          prId: pr.id,
          supplierId: supplier.id,
          totalKobo: BigInt(total),
          notes: input.notes ?? null,
          status: 'draft',
          items: {
            create: input.items.map((i) => ({
              estateId: access.estateId,
              description: i.description,
              inventoryItemId: i.inventoryItemId ?? null,
              qtyOrdered: i.qty,
              unitCostKobo: BigInt(i.unitCostKobo),
            })),
          },
        },
        include: { supplier: { select: { name: true } }, items: true },
      });
      await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: 'po_created' } });
      return this.poView(row);
    });
  }

  async issuePurchaseOrder(access: EstateAccess, poId: string) {
    return this.db.withTenant(access, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { estateId: access.estateId, id: poId },
        include: { supplier: { select: { name: true } }, items: true },
      });
      if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
      if (po.status !== 'draft') {
        throw new ConflictError('PO_NOT_DRAFT', 'Only draft purchase orders can be issued');
      }
      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'issued', issuedAt: new Date() },
        include: { supplier: { select: { name: true } }, items: true },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'procurement.po.issued',
          estateId: access.estateId,
          aggregateType: 'purchase_order',
          aggregateId: po.id,
          payload: { poId: po.id, number: po.number, totalKobo: toKobo(po.totalKobo) },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'procurement.po.issue',
            resourceType: 'purchase_order',
            resourceId: po.id,
          },
        },
      ]);
      return this.poView(updated);
    });
  }

  async cancelPurchaseOrder(access: EstateAccess, poId: string) {
    return this.db.withTenant(access, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { estateId: access.estateId, id: poId },
        include: { supplier: { select: { name: true } }, items: true },
      });
      if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
      if (!['draft', 'issued'].includes(po.status)) {
        throw new ConflictError('PO_CANNOT_CANCEL', 'Received or invoiced POs cannot be cancelled');
      }
      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'cancelled' },
        include: { supplier: { select: { name: true } }, items: true },
      });
      return this.poView(updated);
    });
  }

  async recordGoodsReceipt(access: EstateAccess, input: z.infer<typeof createGoodsReceiptSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { estateId: access.estateId, id: input.poId },
        include: { items: true },
      });
      if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
      if (!['issued', 'partially_received'].includes(po.status)) {
        throw new ConflictError('PO_NOT_RECEIVABLE', 'Goods can only be received on issued POs');
      }
      const itemMap = new Map(po.items.map((i) => [i.id, i]));
      for (const line of input.items) {
        if (!itemMap.has(line.poItemId)) {
          throw new DomainError(
            'INVALID_PO_ITEM',
            'Goods receipt item does not belong to this PO',
            422,
          );
        }
      }
      const grn = await tx.goodsReceipt.create({
        data: {
          estateId: access.estateId,
          poId: po.id,
          receivedBy: access.userId,
          notes: input.notes ?? null,
          photoFileIds: input.photoFileIds,
          items: {
            create: input.items.map((line) => ({
              estateId: access.estateId,
              poItemId: line.poItemId,
              qtyReceived: line.qtyReceived,
              qtyRejected: line.qtyRejected,
            })),
          },
        },
        include: { items: true },
      });

      let defaultLocId = input.locationId;
      if (!defaultLocId) {
        const firstLoc = await tx.stockLocation.findFirst({
          where: { estateId: access.estateId },
          orderBy: { createdAt: 'asc' },
        });
        defaultLocId = firstLoc?.id;
      }

      for (const line of input.items) {
        if (line.qtyReceived <= 0) continue;
        const poItem = itemMap.get(line.poItemId)!;
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { qtyReceived: { increment: line.qtyReceived } },
        });
        if (poItem.inventoryItemId && defaultLocId) {
          await this.recordStockMovementInTx(tx, access.estateId, access.userId, {
            itemId: poItem.inventoryItemId,
            locationId: defaultLocId,
            type: 'receipt',
            qty: line.qtyReceived,
            unitCostKobo: toKobo(poItem.unitCostKobo),
            referenceType: 'goods_receipt',
            referenceId: grn.id,
          });
        }
      }

      const freshItems = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } });
      const allReceived = freshItems.every((i) => i.qtyReceived >= i.qtyOrdered);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: allReceived ? 'received' : 'partially_received' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'procurement.goods.received',
          estateId: access.estateId,
          aggregateType: 'goods_receipt',
          aggregateId: grn.id,
          payload: { grnId: grn.id, poId: po.id, allReceived },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'procurement.goods.receive',
            resourceType: 'goods_receipt',
            resourceId: grn.id,
          },
        },
      ]);
      return {
        id: grn.id,
        poId: grn.poId,
        receivedBy: grn.receivedBy,
        receivedAt: grn.receivedAt.toISOString(),
        notes: grn.notes,
        photoFileIds: grn.photoFileIds,
        items: grn.items.map((i) => ({
          id: i.id,
          poItemId: i.poItemId,
          qtyReceived: i.qtyReceived,
          qtyRejected: i.qtyRejected,
        })),
      };
    });
  }

  /** Three-way match (PO + GRN + supplier invoice) -> creates a matched payable in AccountingModule. */
  async matchSupplierInvoice(
    access: EstateAccess,
    input: z.infer<typeof matchSupplierInvoiceSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { estateId: access.estateId, id: input.poId },
        include: { supplier: true },
      });
      if (!po) throw new NotFoundError('Purchase order not found', 'PO_NOT_FOUND');
      const grn = await tx.goodsReceipt.findFirst({
        where: { estateId: access.estateId, id: input.grnId, poId: po.id },
      });
      if (!grn) throw new NotFoundError('Goods receipt not found for this PO', 'GRN_NOT_FOUND');

      const check = isWithinThreeWayTolerance(
        toKobo(po.totalKobo),
        input.amountKobo,
        input.tolerancePercent,
      );
      if (!check.ok) {
        throw new DomainError(
          'THREE_WAY_MATCH_FAILED',
          `Invoice differs from PO total by ${check.diffPercent}% (tolerance ±${input.tolerancePercent}%)`,
          422,
        );
      }

      const payable = await this.accounting.createPayableFromProcurementInTx(tx, access.estateId, {
        supplierId: po.supplierId,
        supplierName: po.supplier.name,
        poId: po.id,
        grnId: grn.id,
        invoiceRef: input.invoiceRef,
        expenseAccountCode: input.expenseAccountCode,
        amountKobo: input.amountKobo,
        dueOn: input.dueOn,
        requestedBy: access.userId,
      });
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'invoiced' } });
      return {
        payableId: payable.id,
        payableNumber: payable.number,
        poId: po.id,
        grnId: grn.id,
        diffPercent: check.diffPercent,
      };
    });
  }

  // ---- Inventory & Stock ------------------------------------------------------------------------

  async listStockLocations(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.stockLocation.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        spaceId: r.spaceId,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createStockLocation(
    access: EstateAccess,
    input: z.infer<typeof createStockLocationSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.stockLocation.create({
        data: { estateId: access.estateId, name: input.name, spaceId: input.spaceId ?? null },
      });
      return {
        id: row.id,
        name: row.name,
        spaceId: row.spaceId,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async listInventoryItems(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const items = await tx.inventoryItem.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      const sums = await tx.stockMovement.groupBy({
        by: ['itemId'],
        where: { estateId: access.estateId },
        _sum: { qtyDelta: true },
      });
      const onHandMap = new Map(sums.map((s) => [s.itemId, s._sum.qtyDelta ?? 0]));
      return items.map((item) => {
        const onHand = onHandMap.get(item.id) ?? 0;
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          unit: item.unit,
          reorderLevel: item.reorderLevel,
          avgCostKobo: toKobo(item.avgCostKobo),
          onHand,
          isLowStock: onHand <= item.reorderLevel,
          isConsumable: item.isConsumable,
          createdAt: item.createdAt.toISOString(),
        };
      });
    });
  }

  async createInventoryItem(
    access: EstateAccess,
    input: z.infer<typeof createInventoryItemSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.inventoryItem.findUnique({
        where: { estateId_sku: { estateId: access.estateId, sku: input.sku } },
      });
      if (existing)
        throw new ConflictError('SKU_EXISTS', 'An inventory item with this SKU already exists');
      const row = await tx.inventoryItem.create({
        data: {
          estateId: access.estateId,
          sku: input.sku,
          name: input.name,
          category: input.category,
          unit: input.unit,
          reorderLevel: input.reorderLevel,
          isConsumable: input.isConsumable,
        },
      });
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        unit: row.unit,
        reorderLevel: row.reorderLevel,
        avgCostKobo: 0,
        onHand: 0,
        isLowStock: 0 <= row.reorderLevel,
        isConsumable: row.isConsumable,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async listStockMovements(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: { estateId: access.estateId },
        include: { item: { select: { name: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        itemName: r.item.name,
        locationId: r.locationId,
        type: r.type as 'receipt' | 'issue' | 'transfer' | 'return' | 'adjustment',
        qtyDelta: r.qtyDelta,
        unitCostKobo: toKobo(r.unitCostKobo),
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        reason: r.reason,
        recordedBy: r.recordedBy,
        occurredAt: r.occurredAt.toISOString(),
      }));
    });
  }

  async createStockMovement(
    access: EstateAccess,
    input: z.infer<typeof createStockMovementSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const result = await this.recordStockMovementInTx(tx, access.estateId, access.userId, {
        itemId: input.itemId,
        locationId: input.locationId,
        type: input.type,
        qty: input.qty,
        unitCostKobo: input.unitCostKobo,
        direction: input.direction,
        referenceType: input.workOrderId
          ? 'work_order'
          : input.department
            ? 'department'
            : undefined,
        referenceId: input.workOrderId ?? input.department ?? undefined,
        reason: input.reason,
        workOrderId: input.workOrderId,
      });
      return result;
    });
  }

  private async recordStockMovementInTx(
    tx: Tx,
    estateId: string,
    userId: string,
    input: {
      itemId: string;
      locationId: string;
      type: 'receipt' | 'issue' | 'transfer' | 'return' | 'adjustment';
      qty: number;
      unitCostKobo?: number;
      direction?: 'in' | 'out';
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      workOrderId?: string;
    },
  ) {
    const item = await tx.inventoryItem.findFirst({ where: { estateId, id: input.itemId } });
    if (!item) throw new NotFoundError('Inventory item not found', 'INVENTORY_ITEM_NOT_FOUND');
    const loc = await tx.stockLocation.findFirst({ where: { estateId, id: input.locationId } });
    if (!loc) throw new NotFoundError('Stock location not found', 'STOCK_LOCATION_NOT_FOUND');

    const currentSum = await tx.stockMovement.aggregate({
      where: { estateId, itemId: item.id },
      _sum: { qtyDelta: true },
    });
    const currentOnHand = currentSum._sum.qtyDelta ?? 0;
    const delta = signedQtyDelta(input.type, input.qty, input.direction);
    const nextOnHand = currentOnHand + delta;
    if (nextOnHand < 0 && input.type !== 'adjustment') {
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        `Cannot issue ${input.qty} ${item.unit} of ${item.name} (only ${currentOnHand} on hand)`,
        422,
      );
    }

    const unitCost = input.unitCostKobo ?? toKobo(item.avgCostKobo);
    if (input.type === 'receipt' && delta > 0) {
      const nextAvg = computeWeightedAverageCost(
        currentOnHand,
        toKobo(item.avgCostKobo),
        delta,
        unitCost,
      );
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { avgCostKobo: BigInt(nextAvg) },
      });
    }

    const movement = await tx.stockMovement.create({
      data: {
        estateId,
        itemId: item.id,
        locationId: loc.id,
        type: input.type,
        qtyDelta: delta,
        unitCostKobo: BigInt(unitCost),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        recordedBy: userId,
      },
    });

    if (input.type === 'issue' && input.workOrderId) {
      await this.maintenance.addMaterialInTx(tx, estateId, userId, input.workOrderId, {
        item: `${item.name} (${item.sku})`,
        quantity: input.qty,
        unitCost,
      });
    }

    if (nextOnHand <= item.reorderLevel && currentOnHand > item.reorderLevel) {
      await appendOutboxEvents(tx, [
        {
          type: 'procurement.stock.low',
          estateId,
          aggregateType: 'inventory_item',
          aggregateId: item.id,
          payload: {
            itemId: item.id,
            sku: item.sku,
            name: item.name,
            onHand: nextOnHand,
            reorderLevel: item.reorderLevel,
          },
        },
      ]);
    }

    return {
      id: movement.id,
      itemId: movement.itemId,
      itemName: item.name,
      locationId: movement.locationId,
      type: movement.type as 'receipt' | 'issue' | 'transfer' | 'return' | 'adjustment',
      qtyDelta: movement.qtyDelta,
      unitCostKobo: toKobo(movement.unitCostKobo),
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      reason: movement.reason,
      recordedBy: movement.recordedBy,
      occurredAt: movement.occurredAt.toISOString(),
    };
  }

  // ---- Assets -----------------------------------------------------------------------------------

  async listAssets(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.asset.findMany({
        where: { estateId: access.estateId },
        orderBy: { tag: 'asc' },
      });
      return rows.map((r) => this.assetView(r));
    });
  }

  async createAsset(access: EstateAccess, input: z.infer<typeof createAssetSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.asset.findUnique({
        where: { estateId_tag: { estateId: access.estateId, tag: input.tag } },
      });
      if (existing)
        throw new ConflictError('ASSET_TAG_EXISTS', 'An asset with this tag already exists');
      const row = await tx.asset.create({
        data: {
          estateId: access.estateId,
          tag: input.tag,
          name: input.name,
          category: input.category,
          spaceId: input.spaceId ?? null,
          custodianId: input.custodianId ?? null,
          purchaseCostKobo: BigInt(input.purchaseCostKobo),
          purchasedOn: input.purchasedOn ? parseDateOnly(input.purchasedOn) : null,
          warrantyUntil: input.warrantyUntil ? parseDateOnly(input.warrantyUntil) : null,
          notes: input.notes ?? null,
        },
      });
      return this.assetView(row);
    });
  }

  async updateAsset(access: EstateAccess, id: string, input: z.infer<typeof updateAssetSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.asset.findFirst({ where: { estateId: access.estateId, id } });
      if (!existing) throw new NotFoundError('Asset not found', 'ASSET_NOT_FOUND');
      if (existing.status === 'disposed') {
        throw new ConflictError('ASSET_DISPOSED', 'Disposed assets cannot be edited');
      }
      const row = await tx.asset.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
          ...(input.custodianId !== undefined ? { custodianId: input.custodianId } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      return this.assetView(row);
    });
  }

  async disposeAsset(access: EstateAccess, id: string, input: z.infer<typeof disposeAssetSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.asset.findFirst({ where: { estateId: access.estateId, id } });
      if (!existing) throw new NotFoundError('Asset not found', 'ASSET_NOT_FOUND');
      if (existing.status === 'disposed') {
        throw new ConflictError('ASSET_ALREADY_DISPOSED', 'This asset is already disposed');
      }
      const row = await tx.asset.update({
        where: { id },
        data: { status: 'disposed', disposalReason: input.reason, disposedAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'procurement.asset.disposed',
          estateId: access.estateId,
          aggregateType: 'asset',
          aggregateId: id,
          payload: { assetId: id, tag: row.tag, reason: input.reason },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'procurement.asset.dispose',
            resourceType: 'asset',
            resourceId: id,
            reason: input.reason,
          },
        },
      ]);
      return this.assetView(row);
    });
  }

  // ---- Summary Report ---------------------------------------------------------------------------

  async report(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const [pos, items, sums, assets] = await Promise.all([
        tx.purchaseOrder.findMany({ where: { estateId: access.estateId } }),
        tx.inventoryItem.findMany({ where: { estateId: access.estateId } }),
        tx.stockMovement.groupBy({
          by: ['itemId'],
          where: { estateId: access.estateId },
          _sum: { qtyDelta: true },
        }),
        tx.asset.findMany({ where: { estateId: access.estateId, status: { not: 'disposed' } } }),
      ]);
      const onHandMap = new Map(sums.map((s) => [s.itemId, s._sum.qtyDelta ?? 0]));
      let stockValuationKobo = 0;
      let lowStockCount = 0;
      for (const item of items) {
        const qty = onHandMap.get(item.id) ?? 0;
        if (qty > 0) stockValuationKobo += Math.round(qty * toKobo(item.avgCostKobo));
        if (qty <= item.reorderLevel) lowStockCount += 1;
      }
      const activePos = pos.filter((p) => ['issued', 'partially_received'].includes(p.status));
      const spendPos = pos.filter((p) => !['draft', 'cancelled'].includes(p.status));
      return {
        totalSpendKobo: spendPos.reduce((s, p) => s + toKobo(p.totalKobo), 0),
        openPoCount: activePos.length,
        openPoTotalKobo: activePos.reduce((s, p) => s + toKobo(p.totalKobo), 0),
        stockValuationKobo,
        lowStockCount,
        assetCount: assets.length,
        assetBookValueKobo: assets.reduce((s, a) => s + toKobo(a.purchaseCostKobo), 0),
      };
    });
  }

  // ---- View helpers -----------------------------------------------------------------------------

  private supplierView(r: {
    id: string;
    name: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    categories: string[];
    vendorId: string | null;
    bankRef: string | null;
    status: string;
    rating: number | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      categories: r.categories,
      vendorId: r.vendorId,
      bankRef: r.bankRef,
      status: r.status as 'active' | 'suspended' | 'archived',
      rating: r.rating,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private prView(
    r: {
      id: string;
      number: string;
      requestedBy: string;
      department: string;
      reason: string;
      requiredBy: Date | null;
      estimatedTotalKobo: bigint;
      workOrderId: string | null;
      budgetLineId: string | null;
      soleSourceJustification: string | null;
      status: string;
      createdAt: Date;
      items: {
        id: string;
        description: string;
        inventoryItemId: string | null;
        qty: number;
        estUnitCostKobo: bigint;
      }[];
    },
    steps: {
      id: string;
      step: number;
      approverRole: string;
      approverId: string | null;
      decision: string;
      decidedAt: Date | null;
      comment: string | null;
    }[],
  ) {
    return {
      id: r.id,
      number: r.number,
      requestedBy: r.requestedBy,
      department: r.department,
      reason: r.reason,
      requiredBy: r.requiredBy ? dateOnly(r.requiredBy) : null,
      estimatedTotalKobo: toKobo(r.estimatedTotalKobo),
      workOrderId: r.workOrderId,
      budgetLineId: r.budgetLineId,
      soleSourceJustification: r.soleSourceJustification,
      status: r.status as
        | 'draft'
        | 'submitted'
        | 'approved'
        | 'rejected'
        | 'rfq'
        | 'quoted'
        | 'po_created'
        | 'closed',
      items: r.items.map((i) => ({
        id: i.id,
        description: i.description,
        inventoryItemId: i.inventoryItemId,
        qty: i.qty,
        estUnitCostKobo: toKobo(i.estUnitCostKobo),
        lineTotalKobo: Math.round(i.qty * toKobo(i.estUnitCostKobo)),
      })),
      approvalSteps: steps.map((s) => ({
        id: s.id,
        step: s.step,
        approverRole: s.approverRole,
        approverId: s.approverId,
        decision: s.decision as 'pending' | 'approved' | 'rejected',
        decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
        comment: s.comment,
      })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private quotationView(r: {
    id: string;
    prId: string;
    supplierId: string;
    totalKobo: bigint;
    validUntil: Date | null;
    fileId: string | null;
    notes: string | null;
    selected: boolean;
    createdAt: Date;
    supplier: { name: string };
  }) {
    return {
      id: r.id,
      prId: r.prId,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      totalKobo: toKobo(r.totalKobo),
      validUntil: r.validUntil ? dateOnly(r.validUntil) : null,
      fileId: r.fileId,
      notes: r.notes,
      selected: r.selected,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private poView(r: {
    id: string;
    number: string;
    prId: string;
    supplierId: string;
    totalKobo: bigint;
    status: string;
    issuedAt: Date | null;
    notes: string | null;
    createdAt: Date;
    supplier: { name: string };
    items: {
      id: string;
      description: string;
      inventoryItemId: string | null;
      qtyOrdered: number;
      qtyReceived: number;
      unitCostKobo: bigint;
    }[];
  }) {
    return {
      id: r.id,
      number: r.number,
      prId: r.prId,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      totalKobo: toKobo(r.totalKobo),
      status: r.status as
        | 'draft'
        | 'issued'
        | 'partially_received'
        | 'received'
        | 'invoiced'
        | 'closed'
        | 'cancelled',
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      notes: r.notes,
      items: r.items.map((i) => ({
        id: i.id,
        description: i.description,
        inventoryItemId: i.inventoryItemId,
        qtyOrdered: i.qtyOrdered,
        qtyReceived: i.qtyReceived,
        unitCostKobo: toKobo(i.unitCostKobo),
        lineTotalKobo: Math.round(i.qtyOrdered * toKobo(i.unitCostKobo)),
      })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private assetView(r: {
    id: string;
    tag: string;
    name: string;
    category: string;
    spaceId: string | null;
    custodianId: string | null;
    purchaseCostKobo: bigint;
    purchasedOn: Date | null;
    warrantyUntil: Date | null;
    status: string;
    disposalReason: string | null;
    disposedAt: Date | null;
    notes: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      tag: r.tag,
      name: r.name,
      category: r.category,
      spaceId: r.spaceId,
      custodianId: r.custodianId,
      purchaseCostKobo: toKobo(r.purchaseCostKobo),
      purchasedOn: r.purchasedOn ? dateOnly(r.purchasedOn) : null,
      warrantyUntil: r.warrantyUntil ? dateOnly(r.warrantyUntil) : null,
      status: r.status as 'in_use' | 'in_repair' | 'disposed',
      disposalReason: r.disposalReason,
      disposedAt: r.disposedAt ? r.disposedAt.toISOString() : null,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
