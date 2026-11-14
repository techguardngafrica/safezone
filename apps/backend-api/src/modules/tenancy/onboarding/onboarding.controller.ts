import { Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import {
  acceptedInvitationSchema,
  applicationDecisionSchema,
  applicationListQuerySchema,
  applicationReviewSchema,
  applicationSchema,
  createEstateSchema,
  createInvitationSchema,
  downloadUrlSchema,
  estateApplicationSchema,
  estateLifecycleSchema,
  estateParamSchema,
  idParamSchema,
  invitationPreviewSchema,
  invitationSchema,
  invitationTokenParamSchema,
  leadListQuerySchema,
  onboardingLeadSchema,
  onboardingLeadViewSchema,
  platformEstateListQuerySchema,
  platformEstateSchema,
  resubmitApplicationSchema,
  setupProgressSchema,
  setupStepParamSchema,
  updateLeadSchema,
} from '@safezone/schemas';
import type { Request } from 'express';
import { z } from 'zod';
import {
  type AuthContext,
  Can,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
  SignedIn,
} from '../../../common/auth/auth.decorators';
import { Public } from '../../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../../common/contract/contract';
import { ApplicationsService } from './applications.service';
import { EstatesAdminService } from './estates-admin.service';
import { SetupService } from './setup.service';

const applicationFileParamsSchema = z.object({ id: z.uuid(), fileId: z.uuid() });
const estateInvitationParamsSchema = z.object({ id: z.uuid(), invitationId: z.uuid() });

/** Public onboarding entry points (public-web). Rate-limited per IP. */
@Controller('v1/public')
export class PublicOnboardingController {
  constructor(private readonly estates: EstatesAdminService) {}

  @Post('onboarding-leads')
  @Public()
  @Contract({
    summary: 'Ask Techguard to onboard an estate (assisted onboarding)',
    tags: ['onboarding'],
    body: onboardingLeadSchema,
    response: z.object({ id: z.uuid() }),
    status: 201,
    errors: [429],
  })
  createLead(@ValidBody() body: z.infer<typeof onboardingLeadSchema>, @Req() request: Request) {
    return this.estates.createLead(body, request.ip);
  }

  @Get('invitations/:token')
  @Public()
  @Contract({
    summary: 'Preview an estate invitation before signing in',
    tags: ['onboarding'],
    params: invitationTokenParamSchema,
    response: invitationPreviewSchema,
    errors: [404, 429],
  })
  previewInvitation(
    @ValidParams() params: z.infer<typeof invitationTokenParamSchema>,
    @Req() request: Request,
  ) {
    return this.estates.previewInvitation(params.token, request.ip);
  }
}

/** The signed-in applicant or invitee. */
@Controller('v1')
export class MyOnboardingController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly estates: EstatesAdminService,
  ) {}

  @Post('me/estate-applications')
  @SignedIn()
  @Contract({
    summary: 'Apply to bring an estate onto Safezone (free)',
    tags: ['onboarding'],
    body: estateApplicationSchema,
    response: applicationSchema,
    status: 201,
    errors: [409, 422],
  })
  submit(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof estateApplicationSchema>,
  ) {
    return this.applications.submit(auth.userId, body);
  }

  @Get('me/estate-applications')
  @SignedIn()
  @Contract({
    summary: 'My estate applications',
    tags: ['onboarding'],
    response: z.array(applicationSchema),
  })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.applications.mine(auth.userId);
  }

  @Post('me/estate-applications/:id/resubmit')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Answer an information request and resubmit',
    tags: ['onboarding'],
    params: idParamSchema,
    body: resubmitApplicationSchema,
    response: applicationSchema,
    errors: [404, 409, 422],
  })
  resubmit(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof resubmitApplicationSchema>,
  ) {
    return this.applications.resubmit(auth.userId, params.id, body);
  }

  @Post('me/estate-applications/:id/withdraw')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Withdraw my application',
    tags: ['onboarding'],
    params: idParamSchema,
    response: applicationSchema,
    errors: [404, 409],
  })
  withdraw(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.applications.withdraw(auth.userId, params.id);
  }

  @Post('invitations/:token/accept')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Accept an estate invitation (signed in with the invited phone)',
    tags: ['onboarding'],
    params: invitationTokenParamSchema,
    response: acceptedInvitationSchema,
    errors: [403, 404, 409],
  })
  accept(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof invitationTokenParamSchema>,
  ) {
    return this.estates.acceptInvitation(auth.userId, params.token);
  }
}

/** Techguard review queue, assisted onboarding and estate lifecycle (super-admin). */
@Controller('v1/platform')
export class PlatformOnboardingController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly estates: EstatesAdminService,
  ) {}

  @Get('estate-applications')
  @Can('platform.estate.approve')
  @Contract({
    summary: 'Estate application review queue (oldest first)',
    tags: ['platform'],
    query: applicationListQuerySchema,
    response: applicationSchema,
    paginated: true,
  })
  listApplications(@ValidQuery() query: z.infer<typeof applicationListQuerySchema>) {
    return this.applications.list(query);
  }

  @Get('estate-applications/:id')
  @Can('platform.estate.approve')
  @Contract({
    summary: 'Application with applicant contact and duplicate check',
    tags: ['platform'],
    params: idParamSchema,
    response: applicationReviewSchema,
    errors: [404],
  })
  review(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.applications.review(params.id);
  }

  @Get('estate-applications/:id/documents/:fileId/download-url')
  @Can('platform.estate.approve')
  @Contract({
    summary: 'Signed download of an application document (audited)',
    tags: ['platform'],
    params: applicationFileParamsSchema,
    response: downloadUrlSchema,
    errors: [404, 409],
  })
  document(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof applicationFileParamsSchema>,
  ) {
    return this.applications.documentDownload(auth.userId, params.id, params.fileId);
  }

  @Post('estate-applications/:id/start-review')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Take an application into review',
    tags: ['platform'],
    params: idParamSchema,
    response: applicationSchema,
    errors: [404, 409],
  })
  startReview(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
  ) {
    return this.applications.startReview(auth.userId, params.id);
  }

  @Post('estate-applications/:id/request-info')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Ask the applicant for more information',
    tags: ['platform'],
    params: idParamSchema,
    body: applicationDecisionSchema,
    response: applicationSchema,
    errors: [404, 409],
  })
  requestInfo(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof applicationDecisionSchema>,
  ) {
    return this.applications.requestInfo(auth.userId, params.id, body.reason);
  }

  @Post('estate-applications/:id/approve')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve: creates the estate and its administrator',
    tags: ['platform'],
    params: idParamSchema,
    response: applicationSchema,
    errors: [404, 409, 422],
  })
  approve(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.applications.approve(auth.userId, params.id);
  }

  @Post('estate-applications/:id/reject')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Reject an application with a reason',
    tags: ['platform'],
    params: idParamSchema,
    body: applicationDecisionSchema,
    response: applicationSchema,
    errors: [404, 409],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof applicationDecisionSchema>,
  ) {
    return this.applications.reject(auth.userId, params.id, body.reason);
  }

  @Get('onboarding-leads')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Assisted onboarding requests (newest first)',
    tags: ['platform'],
    query: leadListQuerySchema,
    response: onboardingLeadViewSchema,
    paginated: true,
  })
  listLeads(@ValidQuery() query: z.infer<typeof leadListQuerySchema>) {
    return this.estates.listLeads(query);
  }

  @Patch('onboarding-leads/:id')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Update a lead',
    tags: ['platform'],
    params: idParamSchema,
    body: updateLeadSchema,
    response: z.object({ id: z.uuid(), status: updateLeadSchema.shape.status }),
    errors: [404],
  })
  updateLead(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateLeadSchema>,
  ) {
    return this.estates.updateLead(auth.userId, params.id, body.status);
  }

  @Post('estates')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Create an estate for a customer (assisted onboarding)',
    tags: ['platform'],
    body: createEstateSchema,
    response: platformEstateSchema,
    status: 201,
    errors: [404, 409],
  })
  createEstate(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createEstateSchema>,
  ) {
    return this.estates.createEstate(auth.userId, body);
  }

  @Get('estates')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Find estates by name or join code',
    tags: ['platform'],
    query: platformEstateListQuerySchema,
    response: platformEstateSchema,
    paginated: true,
  })
  listEstates(@ValidQuery() query: z.infer<typeof platformEstateListQuerySchema>) {
    return this.estates.listEstates(query);
  }

  @Get('estates/:id')
  @Can('platform.estate.create')
  @Contract({
    summary: 'One estate',
    tags: ['platform'],
    params: idParamSchema,
    response: platformEstateSchema,
    errors: [404],
  })
  getEstate(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.estates.getEstate(params.id);
  }

  @Post('estates/:id/suspend')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Suspend an estate (safety features keep working)',
    tags: ['platform'],
    params: idParamSchema,
    body: estateLifecycleSchema,
    response: platformEstateSchema,
    errors: [404, 409],
  })
  suspend(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof estateLifecycleSchema>,
  ) {
    return this.estates.changeLifecycle(auth.userId, params.id, 'suspend', body.reason);
  }

  @Post('estates/:id/reactivate')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Lift a suspension',
    tags: ['platform'],
    params: idParamSchema,
    body: estateLifecycleSchema,
    response: platformEstateSchema,
    errors: [404, 409],
  })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof estateLifecycleSchema>,
  ) {
    return this.estates.changeLifecycle(auth.userId, params.id, 'reactivate', body.reason);
  }

  @Post('estates/:id/deactivate')
  @Can('platform.estate.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Deactivate an estate (starts offboarding)',
    tags: ['platform'],
    params: idParamSchema,
    body: estateLifecycleSchema,
    response: platformEstateSchema,
    errors: [404, 409],
  })
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof estateLifecycleSchema>,
  ) {
    return this.estates.changeLifecycle(auth.userId, params.id, 'deactivate', body.reason);
  }

  @Post('estates/:id/invitations')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Invite an estate representative (link by SMS and email, 7 days)',
    tags: ['platform'],
    params: idParamSchema,
    body: createInvitationSchema,
    response: invitationSchema,
    status: 201,
    errors: [404, 409],
  })
  invite(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof createInvitationSchema>,
  ) {
    return this.estates.createInvitation(auth.userId, params.id, body);
  }

  @Get('estates/:id/invitations')
  @Can('platform.estate.create')
  @Contract({
    summary: 'Invitations for an estate',
    tags: ['platform'],
    params: idParamSchema,
    response: z.array(invitationSchema),
  })
  invitations(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.estates.listInvitations(params.id);
  }

  @Post('estates/:id/invitations/:invitationId/revoke')
  @Can('platform.estate.create')
  @HttpCode(200)
  @Contract({
    summary: 'Revoke a pending invitation',
    tags: ['platform'],
    params: estateInvitationParamsSchema,
    response: invitationSchema,
    errors: [404, 409],
  })
  revoke(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof estateInvitationParamsSchema>,
  ) {
    return this.estates.revokeInvitation(auth.userId, params.id, params.invitationId);
  }
}

/** Setup wizard (management-web). */
@Controller('v1/estates/:estateId/setup-progress')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @Can('estate.configure')
  @Contract({
    summary: 'Setup wizard progress',
    tags: ['estates'],
    params: estateParamSchema,
    response: setupProgressSchema,
  })
  progress(@CurrentEstate() estate: EstateAccess) {
    return this.setup.progress(estate);
  }

  @Post(':step/complete')
  @Can('estate.configure')
  @HttpCode(200)
  @Contract({
    summary: 'Mark a setup step complete (verified where the facts are known)',
    tags: ['estates'],
    params: setupStepParamSchema,
    response: setupProgressSchema,
    errors: [403, 404, 422],
  })
  complete(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof setupStepParamSchema>,
  ) {
    return this.setup.completeStep(estate, params.step);
  }

  @Post('activate')
  @Can('estate.configure')
  @HttpCode(200)
  @Contract({
    summary: 'Activate the estate when setup is complete',
    tags: ['estates'],
    params: estateParamSchema,
    response: setupProgressSchema,
    errors: [403, 404, 409, 422],
  })
  activate(@CurrentEstate() estate: EstateAccess) {
    return this.setup.activate(estate);
  }
}
