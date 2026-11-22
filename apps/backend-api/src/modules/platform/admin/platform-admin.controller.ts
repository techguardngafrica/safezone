import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  assignmentIdParamSchema,
  assignPlatformRoleSchema,
  platformOverviewSchema,
  platformStaffMemberSchema,
  platformStaffRoleAssignmentSchema,
  platformUserActionSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../../common/contract/contract';
import { PlatformStaffService } from '../../authz/platform-staff.service';
import { PlatformUsersService } from '../../identity/platform-users.service';
import { EstatesAdminService } from '../../tenancy/onboarding/estates-admin.service';
import { ComplianceService } from '../compliance.service';
import { SupportAccessService } from '../support-access.service';
import { SupportTicketsService } from '../support-tickets.service';

/**
 * Composition controller for Super Admin Portal (ADR-0021, ADR-0022):
 * aggregates Overview KPIs and composes Platform Staff assignments with user profiles.
 */
@Controller('v1/platform')
export class PlatformAdminController {
  constructor(
    private readonly staff: PlatformStaffService,
    private readonly users: PlatformUsersService,
    private readonly estates: EstatesAdminService,
    private readonly supportSessions: SupportAccessService,
    private readonly tickets: SupportTicketsService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('overview')
  @Can(
    'platform.estate.approve',
    'platform.estate.create',
    'platform.user.manage',
    'platform.support_access',
    'platform.staff.manage',
    'platform.config',
    'platform.compliance',
    'platform.finance',
  )
  @Contract({
    summary: 'Platform overview KPIs (any platform staff role)',
    tags: ['platform'],
    response: platformOverviewSchema,
    errors: [403],
  })
  async overview() {
    const [tenancy, users, sessions, openTickets, compliance] = await Promise.all([
      this.estates.platformCounts(),
      this.users.countSummary(),
      this.supportSessions.countSummary(),
      this.tickets.countOpen(),
      this.compliance.countOpenSummary(),
    ]);
    return {
      estates: tenancy.estates,
      applications: tenancy.applications,
      leads: tenancy.leads,
      users,
      support: {
        openTickets,
        activeSessions: sessions.activeSessions,
        pendingSessions: sessions.pendingSessions,
      },
      compliance,
    };
  }

  @Get('staff')
  @Can('platform.staff.manage')
  @Contract({
    summary: 'List Techguard platform staff and their platform role assignments',
    tags: ['platform'],
    response: z.array(platformStaffMemberSchema),
  })
  async listStaff() {
    const assignments = await this.staff.listAssignments();
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    if (userIds.length === 0) return [];
    const profiles = await this.users.getStaffProfiles(userIds);
    const grouped = new Map<
      string,
      Array<{ assignmentId: string; roleKey: string; roleName: string; grantedAt: string }>
    >();
    for (const a of assignments) {
      const list = grouped.get(a.userId) ?? [];
      list.push({
        assignmentId: a.id,
        roleKey: a.role.key,
        roleName: a.role.name,
        grantedAt: a.grantedAt.toISOString(),
      });
      grouped.set(a.userId, list);
    }
    return userIds.map((userId) => {
      const profile = profiles.get(userId);
      return {
        userId,
        fullName: profile?.fullName ?? null,
        phone: profile?.phoneE164 ?? '',
        email: profile?.email ?? null,
        status: profile?.status ?? 'active',
        mfaEnabled: profile?.mfaEnabled ?? false,
        roles: grouped.get(userId) ?? [],
      };
    });
  }

  @Post('staff/roles')
  @Can('platform.staff.manage')
  @Contract({
    summary: 'Assign a platform role to a user',
    tags: ['platform'],
    body: assignPlatformRoleSchema,
    response: platformStaffRoleAssignmentSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  assignRole(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof assignPlatformRoleSchema>,
  ) {
    return this.staff.assignRole(auth.userId, body);
  }

  @Delete('staff/roles/:assignmentId')
  @Can('platform.staff.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Revoke a platform role assignment',
    tags: ['platform'],
    params: assignmentIdParamSchema,
    body: platformUserActionSchema,
    response: z.object({ assignmentId: z.uuid(), revoked: z.boolean() }),
    errors: [404, 409],
  })
  revokeRole(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof assignmentIdParamSchema>,
    @ValidBody() body: z.infer<typeof platformUserActionSchema>,
  ) {
    return this.staff.revokeRole(auth.userId, params.assignmentId, body.reason);
  }
}
