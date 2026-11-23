import { z } from 'zod';
import { paginationQuerySchema } from './common';

const procDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const positiveKoboSchema = z.number().int().positive();
const nonNegativeKoboSchema = z.number().int().nonnegative();

// ---- Suppliers ----------------------------------------------------------------------------------

export const supplierStatusSchema = z.enum(['active', 'suspended', 'archived']);

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional(),
  categories: z.array(z.string().trim().min(1).max(60)).default([]),
  vendorId: z.uuid().optional(),
  bankRef: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  status: supplierStatusSchema.optional(),
});

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  categories: z.array(z.string()),
  vendorId: z.uuid().nullable(),
  bankRef: z.string().nullable(),
  status: supplierStatusSchema,
  rating: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Purchase Requests & Approvals --------------------------------------------------------------

export const prStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'rfq',
  'quoted',
  'po_created',
  'closed',
]);

export const prItemInputSchema = z.object({
  description: z.string().trim().min(2).max(300),
  inventoryItemId: z.uuid().optional(),
  qty: z.number().positive(),
  estUnitCostKobo: nonNegativeKoboSchema,
});

export const createPurchaseRequestSchema = z.object({
  department: z.string().trim().min(2).max(100),
  reason: z.string().trim().min(3).max(500),
  requiredBy: procDateSchema.optional(),
  workOrderId: z.uuid().optional(),
  budgetLineId: z.uuid().optional(),
  items: z.array(prItemInputSchema).min(1).max(100),
});

export const approvalStepViewSchema = z.object({
  id: z.uuid(),
  step: z.number().int(),
  approverRole: z.string(),
  approverId: z.uuid().nullable(),
  decision: z.enum(['pending', 'approved', 'rejected']),
  decidedAt: z.iso.datetime().nullable(),
  comment: z.string().nullable(),
});

export const purchaseRequestSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  requestedBy: z.uuid(),
  department: z.string(),
  reason: z.string(),
  requiredBy: procDateSchema.nullable(),
  estimatedTotalKobo: nonNegativeKoboSchema,
  workOrderId: z.uuid().nullable(),
  budgetLineId: z.uuid().nullable(),
  soleSourceJustification: z.string().nullable(),
  status: prStatusSchema,
  items: z.array(
    z.object({
      id: z.uuid(),
      description: z.string(),
      inventoryItemId: z.uuid().nullable(),
      qty: z.number(),
      estUnitCostKobo: nonNegativeKoboSchema,
      lineTotalKobo: nonNegativeKoboSchema,
    }),
  ),
  approvalSteps: z.array(approvalStepViewSchema),
  createdAt: z.iso.datetime(),
});

export const prDecisionSchema = z.object({
  comment: z.string().trim().max(400).optional(),
});

export const prListQuerySchema = paginationQuerySchema.extend({
  status: prStatusSchema.optional(),
});

// ---- Quotations ---------------------------------------------------------------------------------

export const createQuotationSchema = z.object({
  prId: z.uuid(),
  supplierId: z.uuid(),
  totalKobo: positiveKoboSchema,
  validUntil: procDateSchema.optional(),
  fileId: z.uuid().optional(),
  notes: z.string().trim().max(400).optional(),
});

export const selectQuotationSchema = z.object({
  soleSourceJustification: z.string().trim().min(5).max(500).optional(),
});

export const quotationSchema = z.object({
  id: z.uuid(),
  prId: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  totalKobo: positiveKoboSchema,
  validUntil: procDateSchema.nullable(),
  fileId: z.uuid().nullable(),
  notes: z.string().nullable(),
  selected: z.boolean(),
  createdAt: z.iso.datetime(),
});

// ---- Purchase Orders & Goods Receipts -----------------------------------------------------------

export const poStatusSchema = z.enum([
  'draft',
  'issued',
  'partially_received',
  'received',
  'invoiced',
  'closed',
  'cancelled',
]);

export const createPurchaseOrderSchema = z.object({
  prId: z.uuid(),
  quotationId: z.uuid().optional(),
  supplierId: z.uuid(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(300),
        inventoryItemId: z.uuid().optional(),
        qty: z.number().positive(),
        unitCostKobo: positiveKoboSchema,
      }),
    )
    .min(1)
    .max(100),
});

export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  prId: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  totalKobo: positiveKoboSchema,
  status: poStatusSchema,
  issuedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      description: z.string(),
      inventoryItemId: z.uuid().nullable(),
      qtyOrdered: z.number(),
      qtyReceived: z.number(),
      unitCostKobo: positiveKoboSchema,
      lineTotalKobo: positiveKoboSchema,
    }),
  ),
  createdAt: z.iso.datetime(),
});

export const poListQuerySchema = paginationQuerySchema.extend({
  status: poStatusSchema.optional(),
});

export const createGoodsReceiptSchema = z.object({
  poId: z.uuid(),
  locationId: z.uuid().optional(),
  notes: z.string().trim().max(500).optional(),
  photoFileIds: z.array(z.uuid()).max(10).default([]),
  items: z
    .array(
      z.object({
        poItemId: z.uuid(),
        qtyReceived: z.number().nonnegative(),
        qtyRejected: z.number().nonnegative().default(0),
      }),
    )
    .min(1),
});

export const goodsReceiptSchema = z.object({
  id: z.uuid(),
  poId: z.uuid(),
  receivedBy: z.uuid(),
  receivedAt: z.iso.datetime(),
  notes: z.string().nullable(),
  photoFileIds: z.array(z.uuid()),
  items: z.array(
    z.object({
      id: z.uuid(),
      poItemId: z.uuid(),
      qtyReceived: z.number(),
      qtyRejected: z.number(),
    }),
  ),
});

export const matchSupplierInvoiceSchema = z.object({
  poId: z.uuid(),
  grnId: z.uuid(),
  invoiceRef: z.string().trim().min(1).max(120),
  amountKobo: positiveKoboSchema,
  dueOn: procDateSchema,
  expenseAccountCode: z.string().trim().min(2).max(64).default('expense:procurement'),
  tolerancePercent: z.number().min(0).max(20).default(2),
});

// ---- Inventory & Stock --------------------------------------------------------------------------

export const createStockLocationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  spaceId: z.uuid().optional(),
});

export const stockLocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  spaceId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const createInventoryItemSchema = z.object({
  sku: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(30).default('unit'),
  reorderLevel: z.number().nonnegative().default(0),
  isConsumable: z.boolean().default(false),
});

export const inventoryItemSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  reorderLevel: z.number(),
  avgCostKobo: nonNegativeKoboSchema,
  onHand: z.number(),
  isLowStock: z.boolean(),
  isConsumable: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const stockMovementTypeSchema = z.enum([
  'receipt',
  'issue',
  'transfer',
  'return',
  'adjustment',
]);

export const createStockMovementSchema = z.object({
  itemId: z.uuid(),
  locationId: z.uuid(),
  type: stockMovementTypeSchema,
  /** Positive quantity for receipt/return, negative or positive magnitude handled by type. */
  qty: z.number().positive(),
  unitCostKobo: nonNegativeKoboSchema.optional(),
  workOrderId: z.uuid().optional(),
  department: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(300).optional(),
  direction: z.enum(['in', 'out']).optional(),
});

export const stockMovementSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  itemName: z.string(),
  locationId: z.uuid(),
  type: stockMovementTypeSchema,
  qtyDelta: z.number(),
  unitCostKobo: nonNegativeKoboSchema,
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  reason: z.string().nullable(),
  recordedBy: z.uuid(),
  occurredAt: z.iso.datetime(),
});

// ---- Assets -------------------------------------------------------------------------------------

export const assetStatusSchema = z.enum(['in_use', 'in_repair', 'disposed']);

export const createAssetSchema = z.object({
  tag: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  spaceId: z.uuid().optional(),
  custodianId: z.uuid().optional(),
  purchaseCostKobo: nonNegativeKoboSchema,
  purchasedOn: procDateSchema.optional(),
  warrantyUntil: procDateSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateAssetSchema = createAssetSchema.partial().extend({
  status: z.enum(['in_use', 'in_repair']).optional(),
});

export const disposeAssetSchema = z.object({
  reason: z.string().trim().min(3).max(400),
});

export const assetSchema = z.object({
  id: z.uuid(),
  tag: z.string(),
  name: z.string(),
  category: z.string(),
  spaceId: z.uuid().nullable(),
  custodianId: z.uuid().nullable(),
  purchaseCostKobo: nonNegativeKoboSchema,
  purchasedOn: procDateSchema.nullable(),
  warrantyUntil: procDateSchema.nullable(),
  status: assetStatusSchema,
  disposalReason: z.string().nullable(),
  disposedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const procurementReportSchema = z.object({
  totalSpendKobo: nonNegativeKoboSchema,
  openPoCount: z.number().int(),
  openPoTotalKobo: nonNegativeKoboSchema,
  stockValuationKobo: nonNegativeKoboSchema,
  lowStockCount: z.number().int(),
  assetCount: z.number().int(),
  assetBookValueKobo: nonNegativeKoboSchema,
});
