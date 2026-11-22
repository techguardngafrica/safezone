import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  estateOrderItemParamsSchema,
  estateParamSchema,
  estateVendorParamsSchema,
  estateVendorSchema,
  marketplaceBrowseQuerySchema,
  marketplaceListingSchema,
  marketplaceVendorProfileSchema,
  openDisputeSchema,
  orderCheckoutSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderMessageSchema,
  orderPaySchema,
  orderReasonSchema,
  orderSchema,
  placeOrderSchema,
  postOrderMessageSchema,
  reviewOrderSchema,
  setVendorApprovalSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { OrdersService } from './orders.service';

type ItemParams = z.infer<typeof estateOrderItemParamsSchema>;
const TAGS = ['marketplace'];

/** Resident marketplace and estate vendor approval (marketplace.md §6). */
@Controller('v1/estates/:estateId/marketplace')
export class MarketplaceController {
  constructor(private readonly orders: OrdersService) {}

  @Get('listings')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Browse listings from vendors this estate allows',
    tags: TAGS,
    params: estateParamSchema,
    query: marketplaceBrowseQuerySchema,
    response: marketplaceListingSchema,
    paginated: true,
  })
  browse(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof marketplaceBrowseQuerySchema>,
  ) {
    return this.orders.browse(estate, query);
  }

  @Get('vendors/:vendorId')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'A vendor’s profile, listings and reviews from this estate',
    tags: TAGS,
    params: estateVendorParamsSchema,
    response: marketplaceVendorProfileSchema,
    errors: [404],
  })
  vendor(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateVendorParamsSchema>,
  ) {
    return this.orders.vendorProfile(estate, params.vendorId);
  }

  @Post('orders')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Place an order or request a quote',
    tags: TAGS,
    params: estateParamSchema,
    body: placeOrderSchema,
    response: orderDetailSchema,
    status: 201,
    errors: [403, 404],
  })
  place(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof placeOrderSchema>,
  ) {
    return this.orders.place(estate, body);
  }

  @Get('orders')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'My marketplace orders',
    tags: TAGS,
    params: estateParamSchema,
    query: orderListQuerySchema,
    response: orderSchema,
    paginated: true,
  })
  mine(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof orderListQuerySchema>,
  ) {
    return this.orders.myOrders(estate, query);
  }

  @Get('orders/:id')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'My order with its history',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    response: orderDetailSchema,
    errors: [404],
  })
  detail(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.orders.residentDetail(estate, params.id);
  }

  @Post('orders/:id/accept-quote')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Accept the vendor’s quote (payment is then due)',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  acceptQuote(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.orders.acceptQuote(estate, params.id);
  }

  @Post('orders/:id/pay')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Start checkout for an accepted order',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    body: orderPaySchema,
    response: orderCheckoutSchema,
    status: 200,
    errors: [404, 409, 502],
  })
  pay(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderPaySchema>,
  ) {
    return this.orders.pay(estate, params.id, body);
  }

  @Post('orders/:id/verify-payment')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Check the payment with the provider after checkout',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404],
  })
  verify(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.orders.verifyPayment(estate, params.id);
  }

  @Post('orders/:id/cancel')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Cancel my order (a paid order is refunded in full)',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    body: orderReasonSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof orderReasonSchema>,
  ) {
    return this.orders.cancelByResident(estate, params.id, body.reason);
  }

  @Post('orders/:id/review')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Review a completed order (once)',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    body: reviewOrderSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  review(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof reviewOrderSchema>,
  ) {
    return this.orders.review(estate, params.id, body);
  }

  @Post('orders/:id/dispute')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Open a dispute on a paid order',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    body: openDisputeSchema,
    response: orderDetailSchema,
    status: 200,
    errors: [404, 409],
  })
  dispute(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof openDisputeSchema>,
  ) {
    return this.orders.dispute(estate, params.id, body);
  }

  @Get('orders/:id/messages')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Messages with the vendor',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    response: z.array(orderMessageSchema),
    errors: [404],
  })
  messages(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.orders.residentMessages(estate, params.id);
  }

  @Post('orders/:id/messages')
  @Can('marketplace.use')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Message the vendor',
    tags: TAGS,
    params: estateOrderItemParamsSchema,
    body: postOrderMessageSchema,
    response: z.array(orderMessageSchema),
    status: 201,
    errors: [404],
  })
  postMessage(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof postOrderMessageSchema>,
  ) {
    return this.orders.postResidentMessage(estate, params.id, body.body);
  }

  @Get('vendor-approvals')
  @Can('marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Vendors approved or blocked here, and verified vendors serving the estate',
    tags: TAGS,
    params: estateParamSchema,
    response: z.array(estateVendorSchema),
  })
  approvals(@CurrentEstate() estate: EstateAccess) {
    return this.orders.estateVendors(estate);
  }

  @Put('vendor-approvals')
  @Can('marketplace.moderate')
  @RequiresFeature('marketplace')
  @Contract({
    summary: 'Approve or block a vendor for this estate',
    tags: TAGS,
    params: estateParamSchema,
    body: setVendorApprovalSchema,
    response: z.array(estateVendorSchema),
    errors: [403, 404],
  })
  setApproval(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof setVendorApprovalSchema>,
  ) {
    return this.orders.setApproval(estate, body);
  }
}
