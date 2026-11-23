import { Controller, Delete, Get, Post } from '@nestjs/common';
import {
  createReportScheduleSchema,
  estateDashboardSchema,
  estateParamSchema,
  ingestProductEventsSchema,
  platformKpisSchema,
  reportScheduleSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentAuth,
  CurrentEstate,
  SignedIn,
  type AuthContext,
  type EstateAccess,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { AnalyticsService } from './analytics.service';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dashboardQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
const scheduleParamSchema = estateParamSchema.extend({ id: z.uuid() });

@Controller('v1')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('estates/:estateId/dashboard')
  @Can('report.read')
  @Contract({
    summary: 'Estate analytics dashboard widgets from event-driven read models',
    tags: ['analytics'],
    params: estateParamSchema,
    query: dashboardQuerySchema,
    response: estateDashboardSchema,
  })
  dashboard(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof dashboardQuerySchema>,
  ) {
    return this.analytics.estateDashboard(estate, query.from, query.to);
  }

  @Get('estates/:estateId/report-schedules')
  @Can('analytics.schedule.manage', 'report.read')
  @Contract({
    summary: 'List scheduled estate email reports',
    tags: ['analytics'],
    params: estateParamSchema,
    response: z.array(reportScheduleSchema),
  })
  listSchedules(@CurrentEstate() estate: EstateAccess) {
    return this.analytics.listReportSchedules(estate);
  }

  @Post('estates/:estateId/report-schedules')
  @Can('analytics.schedule.manage')
  @Contract({
    summary: 'Create a scheduled estate email report',
    tags: ['analytics'],
    params: estateParamSchema,
    body: createReportScheduleSchema,
    response: reportScheduleSchema,
    status: 201,
  })
  createSchedule(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createReportScheduleSchema>,
  ) {
    return this.analytics.createReportSchedule(estate, body);
  }

  @Delete('estates/:estateId/report-schedules/:id')
  @Can('analytics.schedule.manage')
  @Contract({
    summary: 'Delete a scheduled estate email report',
    tags: ['analytics'],
    params: scheduleParamSchema,
    response: z.object({ deleted: z.literal(true), id: z.uuid() }),
    errors: [404],
  })
  deleteSchedule(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof scheduleParamSchema>,
  ) {
    return this.analytics.deleteReportSchedule(estate, params.id);
  }

  @Post('analytics/events')
  @SignedIn()
  @Contract({
    summary: 'Ingest privacy-safe batched product analytics events (max 50)',
    tags: ['analytics'],
    body: ingestProductEventsSchema,
    response: z.object({ accepted: z.number().int() }),
    status: 201,
  })
  ingestEvents(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof ingestProductEventsSchema>,
  ) {
    return this.analytics.ingestProductEvents(auth, body);
  }

  @Get('platform/kpis')
  @Can('platform.analytics.read')
  @Contract({
    summary: 'Platform-wide KPIs and success indicators with small-number suppression',
    tags: ['analytics'],
    response: platformKpisSchema,
  })
  platformKpis() {
    return this.analytics.platformKpis();
  }
}
