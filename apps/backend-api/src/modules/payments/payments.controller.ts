import { Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  bankSchema,
  createManualPaymentSchema,
  createPaymentIntentSchema,
  createRefundSchema,
  createVirtualAccountSchema,
  decisionReasonSchema,
  estateItemParamsSchema,
  estateParamSchema,
  idempotencyKeySchema,
  manualPaymentListQuerySchema,
  manualPaymentSchema,
  optionalDecisionSchema,
  paymentIntentSchema,
  payoutAccountSchema,
  payoutAccountSetupSchema,
  providerParamSchema,
  refundListQuerySchema,
  refundSchema,
  transactionListQuerySchema,
  transactionSchema,
  virtualAccountSchema,
} from '@safezone/schemas';
import type { Request } from 'express';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DomainError } from '../../common/errors/domain-error';
import { PaymentsService } from './payments.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

function requireIdempotencyKey(key: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(key);
  if (!parsed.success)
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header (a UUID)',
      400,
    );
  return parsed.data;
}

/** Provider webhooks and the bank list (payments.md §5). */
@Controller('v1')
export class PaymentsPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhooks/payments/:provider')
  @Public()
  @HttpCode(200)
  @Contract({
    summary: 'Payment provider webhook (signature-verified, idempotent)',
    tags: ['payments'],
    params: providerParamSchema,
    response: z.object({ received: z.literal(true) }),
    errors: [401, 404],
  })
  async webhook(
    @Param('provider') provider: string,
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    await this.payments.receiveWebhook(
      provider,
      request.rawBody,
      request.headers as Record<string, string | string[] | undefined>,
      request.body as unknown,
    );
    return { received: true as const };
  }

  @Get('payments/banks')
  @SignedIn()
  @Contract({
    summary: 'Nigerian banks the provider can settle to',
    tags: ['payments'],
    response: z.array(bankSchema),
    errors: [502],
  })
  banks() {
    return this.payments.banks();
  }
}

/** Estate payments: payout setup, checkout, transfers, office payments and refunds. */
@Controller('v1/estates/:estateId')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payout-account')
  @Can('estate.configure')
  @RequiresFeature('payments')
  @Contract({
    summary: "Link the estate's bank account (settlement goes straight to it)",
    tags: ['payments'],
    params: estateParamSchema,
    body: payoutAccountSetupSchema,
    response: payoutAccountSchema,
    status: 201,
    errors: [403, 422, 502],
  })
  setupPayout(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof payoutAccountSetupSchema>,
  ) {
    return this.payments.setupPayout(estate, body);
  }

  @Get('payout-account')
  @Can('estate.configure')
  @RequiresFeature('payments')
  @Contract({
    summary: "The estate's active payout account (last 4 digits only)",
    tags: ['payments'],
    params: estateParamSchema,
    response: payoutAccountSchema,
    errors: [404],
  })
  payoutAccount(@CurrentEstate() estate: EstateAccess) {
    return this.payments.payoutAccount(estate);
  }

  @Post('payment-intents')
  @Can('payment.make')
  @RequiresFeature('payments')
  @Contract({
    summary: 'Start checkout for my open invoices (Idempotency-Key required)',
    tags: ['payments'],
    params: estateParamSchema,
    body: createPaymentIntentSchema,
    response: paymentIntentSchema,
    status: 201,
    errors: [403, 422, 502],
  })
  createIntent(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPaymentIntentSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.payments.createIntent(estate, body, requireIdempotencyKey(key));
  }

  @Get('payment-intents/:id')
  @Member()
  @RequiresFeature('payments')
  @Contract({
    summary: 'Payment status (the payer, or staff who reconcile)',
    tags: ['payments'],
    params: estateItemParamsSchema,
    response: paymentIntentSchema,
    errors: [404],
  })
  intent(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.payments.intent(estate, params.id);
  }

  @Post('payment-intents/:id/verify')
  @Member()
  @RequiresFeature('payments')
  @HttpCode(200)
  @Contract({
    summary: 'Check a payment with the provider now (after returning from checkout)',
    tags: ['payments'],
    params: estateItemParamsSchema,
    response: paymentIntentSchema,
    errors: [404, 502],
  })
  verify(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.payments.verifyIntent(estate, params.id);
  }

  @Get('transactions')
  @Member()
  @RequiresFeature('payments')
  @Contract({
    summary: 'Verified payments (staff who reconcile: all; residents: their own)',
    tags: ['payments'],
    params: estateParamSchema,
    query: transactionListQuerySchema,
    response: transactionSchema,
    paginated: true,
  })
  transactions(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof transactionListQuerySchema>,
  ) {
    return this.payments.transactions(estate, query);
  }

  @Post('virtual-accounts')
  @Can('payment.make')
  @RequiresFeature('payments')
  @Contract({
    summary: 'Get a dedicated bank transfer account for a unit I pay for',
    tags: ['payments'],
    params: estateParamSchema,
    body: createVirtualAccountSchema,
    response: virtualAccountSchema,
    status: 201,
    errors: [403, 422, 502],
  })
  createVirtualAccount(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createVirtualAccountSchema>,
  ) {
    return this.payments.createVirtualAccount(estate, body.spaceId);
  }

  @Get('virtual-accounts/mine')
  @Can('payment.make')
  @RequiresFeature('payments')
  @Contract({
    summary: 'My transfer accounts in this estate',
    tags: ['payments'],
    params: estateParamSchema,
    response: z.array(virtualAccountSchema),
  })
  myVirtualAccounts(@CurrentEstate() estate: EstateAccess) {
    return this.payments.virtualAccounts(estate);
  }

  @Post('manual-payments')
  @Can('payment.reconcile')
  @RequiresFeature('payments')
  @Contract({
    summary: 'Record a payment received at the office (needs a second approver)',
    tags: ['payments'],
    params: estateParamSchema,
    body: createManualPaymentSchema,
    response: manualPaymentSchema,
    status: 201,
    errors: [403],
  })
  recordManual(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createManualPaymentSchema>,
  ) {
    return this.payments.recordManual(estate, body);
  }

  @Get('manual-payments')
  // Approvers read office payments too, so they can see what they are approving.
  @Can('payment.reconcile', 'billing.run.approve')
  @RequiresFeature('payments')
  @Contract({
    summary: 'Office payments',
    tags: ['payments'],
    params: estateParamSchema,
    query: manualPaymentListQuerySchema,
    response: z.array(manualPaymentSchema),
  })
  manualPayments(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof manualPaymentListQuerySchema>,
  ) {
    return this.payments.manualPayments(estate, query);
  }

  @Post('manual-payments/:id/approve')
  @Can('billing.run.approve')
  @RequiresFeature('payments')
  @HttpCode(200)
  @Contract({
    summary: 'Approve an office payment and apply it to invoices',
    tags: ['payments'],
    params: estateItemParamsSchema,
    body: optionalDecisionSchema,
    response: manualPaymentSchema,
    errors: [403, 404, 409],
  })
  approveManual(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof optionalDecisionSchema>,
  ) {
    return this.payments.decideManual(estate, params.id, 'approve', body.reason ?? null);
  }

  @Post('manual-payments/:id/reject')
  @Can('billing.run.approve')
  @RequiresFeature('payments')
  @HttpCode(200)
  @Contract({
    summary: 'Reject an office payment with a reason',
    tags: ['payments'],
    params: estateItemParamsSchema,
    body: decisionReasonSchema,
    response: manualPaymentSchema,
    errors: [403, 404, 409],
  })
  rejectManual(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof decisionReasonSchema>,
  ) {
    return this.payments.decideManual(estate, params.id, 'reject', body.reason);
  }

  @Post('refunds')
  @Can('payment.refund')
  @RequiresFeature('payments')
  @Contract({
    summary: "Request a refund from a payer's unallocated credit",
    tags: ['payments'],
    params: estateParamSchema,
    body: createRefundSchema,
    response: refundSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  requestRefund(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createRefundSchema>,
  ) {
    return this.payments.requestRefund(estate, body);
  }

  @Get('refunds')
  @Can('payment.refund', 'billing.run.approve')
  @RequiresFeature('payments')
  @Contract({
    summary: 'Refunds',
    tags: ['payments'],
    params: estateParamSchema,
    query: refundListQuerySchema,
    response: z.array(refundSchema),
  })
  refunds(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof refundListQuerySchema>,
  ) {
    return this.payments.refunds(estate, query);
  }

  @Post('refunds/:id/approve')
  @Can('billing.run.approve')
  @RequiresFeature('payments')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a refund (not by the requester) and send it to the provider',
    tags: ['payments'],
    params: estateItemParamsSchema,
    body: optionalDecisionSchema,
    response: refundSchema,
    errors: [403, 404, 409, 422],
  })
  approveRefund(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof optionalDecisionSchema>,
  ) {
    return this.payments.decideRefund(estate, params.id, 'approve', body.reason ?? null);
  }

  @Post('refunds/:id/reject')
  @Can('billing.run.approve')
  @RequiresFeature('payments')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a refund with a reason',
    tags: ['payments'],
    params: estateItemParamsSchema,
    body: decisionReasonSchema,
    response: refundSchema,
    errors: [403, 404, 409],
  })
  rejectRefund(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof decisionReasonSchema>,
  ) {
    return this.payments.decideRefund(estate, params.id, 'reject', body.reason);
  }
}
