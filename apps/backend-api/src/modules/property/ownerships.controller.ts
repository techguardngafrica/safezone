import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  createOwnershipSchema,
  createOwnershipTransferSchema,
  decisionReasonSchema,
  endOwnershipSchema,
  estateItemParamsSchema,
  estateParamSchema,
  ownershipSchema,
  ownershipTransferSchema,
  transferDecisionSchema,
  transferListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { OwnershipsService } from './ownerships.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Ownership records and transfers (property.md §6). */
@Controller('v1/estates/:estateId')
export class OwnershipsController {
  constructor(private readonly ownerships: OwnershipsService) {}

  @Get('units/:id/ownerships')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Owners of a unit, past and present (staff, or the unit’s owner)',
    tags: ['property'],
    params: estateItemParamsSchema,
    response: z.array(ownershipSchema),
    errors: [404],
  })
  list(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.ownerships.list(estate, params.id);
  }

  @Post('units/:id/ownerships')
  @Can('space.manage')
  @RequiresFeature('property')
  @Contract({
    summary: 'Record an owner of a unit (person or company)',
    tags: ['property'],
    params: estateItemParamsSchema,
    body: createOwnershipSchema,
    response: ownershipSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createOwnershipSchema>,
  ) {
    return this.ownerships.create(estate, params.id, body);
  }

  @Post('ownerships/:id/end')
  @Can('space.manage')
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'End an ownership record (corrections; sales use transfers)',
    tags: ['property'],
    params: estateItemParamsSchema,
    body: endOwnershipSchema,
    response: ownershipSchema,
    errors: [403, 404, 409],
  })
  end(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof endOwnershipSchema>,
  ) {
    return this.ownerships.end(estate, params.id, body);
  }

  @Get('ownership-transfers')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Ownership transfers (staff: all; owners: their units’)',
    tags: ['property'],
    params: estateParamSchema,
    query: transferListQuerySchema,
    response: z.array(ownershipTransferSchema),
  })
  transfers(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof transferListQuerySchema>,
  ) {
    return this.ownerships.transfers(estate, query);
  }

  @Post('ownership-transfers')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Start an ownership transfer (owner or management)',
    tags: ['property'],
    params: estateParamSchema,
    body: createOwnershipTransferSchema,
    response: ownershipTransferSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  requestTransfer(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createOwnershipTransferSchema>,
  ) {
    return this.ownerships.requestTransfer(estate, body);
  }

  @Post('ownership-transfers/:id/confirm')
  @Member()
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Seller confirms a transfer',
    tags: ['property'],
    params: estateItemParamsSchema,
    response: ownershipTransferSchema,
    errors: [403, 404, 409],
  })
  confirm(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.ownerships.confirmTransfer(estate, params.id);
  }

  @Post('ownership-transfers/:id/approve')
  @Can('space.manage')
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Approve and complete a transfer (override needs documents)',
    tags: ['property'],
    params: estateItemParamsSchema,
    body: transferDecisionSchema,
    response: ownershipTransferSchema,
    errors: [403, 404, 409, 422],
  })
  approve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof transferDecisionSchema>,
  ) {
    return this.ownerships.approveTransfer(estate, params.id, body);
  }

  @Post('ownership-transfers/:id/reject')
  @Member()
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a transfer (management or the seller)',
    tags: ['property'],
    params: estateItemParamsSchema,
    body: decisionReasonSchema,
    response: ownershipTransferSchema,
    errors: [403, 404, 409],
  })
  reject(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof decisionReasonSchema>,
  ) {
    return this.ownerships.closeTransfer(estate, params.id, 'reject', body.reason);
  }

  @Post('ownership-transfers/:id/cancel')
  @Member()
  @RequiresFeature('property')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel a transfer you opened',
    tags: ['property'],
    params: estateItemParamsSchema,
    body: decisionReasonSchema,
    response: ownershipTransferSchema,
    errors: [403, 404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof decisionReasonSchema>,
  ) {
    return this.ownerships.closeTransfer(estate, params.id, 'cancel', body.reason);
  }
}
