import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import {
  createUtilityPurchaseSchema,
  estateItemParamsSchema,
  estateParamSchema,
  idempotencyKeySchema,
  utilityPurchaseDetailSchema,
  utilityPurchaseLimitsSchema,
  utilityPurchaseListQuerySchema,
  utilityPurchaseSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../../common/contract/contract';
import { DomainError } from '../../../common/errors/domain-error';
import { PurchasesService } from './purchases.service';

/** Prepaid electricity tokens sold by Safezone (ADR-0018). Not ads, not estate money. */
@Controller('v1/estates/:estateId/utility-purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('limits')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'Whether tokens can be bought now, and the amount limits and fee',
    tags: ['utilities'],
    params: estateParamSchema,
    response: utilityPurchaseLimitsSchema,
  })
  limits() {
    return this.purchases.limits();
  }

  @Post()
  @Can('payment.make')
  @RequiresFeature('billing')
  @Contract({
    summary: 'Start a token purchase for my prepaid meter (Idempotency-Key required)',
    tags: ['utilities'],
    params: estateParamSchema,
    body: createUtilityPurchaseSchema,
    response: utilityPurchaseDetailSchema,
    status: 201,
    errors: [404, 422, 502, 503],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createUtilityPurchaseSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success)
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header (a UUID)',
        400,
      );
    return this.purchases.create(estate, body, parsed.data);
  }

  @Get()
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: "My household's token purchases",
    tags: ['utilities'],
    params: estateParamSchema,
    query: utilityPurchaseListQuerySchema,
    response: utilityPurchaseSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof utilityPurchaseListQuerySchema>,
  ) {
    return this.purchases.list(estate, query);
  }

  @Get(':id')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'A purchase with its token once vended (buyer and household only)',
    tags: ['utilities'],
    params: estateItemParamsSchema,
    response: utilityPurchaseDetailSchema,
    errors: [404],
  })
  detail(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.purchases.detail(estate, params.id);
  }

  @Post(':id/verify')
  @Member()
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Check the payment with the provider now (after returning from checkout)',
    tags: ['utilities'],
    params: estateItemParamsSchema,
    response: utilityPurchaseDetailSchema,
    errors: [404, 502],
  })
  verify(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.purchases.verify(estate, params.id);
  }
}
