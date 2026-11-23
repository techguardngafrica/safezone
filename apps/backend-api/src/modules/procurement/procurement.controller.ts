import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  assetSchema,
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
  estateParamSchema,
  goodsReceiptSchema,
  inventoryItemSchema,
  matchSupplierInvoiceSchema,
  poListQuerySchema,
  prDecisionSchema,
  prListQuerySchema,
  procurementReportSchema,
  purchaseOrderSchema,
  purchaseRequestSchema,
  quotationSchema,
  selectQuotationSchema,
  stockLocationSchema,
  stockMovementSchema,
  supplierSchema,
  updateAssetSchema,
  updateSupplierSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { ProcurementService } from './procurement.service';

const itemParamSchema = estateParamSchema.extend({ id: z.uuid() });
const prQueryParamSchema = z.object({ prId: z.uuid() });

@Controller('v1/estates/:estateId')
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  // ---- Suppliers --------------------------------------------------------------------------------

  @Get('suppliers')
  @Can('procurement.request', 'procurement.manage', 'procurement.approve')
  @Contract({
    summary: 'List estate suppliers',
    tags: ['procurement'],
    params: estateParamSchema,
    response: z.array(supplierSchema),
  })
  listSuppliers(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.listSuppliers(estate);
  }

  @Post('suppliers')
  @Can('procurement.manage')
  @Contract({
    summary: 'Register a supplier',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createSupplierSchema,
    response: supplierSchema,
    status: 201,
  })
  createSupplier(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createSupplierSchema>,
  ) {
    return this.procurement.createSupplier(estate, body);
  }

  @Patch('suppliers/:id')
  @Can('procurement.manage')
  @Contract({
    summary: 'Update a supplier',
    tags: ['procurement'],
    params: itemParamSchema,
    body: updateSupplierSchema,
    response: supplierSchema,
    errors: [404],
  })
  updateSupplier(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof updateSupplierSchema>,
  ) {
    return this.procurement.updateSupplier(estate, params.id, body);
  }

  // ---- Purchase Requests ------------------------------------------------------------------------

  @Get('purchase-requests')
  @Can('procurement.request', 'procurement.approve', 'procurement.manage')
  @Contract({
    summary: 'List purchase requests',
    tags: ['procurement'],
    params: estateParamSchema,
    query: prListQuerySchema,
    response: purchaseRequestSchema,
    paginated: true,
  })
  listPurchaseRequests(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof prListQuerySchema>,
  ) {
    return this.procurement.listPurchaseRequests(estate, query);
  }

  @Post('purchase-requests')
  @Can('procurement.request')
  @Contract({
    summary: 'Create a draft purchase request',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createPurchaseRequestSchema,
    response: purchaseRequestSchema,
    status: 201,
  })
  createPurchaseRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPurchaseRequestSchema>,
  ) {
    return this.procurement.createPurchaseRequest(estate, body);
  }

  @Post('purchase-requests/:id/submit')
  @Can('procurement.request')
  @HttpCode(200)
  @Contract({
    summary: 'Submit a draft purchase request for band-based approval',
    tags: ['procurement'],
    params: itemParamSchema,
    response: purchaseRequestSchema,
    errors: [404, 409],
  })
  submitPurchaseRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.procurement.submitPurchaseRequest(estate, params.id);
  }

  @Post('purchase-requests/:id/approve')
  @Can('procurement.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve the next pending step on a purchase request',
    tags: ['procurement'],
    params: itemParamSchema,
    body: prDecisionSchema,
    response: purchaseRequestSchema,
    errors: [403, 404, 409],
  })
  approvePurchaseRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof prDecisionSchema>,
  ) {
    return this.procurement.approvePurchaseRequest(estate, params.id, body);
  }

  @Post('purchase-requests/:id/reject')
  @Can('procurement.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a purchase request',
    tags: ['procurement'],
    params: itemParamSchema,
    body: prDecisionSchema,
    response: purchaseRequestSchema,
    errors: [404, 409],
  })
  rejectPurchaseRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof prDecisionSchema>,
  ) {
    return this.procurement.rejectPurchaseRequest(estate, params.id, body);
  }

  // ---- Quotations -------------------------------------------------------------------------------

  @Get('quotations')
  @Can('procurement.manage', 'procurement.approve')
  @Contract({
    summary: 'List quotations for a purchase request',
    tags: ['procurement'],
    params: estateParamSchema,
    query: prQueryParamSchema,
    response: z.array(quotationSchema),
  })
  listQuotations(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof prQueryParamSchema>,
  ) {
    return this.procurement.listQuotations(estate, query.prId);
  }

  @Post('quotations')
  @Can('procurement.manage')
  @Contract({
    summary: 'Capture a supplier quotation for an approved PR',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createQuotationSchema,
    response: quotationSchema,
    status: 201,
    errors: [404, 409],
  })
  addQuotation(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createQuotationSchema>,
  ) {
    return this.procurement.addQuotation(estate, body);
  }

  @Post('quotations/:id/select')
  @Can('procurement.manage', 'procurement.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Select winning quotation (enforces quote threshold or sole-source justification)',
    tags: ['procurement'],
    params: itemParamSchema,
    body: selectQuotationSchema,
    response: quotationSchema,
    errors: [404, 422],
  })
  selectQuotation(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof selectQuotationSchema>,
  ) {
    return this.procurement.selectQuotation(estate, params.id, body);
  }

  // ---- Purchase Orders & Goods Receipts ---------------------------------------------------------

  @Get('purchase-orders')
  @Can('procurement.manage', 'procurement.approve', 'inventory.manage')
  @Contract({
    summary: 'List purchase orders',
    tags: ['procurement'],
    params: estateParamSchema,
    query: poListQuerySchema,
    response: purchaseOrderSchema,
    paginated: true,
  })
  listPurchaseOrders(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof poListQuerySchema>,
  ) {
    return this.procurement.listPurchaseOrders(estate, query);
  }

  @Post('purchase-orders')
  @Can('procurement.manage')
  @Contract({
    summary: 'Create a purchase order from an approved PR',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createPurchaseOrderSchema,
    response: purchaseOrderSchema,
    status: 201,
    errors: [404, 409],
  })
  createPurchaseOrder(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPurchaseOrderSchema>,
  ) {
    return this.procurement.createPurchaseOrder(estate, body);
  }

  @Post('purchase-orders/:id/issue')
  @Can('procurement.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Issue a draft purchase order to the supplier',
    tags: ['procurement'],
    params: itemParamSchema,
    response: purchaseOrderSchema,
    errors: [404, 409],
  })
  issuePurchaseOrder(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.procurement.issuePurchaseOrder(estate, params.id);
  }

  @Post('purchase-orders/:id/cancel')
  @Can('procurement.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel a draft or issued purchase order',
    tags: ['procurement'],
    params: itemParamSchema,
    response: purchaseOrderSchema,
    errors: [404, 409],
  })
  cancelPurchaseOrder(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.procurement.cancelPurchaseOrder(estate, params.id);
  }

  @Post('goods-receipts')
  @Can('procurement.manage', 'inventory.manage')
  @Contract({
    summary: 'Record a goods receipt note (GRN) against an issued PO',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createGoodsReceiptSchema,
    response: goodsReceiptSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  recordGoodsReceipt(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createGoodsReceiptSchema>,
  ) {
    return this.procurement.recordGoodsReceipt(estate, body);
  }

  @Post('procurement/three-way-match')
  @Can('procurement.manage', 'accounting.payable.manage')
  @Contract({
    summary: 'Three-way match supplier invoice against PO and GRN to create an accounting payable',
    tags: ['procurement'],
    params: estateParamSchema,
    body: matchSupplierInvoiceSchema,
    response: z.object({
      payableId: z.uuid(),
      payableNumber: z.string(),
      poId: z.uuid(),
      grnId: z.uuid(),
      diffPercent: z.number(),
    }),
    status: 201,
    errors: [404, 422],
  })
  matchSupplierInvoice(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof matchSupplierInvoiceSchema>,
  ) {
    return this.procurement.matchSupplierInvoice(estate, body);
  }

  // ---- Inventory & Stock ------------------------------------------------------------------------

  @Get('stock-locations')
  @Can('inventory.manage', 'procurement.manage')
  @Contract({
    summary: 'List stock locations (stores)',
    tags: ['procurement'],
    params: estateParamSchema,
    response: z.array(stockLocationSchema),
  })
  listStockLocations(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.listStockLocations(estate);
  }

  @Post('stock-locations')
  @Can('inventory.manage')
  @Contract({
    summary: 'Create a stock location',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createStockLocationSchema,
    response: stockLocationSchema,
    status: 201,
  })
  createStockLocation(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createStockLocationSchema>,
  ) {
    return this.procurement.createStockLocation(estate, body);
  }

  @Get('inventory-items')
  @Can('inventory.manage', 'procurement.manage', 'procurement.request')
  @Contract({
    summary: 'List inventory items with on-hand quantity and low-stock flags',
    tags: ['procurement'],
    params: estateParamSchema,
    response: z.array(inventoryItemSchema),
  })
  listInventoryItems(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.listInventoryItems(estate);
  }

  @Post('inventory-items')
  @Can('inventory.manage')
  @Contract({
    summary: 'Register an inventory item',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createInventoryItemSchema,
    response: inventoryItemSchema,
    status: 201,
    errors: [409],
  })
  createInventoryItem(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createInventoryItemSchema>,
  ) {
    return this.procurement.createInventoryItem(estate, body);
  }

  @Get('stock-movements')
  @Can('inventory.manage')
  @Contract({
    summary: 'List recent stock movements',
    tags: ['procurement'],
    params: estateParamSchema,
    response: z.array(stockMovementSchema),
  })
  listStockMovements(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.listStockMovements(estate);
  }

  @Post('stock-movements')
  @Can('inventory.manage')
  @Contract({
    summary: 'Record a stock movement (receipt, issue to work order, return, adjustment)',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createStockMovementSchema,
    response: stockMovementSchema,
    status: 201,
    errors: [404, 422],
  })
  createStockMovement(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createStockMovementSchema>,
  ) {
    return this.procurement.createStockMovement(estate, body);
  }

  // ---- Assets & Reports -------------------------------------------------------------------------

  @Get('assets')
  @Can('asset.manage', 'inventory.manage', 'report.read')
  @Contract({
    summary: 'List estate asset register',
    tags: ['procurement'],
    params: estateParamSchema,
    response: z.array(assetSchema),
  })
  listAssets(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.listAssets(estate);
  }

  @Post('assets')
  @Can('asset.manage')
  @Contract({
    summary: 'Register a tagged estate asset',
    tags: ['procurement'],
    params: estateParamSchema,
    body: createAssetSchema,
    response: assetSchema,
    status: 201,
    errors: [409],
  })
  createAsset(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createAssetSchema>,
  ) {
    return this.procurement.createAsset(estate, body);
  }

  @Patch('assets/:id')
  @Can('asset.manage')
  @Contract({
    summary: 'Update an estate asset',
    tags: ['procurement'],
    params: itemParamSchema,
    body: updateAssetSchema,
    response: assetSchema,
    errors: [404, 409],
  })
  updateAsset(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof updateAssetSchema>,
  ) {
    return this.procurement.updateAsset(estate, params.id, body);
  }

  @Post('assets/:id/dispose')
  @Can('asset.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Dispose of an estate asset with a recorded reason',
    tags: ['procurement'],
    params: itemParamSchema,
    body: disposeAssetSchema,
    response: assetSchema,
    errors: [404, 409],
  })
  disposeAsset(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof disposeAssetSchema>,
  ) {
    return this.procurement.disposeAsset(estate, params.id, body);
  }

  @Get('reports/procurement')
  @Can('report.read', 'procurement.manage')
  @Contract({
    summary: 'Procurement, inventory valuation and asset summary report',
    tags: ['procurement'],
    params: estateParamSchema,
    response: procurementReportSchema,
  })
  report(@CurrentEstate() estate: EstateAccess) {
    return this.procurement.report(estate);
  }
}
