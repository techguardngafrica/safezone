import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';

/**
 * Identity's read-only user lookups for other modules, usable in the API and the worker (it needs only the
 * database). Phone numbers are for server-side checks and staff views, never advertisers or vendors.
 */
@Injectable()
export class UserDirectory {
  constructor(private readonly db: DatabaseService) {}

  async contactsOf(
    userIds: readonly string[],
  ): Promise<Map<string, { phone: string; fullName: string | null }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.withContext('identity', (tx) =>
      tx.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, phoneE164: true, fullName: true },
      }),
    );
    return new Map(rows.map((row) => [row.id, { phone: row.phoneE164, fullName: row.fullName }]));
  }

  /** Name, phone and email of users, for the estate staff directory. */
  async staffProfilesOf(
    userIds: readonly string[],
  ): Promise<Map<string, { fullName: string | null; phone: string; email: string | null }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.withContext('identity', (tx) =>
      tx.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, fullName: true, phoneE164: true, email: true },
      }),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { fullName: row.fullName, phone: row.phoneE164, email: row.email },
      ]),
    );
  }
}
