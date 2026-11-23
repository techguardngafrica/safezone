import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  addCompanyGuardSchema,
  companyGuardSchema,
  createPatrolRouteSchema,
  createSecurityCompanySchema,
  createSecurityContractSchema,
  estateParamSchema,
  patrolLogSchema,
  patrolRouteSchema,
  patrolRunSchema,
  scanCheckpointSchema,
  securityCompanySchema,
  securityContractSchema,
  startPatrolRunSchema,
  syncPatrolScansSchema,
  updateSecurityCompanySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentAuth,
  CurrentEstate,
  type AuthContext,
  type EstateAccess,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { SecurityDepthService } from './security-depth.service';

const idParamSchema = z.object({ id: z.uuid() });
const estateItemParamSchema = estateParamSchema.extend({ id: z.uuid() });

@Controller('v1/platform/security-companies')
export class PlatformSecurityCompaniesController {
  constructor(private readonly service: SecurityDepthService) {}

  @Get()
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'List platform-level security companies',
    tags: ['platform-security'],
    response: z.array(securityCompanySchema),
  })
  listCompanies() {
    return this.service.listCompanies();
  }

  @Post()
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'Register a cross-estate security company',
    tags: ['platform-security'],
    body: createSecurityCompanySchema,
    response: securityCompanySchema,
    status: 201,
  })
  createCompany(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createSecurityCompanySchema>,
  ) {
    return this.service.createCompany(auth.userId, body);
  }

  @Patch(':id')
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'Update or suspend a security company',
    tags: ['platform-security'],
    params: idParamSchema,
    body: updateSecurityCompanySchema,
    response: securityCompanySchema,
    errors: [404],
  })
  updateCompany(
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateSecurityCompanySchema>,
  ) {
    return this.service.updateCompany(params.id, body);
  }

  @Get(':id/guards')
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'List guards registered under a security company',
    tags: ['platform-security'],
    params: idParamSchema,
    response: z.array(companyGuardSchema),
  })
  listGuards(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.service.listCompanyGuards(params.id);
  }

  @Post(':id/guards')
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'Register a guard under a security company',
    tags: ['platform-security'],
    params: idParamSchema,
    body: addCompanyGuardSchema,
    response: companyGuardSchema,
    status: 201,
    errors: [404],
  })
  addGuard(
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof addCompanyGuardSchema>,
  ) {
    return this.service.addCompanyGuard(params.id, body);
  }

  @Post('contracts')
  @Can('platform.security_company.manage')
  @Contract({
    summary: 'Link a security company to an estate via a pending contract',
    tags: ['platform-security'],
    body: createSecurityContractSchema,
    response: securityContractSchema,
    status: 201,
    errors: [404],
  })
  createContract(@ValidBody() body: z.infer<typeof createSecurityContractSchema>) {
    return this.service.createContract(body);
  }
}

@Controller('v1/estates/:estateId')
export class PatrolsController {
  constructor(private readonly service: SecurityDepthService) {}

  @Get('security-contracts')
  @Can('patrol.manage', 'security.staff.manage')
  @Contract({
    summary: 'List security company contracts for this estate',
    tags: ['security'],
    params: estateParamSchema,
    response: z.array(securityContractSchema),
  })
  listEstateContracts(@CurrentEstate() estate: EstateAccess) {
    return this.service.listEstateContracts(estate.estateId);
  }

  @Post('security-contracts/:id/approve')
  @Can('patrol.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a pending security company contract for this estate',
    tags: ['security'],
    params: estateItemParamSchema,
    response: securityContractSchema,
    errors: [404],
  })
  approveContract(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamSchema>,
  ) {
    return this.service.updateEstateContractStatus(estate, params.id, 'active');
  }

  @Post('security-contracts/:id/terminate')
  @Can('patrol.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Terminate an estate security company contract',
    tags: ['security'],
    params: estateItemParamSchema,
    response: securityContractSchema,
    errors: [404],
  })
  terminateContract(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamSchema>,
  ) {
    return this.service.updateEstateContractStatus(estate, params.id, 'terminated');
  }

  @Get('patrol-routes')
  @Can('patrol.scan', 'patrol.manage')
  @Contract({
    summary: 'List patrol routes and their QR/NFC checkpoints',
    tags: ['security'],
    params: estateParamSchema,
    response: z.array(patrolRouteSchema),
  })
  listRoutes(@CurrentEstate() estate: EstateAccess) {
    return this.service.listPatrolRoutes(estate);
  }

  @Post('patrol-routes')
  @Can('patrol.manage')
  @Contract({
    summary: 'Create a patrol route with ordered QR/NFC checkpoints',
    tags: ['security'],
    params: estateParamSchema,
    body: createPatrolRouteSchema,
    response: patrolRouteSchema,
    status: 201,
  })
  createRoute(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPatrolRouteSchema>,
  ) {
    return this.service.createPatrolRoute(estate, body);
  }

  @Get('patrol-runs')
  @Can('patrol.scan', 'patrol.manage')
  @Contract({
    summary: 'List patrol runs and checkpoint scan logs',
    tags: ['security'],
    params: estateParamSchema,
    response: z.array(patrolRunSchema),
  })
  listRuns(@CurrentEstate() estate: EstateAccess) {
    return this.service.listPatrolRuns(estate);
  }

  @Post('patrol-runs')
  @Can('patrol.scan')
  @Contract({
    summary: 'Start a patrol run on a route',
    tags: ['security'],
    params: estateParamSchema,
    body: startPatrolRunSchema,
    response: patrolRunSchema,
    status: 201,
    errors: [404],
  })
  startRun(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof startPatrolRunSchema>,
  ) {
    return this.service.startPatrolRun(estate, body);
  }

  @Post('patrol-runs/:id/scan')
  @Can('patrol.scan')
  @Contract({
    summary: 'Record a QR/NFC checkpoint scan on an active patrol run',
    tags: ['security'],
    params: estateItemParamSchema,
    body: scanCheckpointSchema,
    response: patrolLogSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  scanCheckpoint(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamSchema>,
    @ValidBody() body: z.infer<typeof scanCheckpointSchema>,
  ) {
    return this.service.scanCheckpoint(estate, params.id, body);
  }

  @Post('patrols/sync')
  @Can('patrol.scan')
  @HttpCode(200)
  @Contract({
    summary: 'Sync offline-recorded patrol checkpoint scans',
    tags: ['security'],
    params: estateParamSchema,
    body: syncPatrolScansSchema,
    response: z.object({ accepted: z.number().int(), total: z.number().int() }),
  })
  syncScans(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof syncPatrolScansSchema>,
  ) {
    return this.service.syncPatrolScans(estate, body);
  }
}
