import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  bulkImportDryRunSchema,
  bulkImportJobSchema,
  bulkImportTemplateParamsSchema,
  bulkImportTemplateSchema,
  estateItemParamsSchema,
  estateParamSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { ImportsService } from './imports.service';

@Controller('v1/estates/:estateId/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('templates/:kind')
  @Can('import.run')
  @Contract({
    summary: 'Download a CSV template for bulk import',
    tags: ['imports'],
    params: bulkImportTemplateParamsSchema,
    response: bulkImportTemplateSchema,
  })
  template(@ValidParams() params: z.infer<typeof bulkImportTemplateParamsSchema>) {
    return this.imports.template(params.kind);
  }

  @Get()
  @Can('import.run')
  @Contract({
    summary: 'List recent bulk import jobs',
    tags: ['imports'],
    params: estateParamSchema,
    response: z.array(bulkImportJobSchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.imports.list(estate);
  }

  @Get(':id')
  @Can('import.run')
  @Contract({
    summary: 'Get bulk import job status and row errors',
    tags: ['imports'],
    params: estateItemParamsSchema,
    response: bulkImportJobSchema,
    errors: [404],
  })
  get(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.imports.get(estate, params.id);
  }

  @Post('dry-run')
  @Can('import.run')
  @Contract({
    summary: 'Validate a CSV upload and return row-by-row dry-run results',
    tags: ['imports'],
    params: estateParamSchema,
    body: bulkImportDryRunSchema,
    response: bulkImportJobSchema,
    status: 201,
    errors: [422],
  })
  dryRun(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof bulkImportDryRunSchema>,
  ) {
    return this.imports.dryRun(estate, body);
  }

  @Post(':id/confirm')
  @Can('import.run')
  @HttpCode(200)
  @Contract({
    summary: 'Execute a validated bulk import job idempotently',
    tags: ['imports'],
    params: estateItemParamsSchema,
    response: bulkImportJobSchema,
    errors: [404, 409],
  })
  confirm(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.imports.confirm(estate, params.id);
  }
}
