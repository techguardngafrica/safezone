import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';

/**
 * Community's channel membership check for other processes (the realtime gateway authorises channel room
 * joins with it). Needs only the database, so the realtime process can provide it without the rest of
 * the community module.
 */
@Injectable()
export class ChannelMembershipReader {
  constructor(private readonly db: DatabaseService) {}

  /** True when the user is an active member of the channel in this estate. */
  async isActiveMember(estateId: string, channelId: string, userId: string): Promise<boolean> {
    return this.db.withTenant({ estateId, userId }, async (tx) => {
      const member = await tx.channelMember.findFirst({
        where: { estateId, channelId, userId, status: 'active' },
        select: { userId: true },
      });
      return Boolean(member);
    });
  }
}
