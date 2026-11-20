import { Injectable } from '@nestjs/common';
import type {
  inviteStaffSchema,
  staffListQuerySchema,
  updateStaffStatusSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { ForbiddenError } from '../../common/errors/domain-error';
import { maskString } from '../../common/observability/redact';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { StaffRolesService } from '../authz/staff-roles.service';
import { IdentityService } from '../identity/identity.service';
import { UserDirectory } from '../identity/user-directory.service';
import { TenancyService } from '../tenancy/tenancy.service';

const staffCursorSchema = z.object({ joinedAt: z.iso.datetime(), userId: z.uuid() });

function formatPhone(phone: string, canViewPii: boolean): string {
  return canViewPii ? phone : maskString(phone);
}

/**
 * Estate staff directory, invitations and suspension (management-web.md §6.5, ADR-0021). Owns no tables:
 * it composes identity (users), tenancy (memberships) and authz (role assignments) through their services,
 * so each of those modules keeps sole ownership of its tables (AGENTS.md §5.1).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly staffRoles: StaffRolesService,
    private readonly identity: IdentityService,
    private readonly users: UserDirectory,
    private readonly tenancy: TenancyService,
  ) {}

  async listStaff(access: EstateAccess, query: z.infer<typeof staffListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof staffCursorSchema> =>
            staffCursorSchema.safeParse(value).success,
        )
      : undefined;
    const canViewPii = access.permissions.has('pii.view');

    const byUser = await this.staffRoles.activeStaffAssignments(access, query.roleKey);
    const staffUserIds = [...byUser.keys()];
    if (staffUserIds.length === 0) return { items: [], nextCursor: null };

    const memberships = await this.tenancy.staffMemberships(access, staffUserIds, {
      ...(query.status ? { status: query.status } : {}),
      ...(after ? { after } : {}),
      take: query.q ? 500 : query.limit + 1,
    });
    const userById = await this.users.staffProfilesOf(memberships.map((m) => m.userId));

    const q = query.q?.toLowerCase();
    const filtered = memberships.filter((m) => {
      if (!q) return true;
      const u = userById.get(m.userId);
      return (
        u?.fullName?.toLowerCase().includes(q) ||
        u?.phone.toLowerCase().includes(q) ||
        u?.email?.toLowerCase().includes(q)
      );
    });

    const page = filtered.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((m) => {
        const u = userById.get(m.userId);
        return {
          userId: m.userId,
          fullName: u?.fullName ?? null,
          phone: u ? formatPhone(u.phone, canViewPii) : '-',
          email: u?.email ?? null,
          status: m.status as 'active' | 'suspended' | 'pending' | 'left',
          joinedAt: m.joinedAt.toISOString(),
          assignments: byUser.get(m.userId) ?? [],
        };
      }),
      nextCursor:
        filtered.length > query.limit && last
          ? encodeCursor({ joinedAt: last.joinedAt.toISOString(), userId: last.userId })
          : null,
    };
  }

  async inviteStaff(access: EstateAccess, input: z.infer<typeof inviteStaffSchema>) {
    const user = await this.identity.findOrCreateStaffUser({
      phone: input.phone,
      fullName: input.fullName,
      email: input.email ?? null,
    });
    if (user.id === access.userId) {
      throw new ForbiddenError('You cannot change your own roles', 'CANNOT_ASSIGN_SELF');
    }
    const membership = await this.tenancy.activateStaffMembership(access, user.id);
    const assignments = await this.staffRoles.grantInvitedRoles(
      access,
      user.id,
      input.roleKeys,
      input.validTo,
    );

    const canViewPii = access.permissions.has('pii.view');
    return {
      userId: user.id,
      fullName: user.fullName,
      phone: formatPhone(user.phoneE164, canViewPii),
      email: user.email,
      status: membership.status as 'active',
      joinedAt: membership.joinedAt.toISOString(),
      assignments,
    };
  }

  async updateStaffStatus(
    access: EstateAccess,
    targetUserId: string,
    input: z.infer<typeof updateStaffStatusSchema>,
  ) {
    await this.staffRoles.assertMayChangeStaffStatus(access, targetUserId, input.status);
    return this.tenancy.setStaffMembershipStatus(access, targetUserId, input.status, input.reason);
  }
}
