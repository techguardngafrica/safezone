import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  adCampaignActionSchema,
  adCampaignDetailSchema,
  adCampaignListQuerySchema,
  adCampaignSchema,
  adCategoryPolicySchema,
  adCreativeSchema,
  adCreditSchema,
  adEnquiryListQuerySchema,
  adInvoiceSchema,
  adPlacementKeySchema,
  adPlacementSchema,
  adReportSchema,
  advertiserListQuerySchema,
  advertiserSchema,
  approveAdCampaignSchema,
  arconListQuerySchema,
  arconRecordSchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdInvoiceSchema,
  createAdvertiserSchema,
  platformAdCreativeItemSchema,
  platformAdCreativeListQuerySchema,
  platformAdEnquirySchema,
  platformAdInvoiceItemSchema,
  platformAdInvoiceListQuerySchema,
  platformAdReportQuerySchema,
  platformAdReportSchema,
  reviewAdCreativeSchema,
  updateAdCampaignSchema,
  updateAdEnquirySchema,
  updateAdPlacementSchema,
  updateAdvertiserSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { AdvertisersService } from './advertisers.service';
import { CampaignsService } from './campaigns.service';

const TAGS = ['platform', 'advertising'];
const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const keyParams = z.object({ key: adPlacementKeySchema });
const ACTIONS = ['submit', 'reject', 'pause', 'resume', 'cancel'] as const;
const actionParams = z.object({ id: z.uuid(), action: z.enum(ACTIONS) });

/** Techguard's advertising desk (advertising.md §8): enquiries, advertisers, campaigns, review, invoices. */
@Controller('v1/platform')
export class PlatformAdvertisingController {
  constructor(
    private readonly advertisers: AdvertisersService,
    private readonly campaigns: CampaignsService,
  ) {}

  // ---- Enquiries -----------------------------------------------------------------------------

  @Get('ad-enquiries')
  @Can('ad.enquiry.manage')
  @Contract({
    summary: 'Advertising enquiries',
    tags: TAGS,
    query: adEnquiryListQuerySchema,
    response: platformAdEnquirySchema,
    paginated: true,
  })
  enquiries(@ValidQuery() query: z.infer<typeof adEnquiryListQuerySchema>) {
    return this.advertisers.platformEnquiries(query);
  }

  @Get('ad-enquiries/:id')
  @Can('ad.enquiry.manage')
  @Contract({
    summary: 'An enquiry',
    tags: TAGS,
    params: idParams,
    response: platformAdEnquirySchema,
    errors: [404],
  })
  enquiry(@ValidParams() params: IdParams) {
    return this.advertisers.platformEnquiry(params.id);
  }

  @Patch('ad-enquiries/:id')
  @Can('ad.enquiry.manage')
  @Contract({
    summary: 'Move an enquiry along, add notes or assign it',
    tags: TAGS,
    params: idParams,
    body: updateAdEnquirySchema,
    response: platformAdEnquirySchema,
    errors: [404],
  })
  updateEnquiry(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof updateAdEnquirySchema>,
  ) {
    return this.advertisers.updateEnquiry(auth.userId, params.id, body);
  }

  // ---- Advertisers ---------------------------------------------------------------------------

  @Get('advertisers')
  @Can('ad.enquiry.manage', 'ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'Advertisers',
    tags: TAGS,
    query: advertiserListQuerySchema,
    response: advertiserSchema,
    paginated: true,
  })
  list(@ValidQuery() query: z.infer<typeof advertiserListQuerySchema>) {
    return this.advertisers.platformAdvertisers(query);
  }

  @Post('advertisers')
  @Can('ad.enquiry.manage')
  @Contract({
    summary: 'Create an advertiser with its owner',
    tags: TAGS,
    body: createAdvertiserSchema,
    response: advertiserSchema,
    status: 201,
    errors: [404, 422],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createAdvertiserSchema>,
  ) {
    return this.advertisers.createAdvertiser(auth.userId, body);
  }

  @Get('advertisers/:id')
  @Can('ad.enquiry.manage', 'ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'An advertiser',
    tags: TAGS,
    params: idParams,
    response: advertiserSchema,
    errors: [404],
  })
  advertiser(@ValidParams() params: IdParams) {
    return this.advertisers.platformAdvertiser(params.id);
  }

  @Patch('advertisers/:id')
  @Can('ad.campaign.review', 'ad.enquiry.manage')
  @Contract({
    summary: 'Verify, suspend or change an advertiser',
    tags: TAGS,
    params: idParams,
    body: updateAdvertiserSchema,
    response: advertiserSchema,
    errors: [404],
  })
  updateAdvertiser(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof updateAdvertiserSchema>,
  ) {
    return this.advertisers.updateAdvertiser(auth.userId, params.id, body);
  }

  // ---- Placements ----------------------------------------------------------------------------

  @Get('ad-placements')
  @Can('ad.campaign.manage', 'ad.campaign.review')
  @Contract({ summary: 'Placements inventory', tags: TAGS, response: z.array(adPlacementSchema) })
  placements() {
    return this.advertisers.placements();
  }

  @Patch('ad-placements/:key')
  @Can('ad.campaign.manage')
  @Contract({
    summary: 'Switch a placement on or off, or change its daily cap',
    tags: TAGS,
    params: keyParams,
    body: updateAdPlacementSchema,
    response: adPlacementSchema,
    errors: [404],
  })
  updatePlacement(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof keyParams>,
    @ValidBody() body: z.infer<typeof updateAdPlacementSchema>,
  ) {
    return this.advertisers.updatePlacement(auth.userId, params.key, body);
  }

  // ---- Campaigns -----------------------------------------------------------------------------

  @Get('ad-campaigns')
  @Can('ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'Campaigns',
    tags: TAGS,
    query: adCampaignListQuerySchema,
    response: adCampaignSchema,
    paginated: true,
  })
  campaignList(@ValidQuery() query: z.infer<typeof adCampaignListQuerySchema>) {
    return this.campaigns.list(query);
  }

  @Post('ad-campaigns')
  @Can('ad.campaign.manage')
  @Contract({
    summary: 'Create a campaign (draft) with its placements and agreed price',
    tags: TAGS,
    body: createAdCampaignSchema,
    response: adCampaignDetailSchema,
    status: 201,
    errors: [404, 422],
  })
  createCampaign(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createAdCampaignSchema>,
  ) {
    return this.campaigns.create(auth.userId, body);
  }

  @Get('ad-campaigns/:id')
  @Can('ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'A campaign',
    tags: TAGS,
    params: idParams,
    response: adCampaignDetailSchema,
    errors: [404],
  })
  campaign(@ValidParams() params: IdParams) {
    return this.campaigns.get(params.id);
  }

  @Patch('ad-campaigns/:id')
  @Can('ad.campaign.manage')
  @Contract({
    summary: 'Change a campaign before approval, or add the ARCON reference',
    tags: TAGS,
    params: idParams,
    body: updateAdCampaignSchema,
    response: adCampaignDetailSchema,
    errors: [404, 409, 422],
  })
  updateCampaign(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof updateAdCampaignSchema>,
  ) {
    return this.campaigns.update(auth.userId, params.id, body);
  }

  @Post('ad-campaigns/:id/approve')
  @Can('ad.campaign.review')
  @Contract({
    summary: 'Approve a campaign (ARCON reference, verified advertiser, approved creatives)',
    tags: TAGS,
    params: idParams,
    body: approveAdCampaignSchema,
    response: adCampaignDetailSchema,
    status: 200,
    errors: [404, 409, 422],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof approveAdCampaignSchema>,
  ) {
    return this.campaigns.approve(auth.userId, params.id, body.restrictedNote);
  }

  @Post('ad-campaigns/:id/credit')
  @Can('ad.campaign.review')
  @Contract({
    summary: 'Record an approved credit arrangement instead of prepayment',
    tags: TAGS,
    params: idParams,
    body: adCreditSchema,
    response: adCampaignDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  credit(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof adCreditSchema>,
  ) {
    return this.campaigns.approveCredit(auth.userId, params.id, body.note);
  }

  @Post('ad-campaigns/:id/creatives')
  @Can('ad.campaign.manage')
  @Contract({
    summary: 'Add a creative on the advertiser’s behalf',
    tags: TAGS,
    params: idParams,
    body: createAdCreativeSchema,
    response: adCreativeSchema,
    status: 201,
    errors: [404, 409],
  })
  addCreative(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof createAdCreativeSchema>,
  ) {
    return this.campaigns.addCreative(
      { userId: auth.userId, kind: 'platform_staff' },
      params.id,
      body,
    );
  }

  @Post('ad-creatives/:id/review')
  @Can('ad.campaign.review')
  @Contract({
    summary: 'Approve, reject or ask for changes to a creative',
    tags: TAGS,
    params: idParams,
    body: reviewAdCreativeSchema,
    response: adCreativeSchema,
    status: 200,
    errors: [404],
  })
  review(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof reviewAdCreativeSchema>,
  ) {
    return this.campaigns.reviewCreative(auth.userId, params.id, body);
  }

  @Get('ad-campaigns/:id/report')
  @Can('ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'Campaign report',
    tags: TAGS,
    params: idParams,
    response: adReportSchema,
    errors: [404],
  })
  report(@ValidParams() params: IdParams) {
    return this.campaigns.report(null, params.id);
  }

  @Post('ad-campaigns/:id/:action')
  @Can('ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'Submit for review, reject, pause, resume or cancel a campaign',
    tags: TAGS,
    params: actionParams,
    body: adCampaignActionSchema,
    response: adCampaignDetailSchema,
    status: 200,
    errors: [403, 404, 409, 422],
  })
  action(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof actionParams>,
    @ValidBody() body: z.infer<typeof adCampaignActionSchema>,
  ) {
    return this.campaigns.transition(auth.userId, params.id, params.action, body.reason);
  }

  // ---- Invoices ------------------------------------------------------------------------------

  @Post('ad-invoices')
  @Can('ad.campaign.manage')
  @Contract({
    summary: 'Invoice a campaign (agreed price plus 7.5% VAT)',
    tags: TAGS,
    body: createAdInvoiceSchema,
    response: adInvoiceSchema,
    status: 201,
    errors: [404, 409],
  })
  invoice(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createAdInvoiceSchema>,
  ) {
    return this.campaigns.createInvoice(auth.userId, body.campaignId);
  }

  @Get('ad-campaigns/:id/invoices')
  @Can('ad.campaign.manage', 'ad.campaign.review', 'platform.finance')
  @Contract({
    summary: 'Invoices of a campaign',
    tags: TAGS,
    params: idParams,
    response: z.array(adInvoiceSchema),
    errors: [404],
  })
  invoices(@ValidParams() params: IdParams) {
    return this.campaigns.invoices(params.id);
  }

  // ---- Cross-campaign desks (super-admin.md §6.6, §6.8, §6.9) --------------------------------

  @Get('ad-creatives')
  @Can('ad.campaign.review', 'ad.campaign.manage')
  @Contract({
    summary: 'Creative review queue across campaigns',
    tags: TAGS,
    query: platformAdCreativeListQuerySchema,
    response: platformAdCreativeItemSchema,
    paginated: true,
  })
  creativeQueue(@ValidQuery() query: z.infer<typeof platformAdCreativeListQuerySchema>) {
    return this.campaigns.platformCreatives(query);
  }

  @Get('ad-invoices')
  @Can('ad.campaign.manage', 'ad.campaign.review', 'platform.finance')
  @Contract({
    summary: 'Ad invoices across all campaigns',
    tags: TAGS,
    query: platformAdInvoiceListQuerySchema,
    response: platformAdInvoiceItemSchema,
    paginated: true,
  })
  allInvoices(@ValidQuery() query: z.infer<typeof platformAdInvoiceListQuerySchema>) {
    return this.campaigns.platformInvoices(query);
  }

  @Get('ad-reports')
  @Can('ad.campaign.manage', 'ad.campaign.review', 'platform.finance')
  @Contract({
    summary: 'Aggregate platform advertising performance and revenue report',
    tags: TAGS,
    query: platformAdReportQuerySchema,
    response: platformAdReportSchema,
  })
  platformReport(@ValidQuery() query: z.infer<typeof platformAdReportQuerySchema>) {
    return this.campaigns.platformReport(query);
  }

  @Get('ad-categories')
  @Can('platform.config', 'ad.campaign.manage', 'ad.campaign.review')
  @Contract({
    summary: 'Prohibited, restricted and allowed advertising categories',
    tags: TAGS,
    response: z.array(adCategoryPolicySchema),
  })
  adCategories() {
    return this.campaigns.categoryPolicies();
  }

  @Get('compliance/arcon')
  @Can('platform.compliance', 'ad.campaign.review')
  @Contract({
    summary: 'ARCON campaign approval register',
    tags: ['platform', 'advertising'],
    query: arconListQuerySchema,
    response: arconRecordSchema,
    paginated: true,
  })
  arconRegister(@ValidQuery() query: z.infer<typeof arconListQuerySchema>) {
    return this.campaigns.arconRegister(query);
  }
}
