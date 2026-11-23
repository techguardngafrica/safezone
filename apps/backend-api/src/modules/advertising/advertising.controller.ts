import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  adCampaignDetailSchema,
  adCampaignSchema,
  adCreativeSchema,
  adDecisionQuerySchema,
  adDecisionSchema,
  adEnquiryReceiptSchema,
  adEnquirySchema,
  adEnquiryTokenParamSchema,
  addAdvertiserMemberSchema,
  adInvoiceCheckoutSchema,
  adInvoicePaySchema,
  adInvoiceSchema,
  adReportSchema,
  advertiserItemParamsSchema,
  advertiserParamSchema,
  advertiserSchema,
  createAdCreativeSchema,
  createAdEnquirySchema,
  estateAdSettingsSchema,
  estateParamSchema,
  myAdvertiserSchema,
  publicAdEnquiryStatusSchema,
  updateEstateAdSettingsSchema,
} from '@safezone/schemas';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  type AdvertiserAccess,
  type AuthContext,
  Can,
  CurrentAdvertiser,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
  Member,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { RawResponse } from '../../common/http/response-envelope.interceptor';
import { TenancyService } from '../tenancy/tenancy.service';
import { AdvertisersService } from './advertisers.service';
import { CampaignsService } from './campaigns.service';
import { DecisionsService } from './decisions.service';

const TAGS = ['advertising'];
type ItemParams = z.infer<typeof advertiserItemParamsSchema>;
const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: z.enum([
    'advertiser',
    'advertiser_organisation_owner',
    'advertiser_account_manager',
    'advertising_agency_representative',
  ]),
  createdAt: z.iso.datetime(),
});
const reviseParams = z.object({ advertiserId: z.uuid(), id: z.uuid(), creativeId: z.uuid() });

/**
 * Advertising for residents, advertisers and estates (advertising.md §8, ADR-0024). Techguard's routes are
 * in PlatformAdvertisingController.
 */
@Controller('v1')
export class AdvertisingController {
  constructor(
    private readonly advertisers: AdvertisersService,
    private readonly campaigns: CampaignsService,
    private readonly decisions: DecisionsService,
    private readonly tenancy: TenancyService,
  ) {}

  // ---- Enquiries -----------------------------------------------------------------------------

  @Post('public/ad-enquiries')
  @Public()
  @Contract({
    summary: 'Ask Techguard about advertising (web)',
    tags: TAGS,
    body: createAdEnquirySchema,
    response: adEnquiryReceiptSchema,
    status: 201,
    errors: [422, 429],
  })
  publicEnquiry(@ValidBody() body: z.infer<typeof createAdEnquirySchema>, @Req() request: Request) {
    return this.advertisers.submitEnquiry(body, { kind: 'web', ip: request.ip });
  }

  @Get('public/ad-enquiries/:token')
  @Public()
  @Contract({
    summary: 'Track the status of a submitted advertising enquiry by link token',
    tags: TAGS,
    params: adEnquiryTokenParamSchema,
    response: publicAdEnquiryStatusSchema,
    errors: [404, 429],
  })
  publicEnquiryStatus(
    @ValidParams() params: z.infer<typeof adEnquiryTokenParamSchema>,
    @Req() request: Request,
  ) {
    return this.advertisers.publicEnquiryStatus(params.token, request.ip);
  }

  @Post('me/ad-enquiries')
  @SignedIn()
  @Contract({
    summary: 'Ask Techguard about advertising (Resident App)',
    tags: TAGS,
    body: createAdEnquirySchema,
    response: adEnquiryReceiptSchema,
    status: 201,
    errors: [422, 429],
  })
  myEnquiry(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createAdEnquirySchema>,
  ) {
    return this.advertisers.submitEnquiry(body, { kind: 'resident_app', userId: auth.userId });
  }

  @Get('me/ad-enquiries')
  @SignedIn()
  @Contract({ summary: 'My advertising enquiries', tags: TAGS, response: z.array(adEnquirySchema) })
  myEnquiries(@CurrentAuth() auth: AuthContext) {
    return this.advertisers.myEnquiries(auth.userId);
  }

  @Get('me/advertisers')
  @SignedIn()
  @Contract({
    summary: 'Advertiser accounts I belong to',
    tags: TAGS,
    response: z.array(myAdvertiserSchema),
  })
  myAdvertisers(@CurrentAuth() auth: AuthContext) {
    return this.advertisers.myAdvertisers(auth.userId);
  }

  // ---- Decision and tracking -----------------------------------------------------------------

  @Get('ads/decision')
  @SignedIn()
  @Contract({
    summary: 'An ad for a placement, or 204 when none may or can be shown',
    tags: TAGS,
    query: adDecisionQuerySchema,
    response: adDecisionSchema.nullable(),
    errors: [404],
  })
  async decision(
    @CurrentAuth() auth: AuthContext,
    @ValidQuery() query: z.infer<typeof adDecisionQuerySchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ad = await this.decisions.decide({ userId: auth.userId, app: auth.app }, query);
    if (!ad) response.status(204);
    return ad;
  }

  @Get('ads/i/:token')
  @Public()
  @HttpCode(204)
  @Contract({
    summary: 'Impression beacon',
    tags: TAGS,
    params: z.object({ token: z.string().min(20).max(800) }),
    status: 204,
  })
  async impression(@Param('token') token: string) {
    await this.decisions.impression(token);
  }

  @Get('ads/c/:token')
  @Public()
  @RawResponse()
  @Contract({
    summary: 'Click redirect to the reviewed destination',
    tags: TAGS,
    params: z.object({ token: z.string().min(20).max(800) }),
    status: 302,
    errors: [404],
  })
  async click(@Param('token') token: string, @Res() response: Response) {
    const destination = await this.decisions.click(token);
    if (!destination) {
      response.status(404).json({
        success: false,
        error: { code: 'AD_NOT_FOUND', message: 'This ad is no longer available', statusCode: 404 },
      });
      return;
    }
    response.redirect(302, destination);
  }

  // ---- Estate opt-outs -----------------------------------------------------------------------

  @Get('estates/:estateId/ad-settings')
  @Member()
  @Contract({
    summary: 'Ad categories this estate blocks, and the dashboard card setting',
    tags: TAGS,
    params: estateParamSchema,
    response: estateAdSettingsSchema,
  })
  async adSettings(@CurrentEstate() estate: EstateAccess) {
    const settings = await this.tenancy.getSettings(estate);
    return {
      blockedCategories: settings['ads.blocked_categories'],
      dashboardInfoEnabled: settings['ads.dashboard_info_enabled'],
    };
  }

  @Put('estates/:estateId/ad-settings')
  @Can('estate.configure')
  @Contract({
    summary: 'Block ad categories for this estate (rule 6)',
    tags: TAGS,
    params: estateParamSchema,
    body: updateEstateAdSettingsSchema,
    response: estateAdSettingsSchema,
    errors: [403],
  })
  async setAdSettings(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof updateEstateAdSettingsSchema>,
  ) {
    await this.tenancy.updateSettings(estate, {
      ...(body.blockedCategories !== undefined
        ? { 'ads.blocked_categories': body.blockedCategories }
        : {}),
      ...(body.dashboardInfoEnabled !== undefined
        ? { 'ads.dashboard_info_enabled': body.dashboardInfoEnabled }
        : {}),
    });
    return this.adSettings(estate);
  }

  // ---- Advertiser area -----------------------------------------------------------------------

  @Get('advertisers/:advertiserId')
  @Can('advertiser.campaign.read')
  @Contract({
    summary: 'Advertiser account',
    tags: TAGS,
    params: advertiserParamSchema,
    response: advertiserSchema,
  })
  advertiser(@CurrentAdvertiser() advertiser: AdvertiserAccess) {
    return this.advertisers.get(advertiser);
  }

  @Get('advertisers/:advertiserId/members')
  @Can('advertiser.team.manage')
  @Contract({
    summary: 'Advertiser team',
    tags: TAGS,
    params: advertiserParamSchema,
    response: z.array(memberSchema),
  })
  members(@CurrentAdvertiser() advertiser: AdvertiserAccess) {
    return this.advertisers.members(advertiser);
  }

  @Post('advertisers/:advertiserId/members')
  @Can('advertiser.team.manage')
  @Contract({
    summary: 'Add someone to the advertiser team',
    tags: TAGS,
    params: advertiserParamSchema,
    body: addAdvertiserMemberSchema,
    response: z.array(memberSchema),
    status: 201,
    errors: [409, 422],
  })
  addMember(
    @CurrentAdvertiser() advertiser: AdvertiserAccess,
    @ValidBody() body: z.infer<typeof addAdvertiserMemberSchema>,
  ) {
    return this.advertisers.addMember(advertiser, body);
  }

  @Delete('advertisers/:advertiserId/members/:id')
  @Can('advertiser.team.manage')
  @Contract({
    summary: 'Remove someone from the advertiser team',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    response: z.array(memberSchema),
    errors: [404, 409],
  })
  removeMember(
    @CurrentAdvertiser() advertiser: AdvertiserAccess,
    @ValidParams() params: ItemParams,
  ) {
    return this.advertisers.removeMember(advertiser, params.id);
  }

  @Get('advertisers/:advertiserId/campaigns')
  @Can('advertiser.campaign.read')
  @Contract({
    summary: 'My campaigns',
    tags: TAGS,
    params: advertiserParamSchema,
    response: z.array(adCampaignSchema),
  })
  myCampaigns(@CurrentAdvertiser() advertiser: AdvertiserAccess) {
    return this.campaigns.advertiserCampaigns(advertiser);
  }

  @Get('advertisers/:advertiserId/campaigns/:id')
  @Can('advertiser.campaign.read')
  @Contract({
    summary: 'A campaign with its placements and creatives',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    response: adCampaignDetailSchema,
    errors: [404],
  })
  myCampaign(@CurrentAdvertiser() advertiser: AdvertiserAccess, @ValidParams() params: ItemParams) {
    return this.campaigns.advertiserCampaign(advertiser, params.id);
  }

  @Get('advertisers/:advertiserId/campaigns/:id/report')
  @Can('advertiser.campaign.read')
  @Contract({
    summary: 'Aggregate report (estates under 200 users are grouped)',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    response: adReportSchema,
    errors: [404],
  })
  report(@CurrentAdvertiser() advertiser: AdvertiserAccess, @ValidParams() params: ItemParams) {
    return this.campaigns.report(advertiser, params.id);
  }

  @Post('advertisers/:advertiserId/campaigns/:id/creatives')
  @Can('advertiser.creative.manage')
  @Contract({
    summary: 'Submit a creative for review',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    body: createAdCreativeSchema,
    response: adCreativeSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  addCreative(
    @CurrentAdvertiser() advertiser: AdvertiserAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createAdCreativeSchema>,
  ) {
    this.campaigns.assertAdvertiserCanEdit(advertiser);
    return this.campaigns.addCreative(
      { userId: advertiser.userId, kind: 'user' },
      params.id,
      body,
      advertiser.advertiserId,
    );
  }

  @Post('advertisers/:advertiserId/campaigns/:id/creatives/:creativeId/revise')
  @Can('advertiser.creative.manage')
  @Contract({
    summary: 'Change a creative (a new version goes back to review)',
    tags: TAGS,
    params: reviseParams,
    body: createAdCreativeSchema,
    response: adCreativeSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  revise(
    @CurrentAdvertiser() advertiser: AdvertiserAccess,
    @ValidParams() params: z.infer<typeof reviseParams>,
    @ValidBody() body: z.infer<typeof createAdCreativeSchema>,
  ) {
    this.campaigns.assertAdvertiserCanEdit(advertiser);
    return this.campaigns.addCreative(
      { userId: advertiser.userId, kind: 'user' },
      params.id,
      body,
      advertiser.advertiserId,
      params.creativeId,
    );
  }

  @Get('advertisers/:advertiserId/campaigns/:id/invoices')
  @Can('advertiser.invoice.pay', 'advertiser.campaign.read')
  @Contract({
    summary: 'Invoices for a campaign',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    response: z.array(adInvoiceSchema),
    errors: [404],
  })
  invoices(@CurrentAdvertiser() advertiser: AdvertiserAccess, @ValidParams() params: ItemParams) {
    return this.campaigns.invoices(params.id, advertiser.advertiserId);
  }

  @Post('advertisers/:advertiserId/invoices/:id/pay')
  @Can('advertiser.invoice.pay')
  @Contract({
    summary: 'Pay an invoice (to Safezone)',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    body: adInvoicePaySchema,
    response: adInvoiceCheckoutSchema,
    status: 200,
    errors: [404, 409, 502],
  })
  pay(
    @CurrentAdvertiser() advertiser: AdvertiserAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof adInvoicePaySchema>,
  ) {
    return this.campaigns.payInvoice(advertiser, params.id, body.callbackUrl);
  }

  @Post('advertisers/:advertiserId/invoices/:id/verify')
  @Can('advertiser.invoice.pay')
  @Contract({
    summary: 'Check an invoice payment with the provider',
    tags: TAGS,
    params: advertiserItemParamsSchema,
    response: adInvoiceSchema,
    status: 200,
    errors: [404],
  })
  verify(@CurrentAdvertiser() advertiser: AdvertiserAccess, @ValidParams() params: ItemParams) {
    return this.campaigns.verifyInvoice(advertiser, params.id);
  }
}
