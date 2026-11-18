import { Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import {
  billingRunItemSchema,
  billingRunItemsQuerySchema,
  billingRunSchema,
  cancelBillingRunSchema,
  chargeListQuerySchema,
  chargeSchema,
  createBillingRunSchema,
  createChargeSchema,
  createCreditNoteSchema,
  createInvoiceSchema,
  createWaiverSchema,
  creditNoteSchema,
  estateItemParamsSchema,
  estateParamSchema,
  invoiceDetailSchema,
  invoiceListQuerySchema,
  invoiceSchema,
  invoiceWaiverParamsSchema,
  ledgerBalanceSchema,
  ledgerEntrySchema,
  ledgerQuerySchema,
  statementQuerySchema,
  statementSchema,
  updateChargeSchema,
  waiverDecisionSchema,
  waiverListQuerySchema,
  waiverRejectionSchema,
  waiverSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { parseIfMatchVersion } from '../../common/http/if-match';
import { BillingRunsService } from './billing-runs.service';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Estate billing (billing.md §6). Residents read their own invoices; staff manage the rest. */
@Controller('v1/estates/:estateId')
export class BillingController {
  constructor(
    private readonly runs: BillingRunsService,
    private readonly invoices: InvoicesService,
    private readonly ledger: LedgerService,
  ) {}

  // ---- Charges -------------------------------------------------------------------------------

  @Get('charges')
  @Can('invoice.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Charge definitions',
    tags: ['billing'],
    params: estateParamSchema,
    query: chargeListQuerySchema,
    response: z.array(chargeSchema),
  })
  charges(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof chargeListQuerySchema>,
  ) {
    return this.runs.charges(estate, query);
  }

  @Post('charges')
  @Can('charge.manage')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Define a charge (dues, levies, service charge)',
    tags: ['billing'],
    params: estateParamSchema,
    body: createChargeSchema,
    response: chargeSchema,
    status: 201,
    errors: [403, 404],
  })
  createCharge(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createChargeSchema>,
  ) {
    return this.runs.createCharge(estate, body);
  }

  @Get('charges/:id')
  @Can('invoice.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Charge detail',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: chargeSchema,
    errors: [404],
  })
  charge(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.charge(estate, params.id);
  }

  @Patch('charges/:id')
  @Can('charge.manage')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Change a charge for future runs (send If-Match with its version)',
    tags: ['billing'],
    params: estateItemParamsSchema,
    body: updateChargeSchema,
    response: chargeSchema,
    errors: [403, 404, 409, 412],
  })
  updateCharge(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateChargeSchema>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.runs.updateCharge(estate, params.id, body, parseIfMatchVersion(ifMatch));
  }

  // ---- Billing runs --------------------------------------------------------------------------

  @Get('billing-runs')
  // Approvers read runs too, so they can see what they are approving.
  @Can('billing.run.create', 'billing.run.approve')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Billing runs, newest first',
    tags: ['billing'],
    params: estateParamSchema,
    response: z.array(billingRunSchema),
  })
  listRuns(@CurrentEstate() estate: EstateAccess) {
    return this.runs.runs(estate);
  }

  @Post('billing-runs')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Prepare a billing run',
    tags: ['billing'],
    params: estateParamSchema,
    body: createBillingRunSchema,
    response: billingRunSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  createRun(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createBillingRunSchema>,
  ) {
    return this.runs.createRun(estate, body);
  }

  @Get('billing-runs/:id')
  // Approvers read runs too, so they can see what they are approving.
  @Can('billing.run.create', 'billing.run.approve')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Billing run detail',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: billingRunSchema,
    errors: [404],
  })
  getRun(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.run(estate, params.id);
  }

  @Get('billing-runs/:id/items')
  // Approvers read runs too, so they can see what they are approving.
  @Can('billing.run.create', 'billing.run.approve')
  @RequiresFeature('billing')
  @Contract({
    summary: "A run's per-unit bills (the preview)",
    tags: ['billing'],
    params: estateItemParamsSchema,
    query: billingRunItemsQuerySchema,
    response: billingRunItemSchema,
    paginated: true,
    errors: [404],
  })
  runItems(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidQuery() query: z.infer<typeof billingRunItemsQuerySchema>,
  ) {
    return this.runs.items(estate, params.id, query);
  }

  @Post('billing-runs/:id/preview')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Compute every unit’s bill',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: billingRunSchema,
    errors: [404, 409, 422],
  })
  preview(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.preview(estate, params.id);
  }

  @Post('billing-runs/:id/submit')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Submit a previewed run for approval',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: billingRunSchema,
    errors: [404, 409, 422],
  })
  submit(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.submit(estate, params.id);
  }

  @Post('billing-runs/:id/approve')
  @Can('billing.run.approve')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a run (not by the person who prepared it)',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: billingRunSchema,
    errors: [403, 404, 409],
  })
  approve(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.approve(estate, params.id);
  }

  @Post('billing-runs/:id/issue')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Issue the invoices of an approved run',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: billingRunSchema,
    errors: [404, 409],
  })
  issue(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.runs.issue(estate, params.id);
  }

  @Post('billing-runs/:id/cancel')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel a run that has not been issued',
    tags: ['billing'],
    params: estateItemParamsSchema,
    body: cancelBillingRunSchema,
    response: billingRunSchema,
    errors: [404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof cancelBillingRunSchema>,
  ) {
    return this.runs.cancel(estate, params.id, body.reason);
  }

  // ---- Invoices ------------------------------------------------------------------------------

  @Get('invoices')
  @Can('invoice.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Invoices (staff: all; residents: their own and their household’s)',
    tags: ['billing'],
    params: estateParamSchema,
    query: invoiceListQuerySchema,
    response: invoiceSchema,
    paginated: true,
  })
  listInvoices(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof invoiceListQuerySchema>,
  ) {
    return this.invoices.list(estate, query);
  }

  @Post('invoices')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Issue a one-off invoice to a unit’s household',
    tags: ['billing'],
    params: estateParamSchema,
    body: createInvoiceSchema,
    response: invoiceDetailSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  createInvoice(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createInvoiceSchema>,
  ) {
    return this.invoices.createOneOff(estate, body);
  }

  @Get('invoices/:id')
  @Can('invoice.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Invoice detail with lines, credits, waivers and payments',
    tags: ['billing'],
    params: estateItemParamsSchema,
    response: invoiceDetailSchema,
    errors: [404],
  })
  invoice(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.invoices.detail(estate, params.id);
  }

  @Post('invoices/:id/credit-notes')
  @Can('billing.run.approve')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Issue a credit note against an invoice',
    tags: ['billing'],
    params: estateItemParamsSchema,
    body: createCreditNoteSchema,
    response: creditNoteSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  creditNote(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createCreditNoteSchema>,
  ) {
    return this.invoices.creditNote(estate, params.id, body);
  }

  @Post('invoices/:id/waivers')
  @Can('billing.run.create')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Request a waiver (approved at once when within the approver’s threshold)',
    tags: ['billing'],
    params: estateItemParamsSchema,
    body: createWaiverSchema,
    response: waiverSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  requestWaiver(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createWaiverSchema>,
  ) {
    return this.invoices.requestWaiver(estate, params.id, body);
  }

  @Post('invoices/:id/waivers/:waiverId/approve')
  @Can('billing.run.approve')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a waiver (not by the requester)',
    tags: ['billing'],
    params: invoiceWaiverParamsSchema,
    body: waiverDecisionSchema,
    response: waiverSchema,
    errors: [403, 404, 409, 422],
  })
  approveWaiver(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof invoiceWaiverParamsSchema>,
    @ValidBody() body: z.infer<typeof waiverDecisionSchema>,
  ) {
    return this.invoices.decideWaiver(
      estate,
      params.id,
      params.waiverId,
      'approve',
      body.reason ?? null,
    );
  }

  @Post('invoices/:id/waivers/:waiverId/reject')
  @Can('billing.run.approve')
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a waiver with a reason',
    tags: ['billing'],
    params: invoiceWaiverParamsSchema,
    body: waiverRejectionSchema,
    response: waiverSchema,
    errors: [403, 404, 409],
  })
  rejectWaiver(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof invoiceWaiverParamsSchema>,
    @ValidBody() body: z.infer<typeof waiverRejectionSchema>,
  ) {
    return this.invoices.decideWaiver(estate, params.id, params.waiverId, 'reject', body.reason);
  }

  @Get('waivers')
  @Can('billing.run.approve')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Waivers (e.g. those waiting for approval)',
    tags: ['billing'],
    params: estateParamSchema,
    query: waiverListQuerySchema,
    response: z.array(waiverSchema),
  })
  waivers(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof waiverListQuerySchema>,
  ) {
    return this.invoices.waivers(estate, query);
  }

  // ---- Statements and ledger -----------------------------------------------------------------

  @Get('statements')
  @Can('invoice.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Statement for a payer or unit (residents: their own)',
    tags: ['billing'],
    params: estateParamSchema,
    query: statementQuerySchema,
    response: statementSchema,
    errors: [403, 422],
  })
  statement(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof statementQuerySchema>,
  ) {
    return this.invoices.statement(estate, query);
  }

  @Get('ledger')
  @Can('report.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Ledger entries (accountants)',
    tags: ['billing'],
    params: estateParamSchema,
    query: ledgerQuerySchema,
    response: ledgerEntrySchema,
    paginated: true,
  })
  ledgerEntries(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof ledgerQuerySchema>,
  ) {
    return this.ledger.entries(estate, query);
  }

  @Get('ledger/balances')
  @Can('report.read')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Trial balance per ledger account',
    tags: ['billing'],
    params: estateParamSchema,
    response: z.array(ledgerBalanceSchema),
  })
  balances(@CurrentEstate() estate: EstateAccess) {
    return this.ledger.balances(estate);
  }
}
