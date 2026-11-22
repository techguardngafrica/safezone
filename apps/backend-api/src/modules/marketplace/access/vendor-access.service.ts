import { Injectable, Module } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';

export interface VendorMembershipCheck {
  memberId: string;
  vendorId: string;
  role: string;
  vendorStatus: string;
}

/**
 * Vendor membership lookup for the authorization guard (ADR-0023). Lives in its own module so authz can
 * use it without depending on the whole marketplace module.
 */
@Injectable()
export class VendorAccessService {
  constructor(private readonly db: DatabaseService) {}

  async activeMembership(userId: string, vendorId: string): Promise<VendorMembershipCheck | null> {
    return this.db.withContext('marketplace', async (tx) => {
      const member = await tx.vendorMember.findFirst({
        where: { vendorId, userId, removedAt: null },
        select: { id: true, role: true },
      });
      if (!member) return null;
      const vendor = await tx.vendor.findUnique({
        where: { id: vendorId },
        select: { status: true },
      });
      if (!vendor) return null;
      return { memberId: member.id, vendorId, role: member.role, vendorStatus: vendor.status };
    });
  }
}

@Module({ providers: [VendorAccessService], exports: [VendorAccessService] })
export class VendorAccessModule {}
