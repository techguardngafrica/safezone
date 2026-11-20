import { Controller, Get } from '@nestjs/common';
import {
  estateParamSchema,
  estateReportQuerySchema,
  estateReportSummarySchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidQuery } from '../../common/contract/contract';
import { ReportsService } from './reports.service';

@Controller('v1/estates/:estateId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @Can('report.read')
  @Contract({
    summary: 'Estate operational, security, attendance and financial report summary',
    tags: ['reports'],
    params: estateParamSchema,
    query: estateReportQuerySchema,
    response: estateReportSummarySchema,
  })
  summary(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof estateReportQuerySchema>,
  ) {
    return this.reports.summary(estate, query);
  }
}
