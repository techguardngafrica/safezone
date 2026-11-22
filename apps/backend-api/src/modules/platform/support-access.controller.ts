import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  estateItemParamsSchema,
  estateParamSchema,
  platformSupportSessionListQuerySchema,
  platformSupportSessionSchema,
  requestSupportSessionSchema,
  supportSessionDecisionSchema,
  supportSessionSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  type AuthContext,
  Can,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { SupportAccessService } from './support-access.service';

@Controller('v1/estates/:estateId/support-sessions')
export class EstateSupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get()
  @Can('estate.configure')
  @Contract({
    summary: 'List Techguard support-access requests and history for this estate',
    tags: ['tenancy'],
    params: estateParamSchema,
    response: z.array(supportSessionSchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.support.listForEstate(estate);
  }

  @Post(':id/approve')
  @Can('estate.configure')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a Techguard support-access request',
    tags: ['tenancy'],
    params: estateItemParamsSchema,
    body: supportSessionDecisionSchema,
    response: supportSessionSchema,
    errors: [404, 409],
  })
  approve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.support.approve(estate, params.id, body);
  }

  @Post(':id/deny')
  @Can('estate.configure')
  @HttpCode(200)
  @Contract({
    summary: 'Deny a Techguard support-access request',
    tags: ['tenancy'],
    params: estateItemParamsSchema,
    body: supportSessionDecisionSchema,
    response: supportSessionSchema,
    errors: [404, 409],
  })
  deny(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.support.deny(estate, params.id, body);
  }

  @Post(':id/revoke')
  @Can('estate.configure')
  @HttpCode(200)
  @Contract({
    summary: 'Revoke an active Techguard support session immediately',
    tags: ['tenancy'],
    params: estateItemParamsSchema,
    body: supportSessionDecisionSchema,
    response: supportSessionSchema,
    errors: [404, 409],
  })
  revoke(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.support.revoke(estate, params.id, body);
  }
}

/**
 * Platform side (platform.md §5). No `:estateId` in the path: the agent is not a member, so estate
 * routes would refuse them before the request exists.
 */
@Controller('v1/platform/support-sessions')
export class PlatformSupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get()
  @Can('platform.support_access')
  @Contract({
    summary: 'List platform support-access sessions across estates (newest first)',
    tags: ['platform'],
    query: platformSupportSessionListQuerySchema,
    response: platformSupportSessionSchema,
    paginated: true,
  })
  list(@ValidQuery() query: z.infer<typeof platformSupportSessionListQuerySchema>) {
    return this.support.listForPlatform(query);
  }

  @Post()
  @Can('platform.support_access')
  @Contract({
    summary: 'Request time-bounded, read-only support access to an estate (needs estate consent)',
    tags: ['platform'],
    body: requestSupportSessionSchema,
    response: supportSessionSchema,
    status: 201,
    errors: [404],
  })
  request(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof requestSupportSessionSchema>,
  ) {
    return this.support.requestAccess(auth, body.estateId, body);
  }
}
