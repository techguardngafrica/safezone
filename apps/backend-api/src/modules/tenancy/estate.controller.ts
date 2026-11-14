import { Controller, Get, Headers, Patch } from '@nestjs/common';
import {
  estateParamSchema,
  estateProfileSchema,
  estateSettingsSchema,
  updateEstateProfileSchema,
  updateEstateSettingsSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess, Member } from '../../common/auth/auth.decorators';
import { Contract, ValidBody } from '../../common/contract/contract';
import { DomainError } from '../../common/errors/domain-error';
import { TenancyService } from './tenancy.service';

function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const value = Number(header.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError('PRECONDITION_FAILED', 'If-Match must be the estate version', 412);
  }
  return value;
}

@Controller('v1/estates/:estateId')
export class EstateController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @Member()
  @Contract({
    summary: 'Estate profile',
    tags: ['estates'],
    params: estateParamSchema,
    response: estateProfileSchema,
  })
  profile(@CurrentEstate() estate: EstateAccess) {
    return this.tenancy.getProfile(estate);
  }

  @Patch()
  @Can('estate.configure')
  @Contract({
    summary: 'Update estate profile (If-Match: version)',
    tags: ['estates'],
    params: estateParamSchema,
    body: updateEstateProfileSchema,
    response: estateProfileSchema,
    errors: [403, 404, 409, 412],
  })
  updateProfile(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof updateEstateProfileSchema>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.tenancy.updateProfile(estate, body, parseIfMatch(ifMatch));
  }

  @Get('settings')
  @Member()
  @Contract({
    summary: 'Estate settings',
    tags: ['estates'],
    params: estateParamSchema,
    response: estateSettingsSchema,
  })
  settings(@CurrentEstate() estate: EstateAccess) {
    return this.tenancy.getSettings(estate);
  }

  @Patch('settings')
  @Can('estate.configure')
  @Contract({
    summary: 'Update estate settings',
    tags: ['estates'],
    params: estateParamSchema,
    body: updateEstateSettingsSchema,
    response: estateSettingsSchema,
    errors: [403, 404],
  })
  updateSettings(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof updateEstateSettingsSchema>,
  ) {
    return this.tenancy.updateSettings(estate, body);
  }
}
