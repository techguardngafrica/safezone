import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  availabilityQuerySchema,
  availabilitySchema,
  blackoutSchema,
  bookingListQuerySchema,
  bookingReasonSchema,
  bookingSchema,
  createBlackoutSchema,
  createBookingSchema,
  createDamageReportSchema,
  createFacilitySchema,
  damageReportSchema,
  estateItemParamsSchema,
  estateParamSchema,
  facilitiesReportQuerySchema,
  facilitiesReportSchema,
  facilitySchema,
  updateFacilitySchema,
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
import { FacilitiesService } from './facilities.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Facilities and bookings (facilities.md §6). */
@Controller('v1/estates/:estateId')
export class FacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get('facilities')
  @Member()
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Facilities',
    tags: ['facilities'],
    params: estateParamSchema,
    response: z.array(facilitySchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.facilities.list(estate);
  }

  @Post('facilities')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Add a facility with its hours, rules and price',
    tags: ['facilities'],
    params: estateParamSchema,
    body: createFacilitySchema,
    response: facilitySchema,
    status: 201,
    errors: [403],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createFacilitySchema>,
  ) {
    return this.facilities.create(estate, body);
  }

  @Get('facilities/:id')
  @Member()
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Facility detail',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    response: facilitySchema,
    errors: [404],
  })
  get(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.facilities.get(estate, params.id);
  }

  @Patch('facilities/:id')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Change a facility, its rules or price',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    body: updateFacilitySchema,
    response: facilitySchema,
    errors: [403, 404],
  })
  update(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateFacilitySchema>,
  ) {
    return this.facilities.update(estate, params.id, body);
  }

  @Post('facilities/:id/blackouts')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Close a facility for a period (affected bookings are cancelled and refunded)',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    body: createBlackoutSchema,
    response: blackoutSchema,
    status: 201,
    errors: [403, 404],
  })
  blackout(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createBlackoutSchema>,
  ) {
    return this.facilities.addBlackout(estate, params.id, body);
  }

  @Get('facilities/:id/availability')
  @Member()
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Opening hours and busy times on a date',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    query: availabilityQuerySchema,
    response: availabilitySchema,
    errors: [404],
  })
  availability(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidQuery() query: z.infer<typeof availabilityQuerySchema>,
  ) {
    return this.facilities.availability(estate, params.id, query.date);
  }

  @Post('bookings')
  @Can('facility.book')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Book a facility',
    tags: ['facilities'],
    params: estateParamSchema,
    body: createBookingSchema,
    response: bookingSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  book(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createBookingSchema>,
  ) {
    return this.facilities.book(estate, body);
  }

  @Get('bookings')
  @Member()
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Bookings (managers: all; others: their own)',
    tags: ['facilities'],
    params: estateParamSchema,
    query: bookingListQuerySchema,
    response: z.array(bookingSchema),
  })
  bookings(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof bookingListQuerySchema>,
  ) {
    return this.facilities.bookings(estate, query);
  }

  @Get('bookings/:id')
  @Member()
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Booking detail',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    response: bookingSchema,
    errors: [404],
  })
  booking(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.facilities.booking(estate, params.id);
  }

  @Post('bookings/:id/approve')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a booking',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    response: bookingSchema,
    errors: [403, 404, 409],
  })
  approve(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.facilities.approve(estate, params.id);
  }

  @Post('bookings/:id/reject')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @HttpCode(200)
  @Contract({
    summary: 'Decline a booking with a reason',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    body: bookingReasonSchema,
    response: bookingSchema,
    errors: [403, 404, 409],
  })
  reject(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof bookingReasonSchema>,
  ) {
    return this.facilities.reject(estate, params.id, body.reason);
  }

  @Post('bookings/:id/cancel')
  @Member()
  @RequiresFeature('facilities')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel a booking (refund follows the policy)',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    body: bookingReasonSchema,
    response: bookingSchema,
    errors: [404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof bookingReasonSchema>,
  ) {
    return this.facilities.cancel(estate, params.id, body.reason);
  }

  @Post('bookings/:id/check-in')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @HttpCode(200)
  @Contract({
    summary: 'Check a booker in',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    response: bookingSchema,
    errors: [403, 404, 409],
  })
  checkIn(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.facilities.checkIn(estate, params.id, false);
  }

  @Post('bookings/:id/no-show')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @HttpCode(200)
  @Contract({
    summary: 'Mark a no-show',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    response: bookingSchema,
    errors: [403, 404, 409],
  })
  noShow(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.facilities.checkIn(estate, params.id, true);
  }

  @Post('bookings/:id/damage-reports')
  @Can('facility.manage')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Report damage (optionally charge the booker)',
    tags: ['facilities'],
    params: estateItemParamsSchema,
    body: createDamageReportSchema,
    response: damageReportSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  damage(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createDamageReportSchema>,
  ) {
    return this.facilities.reportDamage(estate, params.id, body);
  }

  @Get('reports/facilities')
  @Can('report.read')
  @RequiresFeature('facilities')
  @Contract({
    summary: 'Utilisation per facility',
    tags: ['facilities'],
    params: estateParamSchema,
    query: facilitiesReportQuerySchema,
    response: facilitiesReportSchema,
  })
  report(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof facilitiesReportQuerySchema>,
  ) {
    return this.facilities.report(estate, query);
  }
}
