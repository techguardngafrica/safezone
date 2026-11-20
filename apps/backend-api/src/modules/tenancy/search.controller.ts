import { Controller, Get } from '@nestjs/common';
import {
  estateParamSchema,
  globalSearchQuerySchema,
  globalSearchResultSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import { CurrentEstate, type EstateAccess, Member } from '../../common/auth/auth.decorators';
import { Contract, ValidQuery } from '../../common/contract/contract';
import { SearchService } from './search.service';

@Controller('v1/estates/:estateId/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Member()
  @Contract({
    summary: 'Global search across units, residents, plates, passes and invoices',
    tags: ['tenancy'],
    params: estateParamSchema,
    query: globalSearchQuerySchema,
    response: globalSearchResultSchema,
  })
  query(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof globalSearchQuerySchema>,
  ) {
    return this.search.search(estate, query);
  }
}
