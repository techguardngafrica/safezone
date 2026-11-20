import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  assignStaffRoleSchema,
  createEstateRoleSchema,
  estateItemParamsSchema,
  estateParamSchema,
  estateRoleSchema,
  staffRoleAssignmentSchema,
  staffRoleParamsSchema,
  staffUserParamsSchema,
  updateEstateRoleSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { StaffRolesService } from './staff-roles.service';

@Controller('v1/estates/:estateId')
export class StaffRolesController {
  constructor(private readonly staffRoles: StaffRolesService) {}

  @Get('roles')
  @Can('role.assign')
  @Contract({
    summary: 'Built-in and custom estate roles',
    tags: ['authz'],
    params: estateParamSchema,
    response: z.array(estateRoleSchema),
  })
  listRoles(@CurrentEstate() estate: EstateAccess) {
    return this.staffRoles.listRoles(estate);
  }

  @Post('roles')
  @Can('role.assign')
  @Contract({
    summary: 'Create a custom estate role',
    tags: ['authz'],
    params: estateParamSchema,
    body: createEstateRoleSchema,
    response: estateRoleSchema,
    status: 201,
    errors: [409, 422],
  })
  createRole(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createEstateRoleSchema>,
  ) {
    return this.staffRoles.createRole(estate, body);
  }

  @Patch('roles/:id')
  @Can('role.assign')
  @Contract({
    summary: 'Update a custom estate role',
    tags: ['authz'],
    params: estateItemParamsSchema,
    body: updateEstateRoleSchema,
    response: estateRoleSchema,
    errors: [404, 422],
  })
  updateRole(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof updateEstateRoleSchema>,
  ) {
    return this.staffRoles.updateRole(estate, params.id, body);
  }

  @Delete('roles/:id')
  @Can('role.assign')
  @HttpCode(204)
  @Contract({
    summary: 'Delete an unused custom estate role',
    tags: ['authz'],
    params: estateItemParamsSchema,
    errors: [404, 409],
  })
  async deleteRole(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    await this.staffRoles.deleteRole(estate, params.id);
  }

  @Post('staff/:userId/roles')
  @Can('role.assign')
  @Contract({
    summary: 'Assign a role to a staff member (optionally temporary with validTo)',
    tags: ['authz'],
    params: staffUserParamsSchema,
    body: assignStaffRoleSchema,
    response: staffRoleAssignmentSchema,
    status: 201,
    errors: [404, 422],
  })
  assignRole(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof staffUserParamsSchema>,
    @ValidBody() body: z.infer<typeof assignStaffRoleSchema>,
  ) {
    return this.staffRoles.assignRole(estate, params.userId, body);
  }

  @Delete('staff/:userId/roles/:assignmentId')
  @Can('role.assign')
  @HttpCode(204)
  @Contract({
    summary: 'Revoke a role assignment from a staff member',
    tags: ['authz'],
    params: staffRoleParamsSchema,
    errors: [404, 409],
  })
  async revokeRole(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof staffRoleParamsSchema>,
  ) {
    await this.staffRoles.revokeRole(estate, params.userId, params.assignmentId);
  }
}
