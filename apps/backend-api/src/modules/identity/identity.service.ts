import { Injectable } from '@nestjs/common';
import { requiresMfa } from '@safezone/permissions';
import type { DeviceInfo, SessionSummary, UserProfile } from '@safezone/schemas';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { AuthzService } from '../authz/authz.service';
import { OtpService } from './otp.service';
import { type ClientInfo, type IssuedTokens, SessionService } from './session.service';

interface UserRow {
  id: string;
  phoneE164: string;
  fullName: string | null;
  email: string | null;
  locale: string;
  mfaEnabled: boolean;
  createdAt: Date;
}

export function toProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    phone: user.phoneE164,
    fullName: user.fullName,
    email: user.email,
    locale: user.locale,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface SignInResult {
  tokens: IssuedTokens;
  user: UserProfile;
  isNewUser: boolean;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
}

/** Identity public interface (modules/identity.md). One person = one global account per phone number. */
@Injectable()
export class IdentityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly authz: AuthzService,
  ) {}

  /** Verifies the OTP, then signs in, creating the account on first use. */
  async signInWithOtp(
    phone: string,
    code: string,
    device: DeviceInfo,
    client: ClientInfo,
  ): Promise<SignInResult> {
    await this.otp.verify(phone, code);

    const { user, isNewUser, tokens } = await this.db.withContext('identity', async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (existing && existing.status !== 'active') {
        throw new DomainError(
          'ACCOUNT_UNAVAILABLE',
          'This account cannot sign in. Contact support.',
          403,
        );
      }
      const now = new Date();
      const user =
        existing ?? (await tx.user.create({ data: { phoneE164: phone, phoneVerifiedAt: now } }));
      // Users added by a manager or household head verify their phone on first sign-in.
      if (existing && !existing.phoneVerifiedAt) {
        await tx.user.update({ where: { id: existing.id }, data: { phoneVerifiedAt: now } });
      }
      const tokens = await this.sessions.create(tx, user.id, device, client);
      await appendOutboxEvents(tx, [
        ...(existing
          ? []
          : [
              {
                type: 'identity.user.created',
                estateId: null,
                aggregateType: 'user',
                aggregateId: user.id,
                payload: { userId: user.id },
                audit: {
                  actorType: 'user' as const,
                  actorId: user.id,
                  action: 'identity.user.create',
                  resourceType: 'user',
                  resourceId: user.id,
                  ...clientAudit(client),
                },
              },
            ]),
        {
          type: 'identity.user.signed_in',
          estateId: null,
          aggregateType: 'user',
          aggregateId: user.id,
          payload: { userId: user.id, sessionId: tokens.sessionId, app: device.app },
          audit: {
            actorType: 'user',
            actorId: user.id,
            action: 'identity.session.create',
            resourceType: 'session',
            resourceId: tokens.sessionId,
            ...clientAudit(client),
          },
        },
      ]);
      return { user, isNewUser: !existing, tokens };
    });

    const assignments = await this.authz.activeAssignments(user.id);
    return {
      tokens,
      user: toProfile(user),
      isNewUser,
      mfaRequired: requiresMfa(assignments.map((assignment) => assignment.roleKey)),
      mfaEnrolled: user.mfaEnabled,
    };
  }

  /** Whether this session still has to complete MFA (staff/platform roles and not yet verified). */
  async mfaState(
    userId: string,
    mfaVerified: boolean,
  ): Promise<{ mfaRequired: boolean; mfaEnrolled: boolean }> {
    const [assignments, user] = await Promise.all([
      this.authz.activeAssignments(userId),
      this.db.withUser(userId, (tx) =>
        tx.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } }),
      ),
    ]);
    return {
      mfaRequired: !mfaVerified && requiresMfa(assignments.map((assignment) => assignment.roleKey)),
      mfaEnrolled: user?.mfaEnabled ?? false,
    };
  }

  /**
   * The user with this phone, created (unverified, no session) when they have no account yet. Used when a
   * manager or household head adds someone; they verify the phone the first time they sign in.
   */
  async findOrCreateByPhone(
    phone: string,
    fullName: string | null,
    actorId: string,
  ): Promise<string> {
    return this.db.withContext('identity', async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phoneE164: phone },
        select: { id: true },
      });
      if (existing) return existing.id;
      const user = await tx.user.create({ data: { phoneE164: phone, fullName } });
      await appendOutboxEvents(tx, [
        {
          type: 'identity.user.created',
          estateId: null,
          aggregateType: 'user',
          aggregateId: user.id,
          payload: { userId: user.id, addedBy: actorId },
          audit: {
            actorType: 'user',
            actorId,
            action: 'identity.user.create',
            resourceType: 'user',
            resourceId: user.id,
          },
        },
      ]);
      return user.id;
    });
  }

  /**
   * The user with this phone for a staff invitation, created when new. An existing user without a name
   * takes the invited name (and email, when given); an existing name is never overwritten.
   */
  async findOrCreateStaffUser(input: {
    phone: string;
    fullName: string;
    email?: string | null;
  }): Promise<{ id: string; fullName: string | null; phoneE164: string; email: string | null }> {
    const select = { id: true, fullName: true, phoneE164: true, email: true } as const;
    return this.db.withContext('identity', async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneE164: input.phone }, select });
      if (existing) {
        if (!existing.fullName && input.fullName) {
          return tx.user.update({
            where: { id: existing.id },
            data: { fullName: input.fullName, ...(input.email ? { email: input.email } : {}) },
            select,
          });
        }
        return existing;
      }
      return tx.user.create({
        data: { phoneE164: input.phone, fullName: input.fullName, email: input.email ?? null },
        select,
      });
    });
  }

  /** Phone and name of users, for other modules' server-side checks and staff views (never to advertisers). */
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

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.db.withUser(userId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new NotFoundError();
    return toProfile(user);
  }

  async updateProfile(
    userId: string,
    changes: { fullName?: string; locale?: string },
  ): Promise<UserProfile> {
    return this.db.withContext(
      'identity',
      async (tx) => {
        const user = await tx.user.update({ where: { id: userId }, data: changes });
        await appendOutboxEvents(tx, [
          {
            type: 'identity.profile.updated',
            estateId: null,
            aggregateType: 'user',
            aggregateId: userId,
            payload: { fields: Object.keys(changes) },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'identity.profile.update',
              resourceType: 'user',
              resourceId: userId,
              after: { fields: Object.keys(changes) },
            },
          },
        ]);
        return toProfile(user);
      },
      { userId },
    );
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.db.withUser(userId, (tx) =>
      tx.session.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { device: { select: { platform: true, model: true } } },
        orderBy: { lastSeenAt: 'desc' },
      }),
    );
    return sessions.map((session) => ({
      id: session.id,
      app: session.app,
      platform: session.device?.platform ?? null,
      model: session.device?.model ?? null,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      current: session.id === currentSessionId,
    }));
  }
}

function clientAudit(client: ClientInfo) {
  return {
    ...(client.ip ? { ip: client.ip } : {}),
    ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 300) } : {}),
  };
}
