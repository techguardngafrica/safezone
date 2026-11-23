import { Controller, Get, Patch, Post, Put } from '@nestjs/common';
import {
  breachSchema,
  createBreachSchema,
  createDpiaRecordSchema,
  createDsrSchema,
  dpiaRecordSchema,
  dsrListQuerySchema,
  dsrSchema,
  idParamSchema,
  retentionRuleSchema,
  updateBreachSchema,
  updateDpiaRecordSchema,
  updateDsrSchema,
  upsertRetentionRuleSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { ComplianceService } from './compliance.service';

@Controller('v1/platform')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('dsr')
  @Can('platform.compliance')
  @Contract({
    summary: 'List data subject requests (newest first)',
    tags: ['platform'],
    query: dsrListQuerySchema,
    response: dsrSchema,
    paginated: true,
  })
  listDsrs(@ValidQuery() query: z.infer<typeof dsrListQuerySchema>) {
    return this.compliance.listDsrs(query);
  }

  @Post('dsr')
  @Can('platform.compliance')
  @Contract({
    summary: 'Log a new data subject request (30-day NDPA clock)',
    tags: ['platform'],
    body: createDsrSchema,
    response: dsrSchema,
    status: 201,
  })
  createDsr(@CurrentAuth() auth: AuthContext, @ValidBody() body: z.infer<typeof createDsrSchema>) {
    return this.compliance.createDsr(auth.userId, body);
  }

  @Patch('dsr/:id')
  @Can('platform.compliance')
  @Contract({
    summary: 'Update DSR status, identity check or notes',
    tags: ['platform'],
    params: idParamSchema,
    body: updateDsrSchema,
    response: dsrSchema,
    errors: [404],
  })
  updateDsr(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateDsrSchema>,
  ) {
    return this.compliance.updateDsr(auth.userId, params.id, body);
  }

  @Get('breaches')
  @Can('platform.compliance')
  @Contract({
    summary: 'List security and privacy breach records',
    tags: ['platform'],
    response: z.array(breachSchema),
  })
  listBreaches() {
    return this.compliance.listBreaches();
  }

  @Post('breaches')
  @Can('platform.compliance')
  @Contract({
    summary: 'Log a breach (72-hour NDPC notification tracking)',
    tags: ['platform'],
    body: createBreachSchema,
    response: breachSchema,
    status: 201,
  })
  createBreach(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createBreachSchema>,
  ) {
    return this.compliance.createBreach(auth.userId, body);
  }

  @Patch('breaches/:id')
  @Can('platform.compliance')
  @Contract({
    summary: 'Update breach status or mark NDPC / subjects notified',
    tags: ['platform'],
    params: idParamSchema,
    body: updateBreachSchema,
    response: breachSchema,
    errors: [404],
  })
  updateBreach(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateBreachSchema>,
  ) {
    return this.compliance.updateBreach(auth.userId, params.id, body);
  }

  @Get('retention-rules')
  @Can('platform.compliance')
  @Contract({
    summary: 'List data retention schedule rules',
    tags: ['platform'],
    response: z.array(retentionRuleSchema),
  })
  listRetentionRules() {
    return this.compliance.listRetentionRules();
  }

  @Put('retention-rules')
  @Can('platform.compliance')
  @Contract({
    summary: 'Create or update a data retention rule',
    tags: ['platform'],
    body: upsertRetentionRuleSchema,
    response: retentionRuleSchema,
  })
  upsertRetentionRule(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof upsertRetentionRuleSchema>,
  ) {
    return this.compliance.upsertRetentionRule(auth.userId, body);
  }

  @Get('dpia')
  @Can('platform.compliance')
  @Contract({
    summary: 'List DPIA records (newest first)',
    tags: ['platform'],
    response: z.array(dpiaRecordSchema),
  })
  listDpias() {
    return this.compliance.listDpias();
  }

  @Post('dpia')
  @Can('platform.compliance')
  @Contract({
    summary: 'Log a Data Protection Impact Assessment (DPIA) record',
    tags: ['platform'],
    body: createDpiaRecordSchema,
    response: dpiaRecordSchema,
    status: 201,
  })
  createDpia(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createDpiaRecordSchema>,
  ) {
    return this.compliance.createDpia(auth.userId, body);
  }

  @Patch('dpia/:id')
  @Can('platform.compliance')
  @Contract({
    summary: 'Update a DPIA record or mark it approved',
    tags: ['platform'],
    params: idParamSchema,
    body: updateDpiaRecordSchema,
    response: dpiaRecordSchema,
    errors: [404],
  })
  updateDpia(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateDpiaRecordSchema>,
  ) {
    return this.compliance.updateDpia(auth.userId, params.id, body);
  }
}
