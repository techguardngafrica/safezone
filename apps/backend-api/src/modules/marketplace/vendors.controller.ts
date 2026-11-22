import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import {
  addVendorMemberSchema,
  createListingSchema,
  listingSchema,
  myVendorSchema,
  orderAssignSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderMessageSchema,
  orderQuoteSchema,
  orderReasonSchema,
  orderSchema,
  orderScheduleSchema,
  postOrderMessageSchema,
  reviewResponseSchema,
  serviceCategorySchema,
  updateListingSchema,
  updateVendorMemberSchema,
  updateVendorSchema,
  vendorApplicationSchema,
  vendorEarningsSchema,
  vendorItemParamsSchema,
  vendorListingQuerySchema,
  vendorMemberSchema,
  vendorParamSchema,
  vendorPayoutSetupSchema,
  vendorReviewSchema,
  vendorSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  type AuthContext,
  Can,
  CurrentAuth,
  CurrentVendor,
  SignedIn,
  type VendorAccess,
} from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { OrdersService } from './orders.service';
import { VendorsService } from './vendors.service';

type ItemParams = z.infer<typeof vendorItemParamsSchema>;
const TAGS = ['marketplace'];

/**
 * Vendor Portal and Vendor mode API (marketplace.md §6, ADR-0023). Routes under /v1/vendors/:vendorId are
 * checked against the caller's vendor membership; non-members get 404.
 */
@Controller('v1')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly orders: OrdersService,
  ) {}

  @Get('marketplace/categories')
  @Public()
  @Contract({
    summary: 'Marketplace service categories',
    tags: TAGS,
    response: z.array(serviceCategorySchema),
  })
  categories() {
    return this.vendors.categories();
  }

  @Post('vendor-applications')
  @SignedIn()
  @Contract({
    summary: 'Apply to sell as a vendor (the applicant becomes the Vendor Owner)',
    tags: TAGS,
    body: vendorApplicationSchema,
    response: vendorSchema,
    status: 201,
    errors: [409],
  })
  apply(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof vendorApplicationSchema>,
  ) {
    return this.vendors.apply(auth.userId, body);
  }

  @Get('me/vendors')
  @SignedIn()
  @Contract({
    summary: 'Vendors I belong to, with my role',
    tags: TAGS,
    response: z.array(myVendorSchema),
  })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.vendors.myVendors(auth.userId);
  }

  @Get('vendors/:vendorId')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Vendor profile, status and payout state',
    tags: TAGS,
    params: vendorParamSchema,
    response: vendorSchema,
    errors: [404],
  })
  get(@CurrentVendor() vendor: VendorAccess) {
    return this.vendors.get(vendor);
  }

  @Patch('vendors/:vendorId')
  @Can('vendor.profile.manage')
  @Contract({
    summary: 'Change the vendor profile or service areas',
    tags: TAGS,
    params: vendorParamSchema,
    body: updateVendorSchema,
    response: vendorSchema,
    errors: [403, 404],
  })
  update(
    @CurrentVendor() vendor: VendorAccess,
    @ValidBody() body: z.infer<typeof updateVendorSchema>,
  ) {
    return this.vendors.update(vendor, body);
  }

  @Put('vendors/:vendorId/payout-account')
  @Can('vendor.profile.manage')
  @Contract({
    summary: 'Link the payout bank account (held by the payment provider)',
    tags: TAGS,
    params: vendorParamSchema,
    body: vendorPayoutSetupSchema,
    response: vendorSchema,
    errors: [403, 404, 422, 502],
  })
  payout(
    @CurrentVendor() vendor: VendorAccess,
    @ValidBody() body: z.infer<typeof vendorPayoutSetupSchema>,
  ) {
    return this.vendors.linkPayout(vendor, body);
  }

  // ---- Team ----------------------------------------------------------------------------------

  @Get('vendors/:vendorId/members')
  @Can('vendor.team.manage', 'vendor.order.manage')
  @Contract({
    summary: 'Vendor team',
    tags: TAGS,
    params: vendorParamSchema,
    response: z.array(vendorMemberSchema),
  })
  members(@CurrentVendor() vendor: VendorAccess) {
    return this.vendors.members(vendor);
  }

  @Post('vendors/:vendorId/members')
  @Can('vendor.team.manage')
  @Contract({
    summary: 'Add a team member by phone number',
    tags: TAGS,
    params: vendorParamSchema,
    body: addVendorMemberSchema,
    response: z.array(vendorMemberSchema),
    status: 201,
    errors: [409, 422],
  })
  addMember(
    @CurrentVendor() vendor: VendorAccess,
    @ValidBody() body: z.infer<typeof addVendorMemberSchema>,
  ) {
    return this.vendors.addMember(vendor, body);
  }

  @Patch('vendors/:vendorId/members/:id')
  @Can('vendor.team.manage')
  @Contract({
    summary: 'Change a team member’s role',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: updateVendorMemberSchema,
    response: z.array(vendorMemberSchema),
    errors: [403, 404],
  })
  updateMember(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateVendorMemberSchema>,
  ) {
    return this.vendors.updateMember(vendor, params.id, body.role);
  }

  @Delete('vendors/:vendorId/members/:id')
  @Can('vendor.team.manage')
  @Contract({
    summary: 'Remove a team member',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: z.array(vendorMemberSchema),
    errors: [403, 404],
  })
  removeMember(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.vendors.removeMember(vendor, params.id);
  }

  // ---- Listings ------------------------------------------------------------------------------

  @Get('vendors/:vendorId/listings')
  @Can('vendor.listing.manage')
  @Contract({
    summary: 'Vendor listings',
    tags: TAGS,
    params: vendorParamSchema,
    query: vendorListingQuerySchema,
    response: listingSchema,
    paginated: true,
  })
  listings(
    @CurrentVendor() vendor: VendorAccess,
    @ValidQuery() query: z.infer<typeof vendorListingQuerySchema>,
  ) {
    return this.vendors.listings(vendor, query);
  }

  @Post('vendors/:vendorId/listings')
  @Can('vendor.listing.manage')
  @Contract({
    summary: 'Create a listing (live once the vendor is approved)',
    tags: TAGS,
    params: vendorParamSchema,
    body: createListingSchema,
    response: listingSchema,
    status: 201,
    errors: [403, 404],
  })
  createListing(
    @CurrentVendor() vendor: VendorAccess,
    @ValidBody() body: z.infer<typeof createListingSchema>,
  ) {
    return this.vendors.createListing(vendor, body);
  }

  @Patch('vendors/:vendorId/listings/:id')
  @Can('vendor.listing.manage')
  @Contract({
    summary: 'Change, pause or archive a listing',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: updateListingSchema,
    response: listingSchema,
    errors: [403, 404, 422],
  })
  updateListing(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateListingSchema>,
  ) {
    return this.vendors.updateListing(vendor, params.id, body);
  }

  // ---- Orders --------------------------------------------------------------------------------

  @Get('vendors/:vendorId/orders')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Vendor orders (service personnel see orders assigned to them)',
    tags: TAGS,
    params: vendorParamSchema,
    query: orderListQuerySchema,
    response: orderSchema,
    paginated: true,
  })
  orderList(
    @CurrentVendor() vendor: VendorAccess,
    @ValidQuery() query: z.infer<typeof orderListQuerySchema>,
  ) {
    return this.orders.vendorOrders(vendor, query);
  }

  @Get('vendors/:vendorId/orders/:id')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Order detail with history',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: orderDetailSchema,
    errors: [404],
  })
  order(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.orders.vendorDetail(vendor, params.id);
  }

  @Post('vendors/:vendorId/orders/:id/accept')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Accept a fixed-price order (payment is then due)',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  accept(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.orders.vendorAction(vendor, params.id, 'accept');
  }

  @Post('vendors/:vendorId/orders/:id/quote')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Send or revise a quote',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: orderQuoteSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  quote(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderQuoteSchema>,
  ) {
    return this.orders.vendorAction(vendor, params.id, 'quote', body);
  }

  @Post('vendors/:vendorId/orders/:id/decline')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Decline an order',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: orderReasonSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  decline(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderReasonSchema>,
  ) {
    return this.orders.vendorAction(vendor, params.id, 'decline', body);
  }

  @Post('vendors/:vendorId/orders/:id/schedule')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Schedule a paid order',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: orderScheduleSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409, 422],
  })
  schedule(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderScheduleSchema>,
  ) {
    return this.orders.vendorAction(vendor, params.id, 'schedule', body);
  }

  @Post('vendors/:vendorId/orders/:id/start')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Start work on a paid order',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  start(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.orders.vendorAction(vendor, params.id, 'start');
  }

  @Post('vendors/:vendorId/orders/:id/complete')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Mark an order complete',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  complete(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.orders.vendorAction(vendor, params.id, 'complete');
  }

  @Post('vendors/:vendorId/orders/:id/cancel')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Cancel an order (a paid order is refunded in full)',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: orderReasonSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404, 409],
  })
  cancel(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderReasonSchema>,
  ) {
    return this.orders.vendorAction(vendor, params.id, 'cancel_by_vendor', body);
  }

  @Post('vendors/:vendorId/orders/:id/assign')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Assign an order to a team member',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: orderAssignSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [403, 404],
  })
  assign(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderAssignSchema>,
  ) {
    return this.orders.assign(vendor, params.id, body.memberId);
  }

  @Get('vendors/:vendorId/orders/:id/messages')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Messages with the customer',
    tags: TAGS,
    params: vendorItemParamsSchema,
    response: z.array(orderMessageSchema),
    errors: [404],
  })
  messages(@CurrentVendor() vendor: VendorAccess, @ValidParams() params: ItemParams) {
    return this.orders.vendorMessages(vendor, params.id);
  }

  @Post('vendors/:vendorId/orders/:id/messages')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Message the customer',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: postOrderMessageSchema,
    response: z.array(orderMessageSchema),
    status: 201,
    errors: [404],
  })
  postMessage(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof postOrderMessageSchema>,
  ) {
    return this.orders.postVendorMessage(vendor, params.id, body.body);
  }

  @Post('vendors/:vendorId/orders/:id/review-response')
  @Can('vendor.order.manage')
  @Contract({
    summary: 'Respond once to the customer’s review',
    tags: TAGS,
    params: vendorItemParamsSchema,
    body: reviewResponseSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  respond(
    @CurrentVendor() vendor: VendorAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof reviewResponseSchema>,
  ) {
    return this.orders.respondToReview(vendor, params.id, body.response);
  }

  @Get('vendors/:vendorId/reviews')
  @Can('vendor.order.work')
  @Contract({
    summary: 'Reviews of this vendor',
    tags: TAGS,
    params: vendorParamSchema,
    response: z.array(vendorReviewSchema),
  })
  reviews(@CurrentVendor() vendor: VendorAccess) {
    return this.orders.vendorReviews(vendor);
  }

  @Get('vendors/:vendorId/payouts')
  @Can('vendor.payout.read')
  @Contract({
    summary: 'Earnings: paid orders, commission and vendor share',
    tags: TAGS,
    params: vendorParamSchema,
    response: vendorEarningsSchema,
  })
  payouts(@CurrentVendor() vendor: VendorAccess) {
    return this.orders.earnings(vendor);
  }
}
