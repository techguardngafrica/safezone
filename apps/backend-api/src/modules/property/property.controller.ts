import { Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import {
  bulkCreateResultSchema,
  bulkCreateSpacesSchema,
  createSpaceSchema,
  estateParamSchema,
  spaceListQuerySchema,
  spaceParamsSchema,
  spaceSchema,
  unitSearchQuerySchema,
  updateSpaceSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DomainError } from '../../common/errors/domain-error';
import { PropertyService } from './property.service';

function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const value = Number(header.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError('PRECONDITION_FAILED', 'If-Match must be the space version', 412);
  }
  return value;
}

/** Spaces tree (property.md §6). Reads for any member; changes need space.manage. */
@Controller('v1/estates/:estateId')
export class PropertyController {
  constructor(private readonly property: PropertyService) {}

  @Get('spaces')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Browse the spaces tree (children of parentId, or top level)',
    tags: ['property'],
    params: estateParamSchema,
    query: spaceListQuerySchema,
    response: spaceSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof spaceListQuerySchema>,
  ) {
    return this.property.list(estate, query);
  }

  @Post('spaces')
  @Can('space.manage')
  @RequiresFeature('property')
  @Contract({
    summary: 'Create a space',
    tags: ['property'],
    params: estateParamSchema,
    body: createSpaceSchema,
    response: spaceSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createSpaceSchema>,
  ) {
    return this.property.create(estate, body);
  }

  @Post('spaces/bulk')
  @Can('space.manage')
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Create many spaces from a pattern (e.g. floors 1-5, flats A-D); dryRun to preview',
    tags: ['property'],
    params: estateParamSchema,
    body: bulkCreateSpacesSchema,
    response: bulkCreateResultSchema,
    errors: [403, 404, 409, 422],
  })
  bulk(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof bulkCreateSpacesSchema>,
  ) {
    return this.property.bulkCreate(estate, body);
  }

  @Get('spaces/:id')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'One space',
    tags: ['property'],
    params: spaceParamsSchema,
    response: spaceSchema,
    errors: [404],
  })
  get(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof spaceParamsSchema>,
  ) {
    return this.property.get(estate, params.id);
  }

  @Patch('spaces/:id')
  @Can('space.manage')
  @RequiresFeature('property')
  @Contract({
    summary: 'Update or re-parent a space (If-Match: version)',
    tags: ['property'],
    params: spaceParamsSchema,
    body: updateSpaceSchema,
    response: spaceSchema,
    errors: [403, 404, 409, 412, 422],
  })
  update(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof spaceParamsSchema>,
    @ValidBody() body: z.infer<typeof updateSpaceSchema>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.property.update(estate, params.id, body, parseIfMatch(ifMatch));
  }

  @Post('spaces/:id/archive')
  @Can('space.manage')
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Archive a space with nothing inside it',
    tags: ['property'],
    params: spaceParamsSchema,
    response: spaceSchema,
    errors: [403, 404, 409],
  })
  archive(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof spaceParamsSchema>,
  ) {
    return this.property.archive(estate, params.id);
  }

  @Get('units')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Search units (inside a space, by status, by code or name)',
    tags: ['property'],
    params: estateParamSchema,
    query: unitSearchQuerySchema,
    response: spaceSchema,
    paginated: true,
  })
  units(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof unitSearchQuerySchema>,
  ) {
    return this.property.units(estate, query);
  }
}
