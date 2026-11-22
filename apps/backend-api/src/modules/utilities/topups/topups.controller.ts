import { Controller, Get, Headers, Post } from '@nestjs/common';
import {
  createTopupSchema,
  dataPlanQuerySchema,
  dataPlanSchema,
  estateItemParamsSchema,
  estateParamSchema,
  idempotencyKeySchema,
  topupLimitsSchema,
  topupListQuerySchema,
  topupSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../../common/contract/contract';
import { DomainError } from '../../../common/errors/domain-error';
import { TopupsService } from './topups.service';

const TAGS = ['utilities'];

/** Airtime and data (ADR-0025). Sold by Safezone; delivered only after the payment is verified. */
@Controller('v1/estates/:estateId/topups')
export class TopupsController {
  constructor(private readonly topups: TopupsService) {}

  @Get('limits')
  @Can('payment.make')
  @Contract({
    summary: 'Whether airtime and data can be bought, and the airtime limits',
    tags: TAGS,
    params: estateParamSchema,
    response: topupLimitsSchema,
  })
  limits() {
    return this.topups.limits();
  }

  @Get('data-plans')
  @Can('payment.make')
  @Contract({
    summary: 'Data plans for a network (prices from the aggregator)',
    tags: TAGS,
    params: estateParamSchema,
    query: dataPlanQuerySchema,
    response: z.array(dataPlanSchema),
    errors: [502, 503],
  })
  plans(@ValidQuery() query: z.infer<typeof dataPlanQuerySchema>) {
    return this.topups.dataPlans(query.network);
  }

  @Post()
  @Can('payment.make')
  @Contract({
    summary: 'Buy airtime or data (Idempotency-Key required)',
    tags: TAGS,
    params: estateParamSchema,
    body: createTopupSchema,
    response: topupSchema,
    status: 201,
    errors: [402, 422, 502, 503],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createTopupSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success)
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header (a UUID)',
        400,
      );
    return this.topups.create(estate, body, parsed.data);
  }

  @Get()
  @Can('payment.make')
  @Contract({
    summary: 'My airtime and data purchases',
    tags: TAGS,
    params: estateParamSchema,
    query: topupListQuerySchema,
    response: topupSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof topupListQuerySchema>,
  ) {
    return this.topups.list(estate, query);
  }

  @Get(':id')
  @Can('payment.make')
  @Contract({
    summary: 'One purchase',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: topupSchema,
    errors: [404],
  })
  get(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.topups.get(estate, params.id);
  }

  @Post(':id/verify')
  @Can('payment.make')
  @Contract({
    summary: 'Check the payment with the provider after checkout',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: topupSchema,
    status: 200,
    errors: [404],
  })
  verify(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.topups.verify(estate, params.id);
  }
}
