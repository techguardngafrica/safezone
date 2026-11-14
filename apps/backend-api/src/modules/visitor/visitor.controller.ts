import { Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  createRestrictedVisitorSchema,
  createVisitorInvitationSchema,
  createWalkinSchema,
  estateItemParamsSchema,
  estateParamSchema,
  expectedListSchema,
  expectedQuerySchema,
  gateEventInputSchema,
  gateEventListQuerySchema,
  gateEventSchema,
  gateSyncResultSchema,
  gateSyncSchema,
  insideItemSchema,
  passListQuerySchema,
  publicPassSchema,
  publicPassTokenParamSchema,
  restrictedVisitorSchema,
  revocationsQuerySchema,
  revocationsSchema,
  revokePassSchema,
  signingKeysSchema,
  verifyCredentialSchema,
  verifyResultSchema,
  visitorPassCredentialsSchema,
  visitorPassSchema,
  walkinSchema,
} from '@safezone/schemas';
import type { Request } from 'express';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { GateService } from './gate.service';
import { PassesService } from './passes.service';

/** The visitor's pass page (public-web /p/:token). No ads, minimum data. */
@Controller('v1/public/passes')
export class PublicPassController {
  constructor(private readonly passes: PassesService) {}

  @Get(':token')
  @Public()
  @Contract({
    summary: 'Visitor pass page data',
    tags: ['visitors'],
    params: publicPassTokenParamSchema,
    response: publicPassSchema,
    errors: [404, 429],
  })
  get(@ValidParams() params: z.infer<typeof publicPassTokenParamSchema>, @Req() request: Request) {
    return this.passes.publicPass(params.token, request.ip);
  }
}

@Controller('v1/estates/:estateId')
export class VisitorController {
  constructor(
    private readonly passes: PassesService,
    private readonly gate: GateService,
  ) {}

  // ---- Hosts -----------------------------------------------------------------------------------

  @Post('visitor-invitations')
  @Member()
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Invite visitors (one pass each, with QR and PIN)',
    tags: ['visitors'],
    params: estateParamSchema,
    body: createVisitorInvitationSchema,
    response: z.array(visitorPassCredentialsSchema),
    status: 201,
    errors: [403, 404, 422],
  })
  invite(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createVisitorInvitationSchema>,
  ) {
    return this.passes.create(estate, body);
  }

  @Get('visitor-passes')
  @Member()
  @RequiresFeature('visitors')
  @Contract({
    summary: "Passes (my household's, or the estate's for management)",
    tags: ['visitors'],
    params: estateParamSchema,
    query: passListQuerySchema,
    response: visitorPassSchema,
    paginated: true,
    errors: [403],
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof passListQuerySchema>,
  ) {
    return this.passes.list(estate, query);
  }

  @Get('visitor-passes/:id')
  @Member()
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Pass with its QR, PIN and link (host household or management)',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    response: visitorPassCredentialsSchema,
    errors: [404],
  })
  get(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.passes.get(estate, params.id);
  }

  @Post('visitor-passes/:id/revoke')
  @Member()
  @RequiresFeature('visitors')
  @HttpCode(200)
  @Contract({
    summary: 'Revoke a pass (immediate online, next sync offline)',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    body: revokePassSchema,
    response: visitorPassSchema,
    errors: [404, 409],
  })
  revoke(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof revokePassSchema>,
  ) {
    return this.passes.revoke(estate, params.id, body.reason);
  }

  @Post('visitor-passes/:id/share')
  @Member()
  @RequiresFeature('visitors')
  @HttpCode(202)
  @Contract({
    summary: 'Send the pass link and PIN to the visitor by SMS',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    response: z.object({ queued: z.literal(true) }),
    errors: [404, 409, 422],
  })
  share(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.passes.share(estate, params.id);
  }

  @Get('walkins/:id')
  @Member()
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Walk-in request status (guard) or detail (household)',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    response: walkinSchema,
    errors: [404],
  })
  walkin(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.gate.walkin(estate, params.id);
  }

  @Post('walkins/:id/approve')
  @Member()
  @RequiresFeature('visitors')
  @HttpCode(200)
  @Contract({
    summary: 'Let a walk-in visitor in',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    response: walkinSchema,
    errors: [404, 409],
  })
  approveWalkin(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.gate.respondWalkin(estate, params.id, 'approved');
  }

  @Post('walkins/:id/reject')
  @Member()
  @RequiresFeature('visitors')
  @HttpCode(200)
  @Contract({
    summary: 'Decline a walk-in visitor',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    response: walkinSchema,
    errors: [404, 409],
  })
  rejectWalkin(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.gate.respondWalkin(estate, params.id, 'rejected');
  }

  // ---- Gate (guards) ----------------------------------------------------------------------------

  @Post('gate/verify')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @HttpCode(200)
  @Contract({
    summary: 'Verify a QR or PIN (records nothing)',
    tags: ['gate'],
    params: estateParamSchema,
    body: verifyCredentialSchema,
    response: verifyResultSchema,
    errors: [403, 404],
  })
  verify(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof verifyCredentialSchema>,
  ) {
    return this.gate.verify(estate, body);
  }

  @Post('gate/events')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Record an entry or exit (idempotent on clientUuid)',
    tags: ['gate'],
    params: estateParamSchema,
    body: gateEventInputSchema,
    response: gateEventSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  record(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof gateEventInputSchema>,
  ) {
    return this.gate.recordEvent(estate, body);
  }

  @Post('gate/sync')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @HttpCode(200)
  @Contract({
    summary: 'Upload events recorded offline',
    tags: ['gate'],
    params: estateParamSchema,
    body: gateSyncSchema,
    response: gateSyncResultSchema,
  })
  sync(@CurrentEstate() estate: EstateAccess, @ValidBody() body: z.infer<typeof gateSyncSchema>) {
    return this.gate.sync(estate, body.deviceNow, body.events);
  }

  @Get('gate/expected')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Expected passes and restricted list for a gate (offline cache)',
    tags: ['gate'],
    params: estateParamSchema,
    query: expectedQuerySchema,
    response: expectedListSchema,
    errors: [404],
  })
  expected(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof expectedQuerySchema>,
  ) {
    return this.gate.expected(estate, query.gateId, query.hours);
  }

  @Get('gate/revocations')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Passes revoked since a time (offline cache)',
    tags: ['gate'],
    params: estateParamSchema,
    query: revocationsQuerySchema,
    response: revocationsSchema,
  })
  revocations(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof revocationsQuerySchema>,
  ) {
    return this.gate.revocations(estate, query.since);
  }

  @Get('gate/keys')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Public keys for offline QR checks',
    tags: ['gate'],
    params: estateParamSchema,
    response: signingKeysSchema,
  })
  keys(@CurrentEstate() estate: EstateAccess) {
    return this.gate.signingKeys(estate);
  }

  @Get('gate/inside')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Visitors currently inside',
    tags: ['gate'],
    params: estateParamSchema,
    response: z.array(insideItemSchema),
  })
  inside(@CurrentEstate() estate: EstateAccess) {
    return this.gate.inside(estate);
  }

  @Post('walkins')
  @Can('gate.verify')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Ask a household to let a walk-in visitor in',
    tags: ['gate'],
    params: estateParamSchema,
    body: createWalkinSchema,
    response: walkinSchema,
    status: 201,
    errors: [404, 422],
  })
  createWalkin(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createWalkinSchema>,
  ) {
    return this.gate.createWalkin(estate, body);
  }

  // ---- Management -------------------------------------------------------------------------------

  @Get('gate/events')
  @Can('visitor.log.read')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Visitor log',
    tags: ['gate'],
    params: estateParamSchema,
    query: gateEventListQuerySchema,
    response: gateEventSchema,
    paginated: true,
  })
  log(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof gateEventListQuerySchema>,
  ) {
    return this.gate.events(estate, query);
  }

  @Get('restricted-visitors')
  @Can('visitor.log.read')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Restricted visitors',
    tags: ['visitors'],
    params: estateParamSchema,
    response: z.array(restrictedVisitorSchema),
  })
  restricted(@CurrentEstate() estate: EstateAccess) {
    return this.gate.restricted(estate);
  }

  @Post('restricted-visitors')
  @Can('security.staff.manage')
  @RequiresFeature('visitors')
  @Contract({
    summary: 'Add someone to the restricted list (this estate only)',
    tags: ['visitors'],
    params: estateParamSchema,
    body: createRestrictedVisitorSchema,
    response: restrictedVisitorSchema,
    status: 201,
  })
  addRestricted(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createRestrictedVisitorSchema>,
  ) {
    return this.gate.addRestricted(estate, body);
  }

  @Delete('restricted-visitors/:id')
  @Can('security.staff.manage')
  @RequiresFeature('visitors')
  @HttpCode(204)
  @Contract({
    summary: 'Remove from the restricted list',
    tags: ['visitors'],
    params: estateItemParamsSchema,
    errors: [404],
  })
  async removeRestricted(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    await this.gate.removeRestricted(estate, params.id);
  }
}
