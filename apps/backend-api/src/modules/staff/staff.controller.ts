import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  estateParamSchema,
  estateStaffItemSchema,
  inviteStaffSchema,
  staffListQuerySchema,
  staffUserParamsSchema,
  updateStaffStatusSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { StaffService } from './staff.service';

/** Staff directory, invitations and membership status. Role assignment endpoints stay in authz. */
@Controller('v1/estates/:estateId')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @Can('role.assign')
  @Contract({
    summary: 'Estate staff directory with assigned roles',
    tags: ['authz'],
    params: estateParamSchema,
    query: staffListQuerySchema,
    response: estateStaffItemSchema,
    paginated: true,
  })
  listStaff(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof staffListQuerySchema>,
  ) {
    return this.staff.listStaff(estate, query);
  }

  @Post('staff/invite')
  @Can('role.assign')
  @Contract({
    summary: 'Invite or add a staff member and assign estate roles',
    tags: ['authz'],
    params: estateParamSchema,
    body: inviteStaffSchema,
    response: estateStaffItemSchema,
    status: 201,
    errors: [422],
  })
  inviteStaff(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof inviteStaffSchema>,
  ) {
    return this.staff.inviteStaff(estate, body);
  }

  @Post('staff/:userId/status')
  @Can('role.assign')
  @HttpCode(200)
  @Contract({
    summary: 'Suspend or reactivate a staff member',
    tags: ['authz'],
    params: staffUserParamsSchema,
    body: updateStaffStatusSchema,
    response: z.object({ userId: z.uuid(), status: z.enum(['active', 'suspended']) }),
    errors: [404, 409],
  })
  updateStaffStatus(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof staffUserParamsSchema>,
    @ValidBody() body: z.infer<typeof updateStaffStatusSchema>,
  ) {
    return this.staff.updateStaffStatus(estate, params.userId, body);
  }
}
