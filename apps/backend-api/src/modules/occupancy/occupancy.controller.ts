import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  addHouseholdMemberSchema,
  createDomesticStaffSchema,
  createEmergencyContactSchema,
  createJoinRequestSchema,
  createOccupancySchema,
  createVehicleSchema,
  domesticStaffSchema,
  domesticStaffStatusSchema,
  emergencyContactSchema,
  endOccupancySchema,
  estateItemParamsSchema,
  estateParamSchema,
  householdSchema,
  idParamSchema,
  joinCodeParamSchema,
  joinDecisionSchema,
  joinEstateSchema,
  joinRejectionSchema,
  joinRequestListQuerySchema,
  joinRequestSchema,
  joinUnitSchema,
  joinUnitsQuerySchema,
  ownedUnitSchema,
  renewOccupancySchema,
  residentListQuerySchema,
  residentSchema,
  updateHouseholdMemberSchema,
  vehicleLookupQuerySchema,
  vehicleLookupSchema,
  vehicleSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  type AuthContext,
  Can,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { JoinRequestsService } from './join-requests.service';
import { OccupancyService } from './occupancy.service';

const staffQuerySchema = z.object({
  householdId: z.uuid().optional(),
  status: z.enum(['pending', 'active', 'suspended', 'ended']).optional(),
});
const householdQuerySchema = z.object({ householdId: z.uuid() });

/** Joining an estate and personal records (any signed-in user). */
@Controller('v1')
export class MyOccupancyController {
  constructor(
    private readonly joins: JoinRequestsService,
    private readonly occupancy: OccupancyService,
  ) {}

  @Get('join/estates/:code')
  @SignedIn()
  @Contract({
    summary: 'Find an estate by its join code',
    tags: ['occupancy'],
    params: joinCodeParamSchema,
    response: joinEstateSchema,
    errors: [404, 429],
  })
  lookup(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof joinCodeParamSchema>,
  ) {
    return this.joins.lookupEstate(auth.userId, params.code);
  }

  @Get('join/estates/:code/units')
  @SignedIn()
  @Contract({
    summary: 'Find your unit in an estate you want to join (code and name only)',
    tags: ['occupancy'],
    params: joinCodeParamSchema,
    query: joinUnitsQuerySchema,
    response: z.array(joinUnitSchema),
    errors: [404, 429],
  })
  units(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof joinCodeParamSchema>,
    @ValidQuery() query: z.infer<typeof joinUnitsQuerySchema>,
  ) {
    return this.joins.lookupUnits(auth.userId, params.code, query.q);
  }

  @Post('me/join-requests')
  @SignedIn()
  @Contract({
    summary: 'Ask to join an estate and unit',
    tags: ['occupancy'],
    body: createJoinRequestSchema,
    response: joinRequestSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  join(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createJoinRequestSchema>,
  ) {
    return this.joins.submit(auth.userId, body);
  }

  @Get('me/join-requests')
  @SignedIn()
  @Contract({
    summary: 'My join requests',
    tags: ['occupancy'],
    response: z.array(joinRequestSchema),
  })
  myJoins(@CurrentAuth() auth: AuthContext) {
    return this.joins.mine(auth.userId);
  }

  @Post('me/join-requests/:id/cancel')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Cancel my join request',
    tags: ['occupancy'],
    params: idParamSchema,
    response: joinRequestSchema,
    errors: [404, 409],
  })
  cancel(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.joins.cancel(auth.userId, params.id);
  }

  @Get('me/emergency-contacts')
  @SignedIn()
  @Contract({
    summary: 'My emergency contacts',
    tags: ['occupancy'],
    response: z.array(emergencyContactSchema),
  })
  contacts(@CurrentAuth() auth: AuthContext) {
    return this.occupancy.emergencyContacts(auth.userId);
  }

  @Post('me/emergency-contacts')
  @SignedIn()
  @Contract({
    summary: 'Add an emergency contact (with their consent)',
    tags: ['occupancy'],
    body: createEmergencyContactSchema,
    response: emergencyContactSchema,
    status: 201,
    errors: [422],
  })
  addContact(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createEmergencyContactSchema>,
  ) {
    return this.occupancy.addEmergencyContact(auth.userId, body);
  }

  @Delete('me/emergency-contacts/:id')
  @SignedIn()
  @HttpCode(204)
  @Contract({
    summary: 'Remove an emergency contact',
    tags: ['occupancy'],
    params: idParamSchema,
    errors: [404],
  })
  async removeContact(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
  ) {
    await this.occupancy.removeEmergencyContact(auth.userId, params.id);
  }
}

/** Estate-side occupancy (members, household heads and staff). */
@Controller('v1/estates/:estateId')
export class EstateOccupancyController {
  constructor(
    private readonly joins: JoinRequestsService,
    private readonly occupancy: OccupancyService,
  ) {}

  @Get('join-requests')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Join requests waiting for me (staff: the estate queue; heads: their household)',
    tags: ['occupancy'],
    params: estateParamSchema,
    query: joinRequestListQuerySchema,
    response: joinRequestSchema,
    paginated: true,
  })
  queue(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof joinRequestListQuerySchema>,
  ) {
    return this.joins.list(estate, query);
  }

  @Post('join-requests/:id/approve')
  @Member()
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a join request (managers may override any step)',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: joinDecisionSchema,
    response: joinRequestSchema,
    errors: [403, 404, 409],
  })
  approve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof joinDecisionSchema>,
  ) {
    return this.joins.decide(estate, params.id, 'approve', body.reason ?? null);
  }

  @Post('join-requests/:id/reject')
  @Member()
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a join request with a reason',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: joinRejectionSchema,
    response: joinRequestSchema,
    errors: [403, 404, 409],
  })
  reject(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof joinRejectionSchema>,
  ) {
    return this.joins.decide(estate, params.id, 'reject', body.reason);
  }

  @Post('occupancies')
  @Can('resident.approve')
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Record a household in a unit (manager)',
    tags: ['occupancy'],
    params: estateParamSchema,
    body: createOccupancySchema,
    response: householdSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  createOccupancy(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createOccupancySchema>,
  ) {
    return this.occupancy.createOccupancy(estate, body);
  }

  @Post('occupancies/:id/end')
  @Can('resident.approve')
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'End an occupancy (household leaves the unit)',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: endOccupancySchema,
    response: z.object({ id: z.uuid(), status: z.literal('ended') }),
    errors: [403, 404, 409],
  })
  endOccupancy(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof endOccupancySchema>,
  ) {
    return this.occupancy.endOccupancy(estate, params.id, body.reason);
  }

  @Get('owned-units')
  @Member()
  @RequiresFeature('property')
  @Contract({
    summary: 'Owner mode: units I own and who lives there',
    tags: ['property'],
    params: estateParamSchema,
    response: z.array(ownedUnitSchema),
  })
  ownedUnits(@CurrentEstate() estate: EstateAccess) {
    return this.occupancy.ownedUnits(estate);
  }

  @Post('occupancies/:id/renew')
  @Can('resident.approve')
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Renew a lease with a new end date',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: renewOccupancySchema,
    response: z.object({ id: z.uuid(), endsOn: z.iso.date() }),
    errors: [403, 404, 422],
  })
  renew(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof renewOccupancySchema>,
  ) {
    return this.occupancy.renewOccupancy(estate, params.id, body.endsOn);
  }

  @Get('households/mine')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'My households here',
    tags: ['occupancy'],
    params: estateParamSchema,
    response: z.array(householdSchema),
  })
  mine(@CurrentEstate() estate: EstateAccess) {
    return this.occupancy.myHouseholds(estate);
  }

  @Get('households/:id')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Household detail (members, or staff with resident.read)',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    response: householdSchema,
    errors: [404],
  })
  household(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.occupancy.household(estate, params.id);
  }

  @Post('households/:id/members')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Add a household member (household head or manager)',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: addHouseholdMemberSchema,
    response: householdSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  addMember(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof addHouseholdMemberSchema>,
  ) {
    return this.occupancy.addMember(estate, params.id, body);
  }

  @Patch('household-members/:id')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Change a member relationship or permissions',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: updateHouseholdMemberSchema,
    response: householdSchema,
    errors: [403, 404, 422],
  })
  updateMember(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof updateHouseholdMemberSchema>,
  ) {
    return this.occupancy.updateMember(estate, params.id, body);
  }

  @Delete('household-members/:id')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Remove a household member',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    response: householdSchema,
    errors: [403, 404, 422],
  })
  removeMember(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.occupancy.removeMember(estate, params.id);
  }

  @Get('residents')
  @Can('resident.read')
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Resident directory',
    tags: ['occupancy'],
    params: estateParamSchema,
    query: residentListQuerySchema,
    response: residentSchema,
    paginated: true,
  })
  residents(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof residentListQuerySchema>,
  ) {
    return this.occupancy.residents(estate, query);
  }

  @Get('vehicles')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: "A household's vehicles",
    tags: ['occupancy'],
    params: estateParamSchema,
    query: householdQuerySchema,
    response: z.array(vehicleSchema),
    errors: [404],
  })
  vehicles(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof householdQuerySchema>,
  ) {
    return this.occupancy.vehicles(estate, query.householdId);
  }

  @Post('vehicles')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Register a vehicle for a household',
    tags: ['occupancy'],
    params: estateParamSchema,
    body: createVehicleSchema,
    response: vehicleSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  addVehicle(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createVehicleSchema>,
  ) {
    return this.occupancy.addVehicle(estate, body);
  }

  @Post('vehicles/:id/deactivate')
  @Member()
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Deactivate a vehicle',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    response: vehicleSchema,
    errors: [404],
  })
  deactivateVehicle(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.occupancy.deactivateVehicle(estate, params.id);
  }

  @Get('vehicles/lookup')
  @Can('gate.verify')
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Gate lookup by plate (unit, household name, vehicle)',
    tags: ['occupancy'],
    params: estateParamSchema,
    query: vehicleLookupQuerySchema,
    response: vehicleLookupSchema.nullable(),
  })
  lookupVehicle(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof vehicleLookupQuerySchema>,
  ) {
    return this.occupancy.vehicleByPlate(estate, query.plate);
  }

  @Get('domestic-staff')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: "Domestic staff (a household's, or the estate's for staff)",
    tags: ['occupancy'],
    params: estateParamSchema,
    query: staffQuerySchema,
    response: z.array(domesticStaffSchema),
    errors: [403, 404],
  })
  staff(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof staffQuerySchema>,
  ) {
    return this.occupancy.staff(estate, query.householdId, query.status);
  }

  @Post('domestic-staff')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Register domestic staff (may need manager approval)',
    tags: ['occupancy'],
    params: estateParamSchema,
    body: createDomesticStaffSchema,
    response: domesticStaffSchema,
    status: 201,
    errors: [403, 404],
  })
  addStaff(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createDomesticStaffSchema>,
  ) {
    return this.occupancy.addStaff(estate, body);
  }

  @Post('domestic-staff/:id/status')
  @Member()
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Approve, suspend or end a domestic staff pass',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: domesticStaffStatusSchema,
    response: domesticStaffSchema,
    errors: [403, 404, 409],
  })
  staffStatus(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof domesticStaffStatusSchema>,
  ) {
    return this.occupancy.setStaffStatus(estate, params.id, body.status);
  }
}
