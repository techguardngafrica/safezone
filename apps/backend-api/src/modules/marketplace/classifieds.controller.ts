import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  classifiedListQuerySchema,
  classifiedSchema,
  classifiedThreadSchema,
  createClassifiedSchema,
  estateItemParamsSchema,
  estateParamSchema,
  hideClassifiedSchema,
  postClassifiedMessageSchema,
  updateClassifiedSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { ClassifiedsService } from './classifieds.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;
const TAGS = ['marketplace'];

/** Estate classifieds (ADR-0023): residents sell to neighbours; staff moderate. */
@Controller('v1/estates/:estateId/classifieds')
export class ClassifiedsController {
  constructor(private readonly classifieds: ClassifiedsService) {}

  @Get()
  @Can('marketplace.use', 'marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Active classifieds in the estate (or mine, or by status for moderators)',
    tags: TAGS,
    params: estateParamSchema,
    query: classifiedListQuerySchema,
    response: classifiedSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof classifiedListQuerySchema>,
  ) {
    return this.classifieds.list(estate, query);
  }

  @Post()
  @Can('marketplace.sell')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Post an item or service for sale in the estate',
    tags: TAGS,
    params: estateParamSchema,
    body: createClassifiedSchema,
    response: classifiedSchema,
    status: 201,
    errors: [403, 409, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createClassifiedSchema>,
  ) {
    return this.classifieds.create(estate, body);
  }

  @Get(':id')
  @Can('marketplace.use', 'marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'A classified listing',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: classifiedSchema,
    errors: [404],
  })
  get(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.classifieds.get(estate, params.id);
  }

  @Patch(':id')
  @Can('marketplace.sell')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Change my listing, mark it sold, withdraw or renew it',
    tags: TAGS,
    params: estateItemParamsSchema,
    body: updateClassifiedSchema,
    response: classifiedSchema,
    errors: [403, 404],
  })
  update(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateClassifiedSchema>,
  ) {
    return this.classifieds.update(estate, params.id, body);
  }

  @Post(':id/hide')
  @Can('marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Hide a listing that breaks the estate rules',
    tags: TAGS,
    params: estateItemParamsSchema,
    body: hideClassifiedSchema,
    response: classifiedSchema,
    status: 200,
    errors: [403, 404],
  })
  hide(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof hideClassifiedSchema>,
  ) {
    return this.classifieds.hide(estate, params.id, body.reason);
  }

  @Post(':id/restore')
  @Can('marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Restore a hidden listing',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: classifiedSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  restore(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.classifieds.restore(estate, params.id);
  }

  @Get(':id/messages')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Enquiries on a listing (the seller sees every buyer; a buyer sees their own)',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: z.array(classifiedThreadSchema),
    errors: [404],
  })
  threads(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.classifieds.threads(estate, params.id);
  }

  @Post(':id/messages')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Ask the seller, or reply to a buyer',
    tags: TAGS,
    params: estateItemParamsSchema,
    body: postClassifiedMessageSchema,
    response: z.array(classifiedThreadSchema),
    status: 201,
    errors: [404, 409, 422],
  })
  postMessage(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof postClassifiedMessageSchema>,
  ) {
    return this.classifieds.postMessage(estate, params.id, body);
  }
}
