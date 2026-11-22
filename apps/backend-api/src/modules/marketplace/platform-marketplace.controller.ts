import { Controller, Get, Post } from '@nestjs/common';
import {
  commissionRuleSchema,
  disputeListQuerySchema,
  disputeSchema,
  platformVendorListQuerySchema,
  resolveDisputeSchema,
  setCommissionRuleSchema,
  vendorDecisionSchema,
  vendorSchema,
  vendorSuspendSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { OrdersService } from './orders.service';
import { VendorsService } from './vendors.service';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const TAGS = ['platform', 'marketplace'];

/** Techguard vendor verification, commission and dispute desk (marketplace.md §6, platform routes). */
@Controller('v1/platform')
export class PlatformMarketplaceController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly orders: OrdersService,
  ) {}

  @Get('vendors')
  @Can('vendor.approve')
  @Contract({
    summary: 'Vendor applications and accounts',
    tags: TAGS,
    query: platformVendorListQuerySchema,
    response: vendorSchema,
    paginated: true,
  })
  list(@ValidQuery() query: z.infer<typeof platformVendorListQuerySchema>) {
    return this.vendors.platformList(query);
  }

  @Get('vendors/:id')
  @Can('vendor.approve')
  @Contract({
    summary: 'A vendor with its documents and service areas',
    tags: TAGS,
    params: idParams,
    response: vendorSchema,
    errors: [404],
  })
  get(@ValidParams() params: IdParams) {
    return this.vendors.platformGet(params.id);
  }

  @Post('vendors/:id/approve')
  @Can('vendor.approve')
  @Contract({
    summary: 'Approve a verified vendor',
    tags: TAGS,
    params: idParams,
    body: vendorDecisionSchema,
    response: vendorSchema,
    status: 200,
    errors: [404, 409],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof vendorDecisionSchema>,
  ) {
    return this.vendors.decide(auth.userId, params.id, 'approve', body.reason);
  }

  @Post('vendors/:id/reject')
  @Can('vendor.approve')
  @Contract({
    summary: 'Reject a vendor application',
    tags: TAGS,
    params: idParams,
    body: vendorSuspendSchema,
    response: vendorSchema,
    status: 200,
    errors: [404, 409],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof vendorSuspendSchema>,
  ) {
    return this.vendors.decide(auth.userId, params.id, 'reject', body.reason);
  }

  @Post('vendors/:id/suspend')
  @Can('vendor.approve')
  @Contract({
    summary: 'Suspend a vendor (their listings disappear; open orders can be cancelled)',
    tags: TAGS,
    params: idParams,
    body: vendorSuspendSchema,
    response: vendorSchema,
    status: 200,
    errors: [404, 409],
  })
  suspend(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof vendorSuspendSchema>,
  ) {
    return this.vendors.decide(auth.userId, params.id, 'suspend', body.reason);
  }

  @Post('vendors/:id/reinstate')
  @Can('vendor.approve')
  @Contract({
    summary: 'Reinstate a suspended vendor',
    tags: TAGS,
    params: idParams,
    body: vendorDecisionSchema,
    response: vendorSchema,
    status: 200,
    errors: [404, 409],
  })
  reinstate(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof vendorDecisionSchema>,
  ) {
    return this.vendors.decide(auth.userId, params.id, 'reinstate', body.reason);
  }

  @Get('commission-rules')
  @Can('platform.config', 'platform.finance')
  @Contract({
    summary: 'Marketplace commission rules (newest first)',
    tags: TAGS,
    response: z.array(commissionRuleSchema),
  })
  commission() {
    return this.vendors.commissionRules();
  }

  @Post('commission-rules')
  @Can('platform.config')
  @Contract({
    summary: 'Set a commission rule from now on (default, category or vendor)',
    tags: TAGS,
    body: setCommissionRuleSchema,
    response: commissionRuleSchema,
    status: 201,
    errors: [404],
  })
  setCommission(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof setCommissionRuleSchema>,
  ) {
    return this.vendors.setCommissionRule(auth.userId, body);
  }

  @Get('order-disputes')
  @Can('vendor.approve')
  @Contract({
    summary: 'Marketplace disputes across estates',
    tags: TAGS,
    query: disputeListQuerySchema,
    response: disputeSchema,
    paginated: true,
  })
  disputes(@ValidQuery() query: z.infer<typeof disputeListQuerySchema>) {
    return this.orders.platformDisputes(query);
  }

  @Get('order-disputes/:id')
  @Can('vendor.approve')
  @Contract({
    summary: 'A marketplace dispute',
    tags: TAGS,
    params: idParams,
    response: disputeSchema,
    errors: [404],
  })
  dispute(@ValidParams() params: IdParams) {
    return this.orders.platformDispute(params.id);
  }

  @Post('order-disputes/:id/resolve')
  @Can('vendor.approve')
  @Contract({
    summary: 'Resolve a dispute: full refund, partial refund or no action',
    tags: TAGS,
    params: idParams,
    body: resolveDisputeSchema,
    response: disputeSchema,
    status: 200,
    errors: [404, 409, 422],
  })
  resolve(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: IdParams,
    @ValidBody() body: z.infer<typeof resolveDisputeSchema>,
  ) {
    return this.orders.resolveDispute(auth.userId, params.id, body);
  }
}
