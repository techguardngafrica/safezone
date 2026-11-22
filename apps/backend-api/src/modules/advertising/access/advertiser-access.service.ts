import { Injectable, Module } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';

export interface AdvertiserMembershipCheck {
  memberId: string;
  advertiserId: string;
  role: string;
  advertiserStatus: string;
}

/** Advertiser membership lookup for the authorization guard (ADR-0024). */
@Injectable()
export class AdvertiserAccessService {
  constructor(private readonly db: DatabaseService) {}

  async activeMembership(
    userId: string,
    advertiserId: string,
  ): Promise<AdvertiserMembershipCheck | null> {
    return this.db.withContext('advertising', async (tx) => {
      const member = await tx.advertiserMember.findFirst({
        where: { advertiserId, userId, removedAt: null },
        select: { id: true, role: true },
      });
      if (!member) return null;
      const advertiser = await tx.advertiser.findUnique({
        where: { id: advertiserId },
        select: { status: true },
      });
      if (!advertiser) return null;
      return {
        memberId: member.id,
        advertiserId,
        role: member.role,
        advertiserStatus: advertiser.status,
      };
    });
  }
}

@Module({ providers: [AdvertiserAccessService], exports: [AdvertiserAccessService] })
export class AdvertiserAccessModule {}
