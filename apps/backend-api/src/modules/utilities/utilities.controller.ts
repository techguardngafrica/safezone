import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  createMeterSchema,
  createOutageSchema,
  estateItemParamsSchema,
  estateParamSchema,
  meterListQuerySchema,
  meterLookupResultSchema,
  meterLookupSchema,
  meterReadingsResultSchema,
  meterReadingsSchema,
  meterSchema,
  outageListQuerySchema,
  outageSchema,
  updateOutageSchema,
  utilityProviderSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { UtilitiesService } from './utilities.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Utilities (utilities.md §6). Feature: billing (estate-run supply is billed through it). */
@Controller('v1/estates/:estateId')
export class UtilitiesController {
  constructor(private readonly utilities: UtilitiesService) {}

  @Get('utility-providers')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'Providers meters can be registered with',
    tags: ['utilities'],
    params: estateParamSchema,
    response: z.array(utilityProviderSchema),
  })
  providers() {
    return this.utilities.providers();
  }

  @Post('meters/lookup')
  @Member()
  @RequiresFeature('billing')
  @HttpCode(200)
  @Contract({
    summary: 'Check a meter with its provider (shows the account name to confirm)',
    tags: ['utilities'],
    params: estateParamSchema,
    body: meterLookupSchema,
    response: meterLookupResultSchema,
    errors: [404, 422, 502],
  })
  lookup(@ValidBody() body: z.infer<typeof meterLookupSchema>) {
    return this.utilities.lookup(body);
  }

  @Post('meters')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'Register a meter for a unit',
    tags: ['utilities'],
    params: estateParamSchema,
    body: createMeterSchema,
    response: meterSchema,
    status: 201,
    errors: [403, 404, 409, 422, 502],
  })
  createMeter(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMeterSchema>,
  ) {
    return this.utilities.createMeter(estate, body);
  }

  @Get('meters')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'Meters (management: all; residents: their units’)',
    tags: ['utilities'],
    params: estateParamSchema,
    query: meterListQuerySchema,
    response: z.array(meterSchema),
  })
  meters(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof meterListQuerySchema>,
  ) {
    return this.utilities.meters(estate, query);
  }

  @Delete('meters/:id')
  @Member()
  @RequiresFeature('billing')
  @HttpCode(204)
  @Contract({
    summary: 'Remove a meter',
    tags: ['utilities'],
    params: estateItemParamsSchema,
    errors: [403, 404],
  })
  async removeMeter(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    await this.utilities.removeMeter(estate, params.id);
  }

  @Post('meter-readings')
  @Member()
  @RequiresFeature('billing')
  @Contract({
    summary: 'Record meter readings in bulk (management)',
    tags: ['utilities'],
    params: estateParamSchema,
    body: meterReadingsSchema,
    response: meterReadingsResultSchema,
    status: 201,
    errors: [403],
  })
  readings(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof meterReadingsSchema>,
  ) {
    return this.utilities.recordReadings(estate, body);
  }

  @Post('utility-outages')
  @Can('announcement.publish')
  @RequiresFeature('announcements')
  @Contract({
    summary: 'Announce an outage to affected residents',
    tags: ['utilities'],
    params: estateParamSchema,
    body: createOutageSchema,
    response: outageSchema,
    status: 201,
    errors: [403, 404],
  })
  announce(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createOutageSchema>,
  ) {
    return this.utilities.announceOutage(estate, body);
  }

  @Get('utility-outages')
  @Member()
  @RequiresFeature('announcements')
  @Contract({
    summary: 'Outages (residents: those affecting them)',
    tags: ['utilities'],
    params: estateParamSchema,
    query: outageListQuerySchema,
    response: z.array(outageSchema),
  })
  outages(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof outageListQuerySchema>,
  ) {
    return this.utilities.outages(estate, query);
  }

  @Patch('utility-outages/:id')
  @Can('announcement.publish')
  @RequiresFeature('announcements')
  @Contract({
    summary: 'Resolve, cancel or update an outage',
    tags: ['utilities'],
    params: estateItemParamsSchema,
    body: updateOutageSchema,
    response: outageSchema,
    errors: [403, 404, 409],
  })
  updateOutage(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateOutageSchema>,
  ) {
    return this.utilities.updateOutage(estate, params.id, body);
  }
}
