import { Controller, Get, Post } from '@nestjs/common';
import {
  estateExportSchema,
  estateItemParamsSchema,
  estateParamSchema,
  exportDownloadSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../../common/auth/auth.decorators';
import { Contract, ValidParams } from '../../../common/contract/contract';
import { ExportsService } from './exports.service';

/** Estate data export (platform.md §7): estate owners and administrators. */
@Controller('v1/estates/:estateId')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('exports')
  @Can('estate.configure')
  @Contract({
    summary: 'Request a full data export (ZIP of CSV and JSON)',
    tags: ['platform'],
    params: estateParamSchema,
    response: estateExportSchema,
    status: 201,
    errors: [403, 409],
  })
  request(@CurrentEstate() estate: EstateAccess) {
    return this.exports.request(estate);
  }

  @Get('exports')
  @Can('estate.configure')
  @Contract({
    summary: 'Recent exports',
    tags: ['platform'],
    params: estateParamSchema,
    response: z.array(estateExportSchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.exports.list(estate);
  }

  @Post('exports/:id/download')
  @Can('estate.configure')
  @Contract({
    summary: 'A 15-minute download link for a ready export (audited)',
    tags: ['platform'],
    params: estateItemParamsSchema,
    response: exportDownloadSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  download(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.exports.download(estate, params.id);
  }
}
