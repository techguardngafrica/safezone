import { Injectable } from '@nestjs/common';
import type { DeviceInfo } from '@safezone/schemas';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { UnauthorizedError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { TokenService } from './token.service';

export interface IssuedTokens {
  sessionId: string;
  userId?: string;
  mfaVerified?: boolean;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface ValidSession {
  sessionId: string;
  userId: string;
  app: string;
  mfaVerified: boolean;
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

/**
 * Sessions and refresh rotation (identity.md §5.2). A session is one device sign-in and the family of
 * every refresh token issued to it. Presenting a used refresh token revokes the whole session.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
  ) {}

  /** Creates device, session and first refresh token inside the caller's identity transaction. */
  async create(
    tx: Tx,
    userId: string,
    device: DeviceInfo,
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const now = new Date();
    const userDevice = await tx.userDevice.create({
      data: {
        userId,
        platform: device.platform,
        app: device.app,
        appVersion: device.appVersion,
        ...(device.model ? { model: device.model } : {}),
      },
      select: { id: true },
    });
    const session = await tx.session.create({
      data: {
        userId,
        deviceId: userDevice.id,
        app: device.app,
        expiresAt: new Date(now.getTime() + this.tokens.refreshTtlSeconds * 1000),
        ...(client.ip ? { ip: client.ip } : {}),
        ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 300) } : {}),
      },
      select: { id: true },
    });
    const refresh = this.tokens.newRefreshToken();
    await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: refresh.hash } });
    const access = this.tokens.issueAccessToken(
      { sub: userId, sid: session.id, app: device.app },
      now,
    );
    return {
      sessionId: session.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
    };
  }

  /** Rotates a refresh token. Reuse of an old one revokes the session and raises an alert event. */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const now = new Date();

    const result = await this.db.withContext('identity', async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash: hash },
        include: { session: true },
      });
      if (!stored) return { kind: 'invalid' as const };
      const { session } = stored;
      if (session.revokedAt || session.expiresAt <= now) return { kind: 'invalid' as const };

      const marked = await tx.refreshToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: now },
      });
      if (marked.count === 0) {
        await tx.session.update({
          where: { id: session.id },
          data: { revokedAt: now, revokedReason: 'refresh_reuse' },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'identity.refresh.reuse_detected',
            estateId: null,
            aggregateType: 'session',
            aggregateId: session.id,
            payload: { userId: session.userId, sessionId: session.id },
            audit: {
              actorType: 'system',
              action: 'identity.session.revoke',
              resourceType: 'session',
              resourceId: session.id,
              reason: 'refresh_token_reuse',
            },
          },
        ]);
        return { kind: 'reused' as const };
      }

      const next = this.tokens.newRefreshToken();
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: next.hash } });
      await tx.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + this.tokens.refreshTtlSeconds * 1000),
        },
      });
      const access = this.tokens.issueAccessToken(
        { sub: session.userId, sid: session.id, app: session.app },
        now,
      );
      return {
        kind: 'ok' as const,
        tokens: {
          sessionId: session.id,
          userId: session.userId,
          mfaVerified: session.mfaVerifiedAt !== null,
          accessToken: access.token,
          accessTokenExpiresAt: access.expiresAt,
          refreshToken: next.token,
        },
      };
    });

    if (result.kind !== 'ok')
      throw new UnauthorizedError('Your session has ended. Sign in again.', 'SESSION_INVALID');
    return result.tokens;
  }

  /** Session check for every authenticated request. */
  async validate(sessionId: string, userId: string): Promise<ValidSession | null> {
    const now = new Date();
    return this.db.withContext('identity', async (tx) => {
      const session = await tx.session.findFirst({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
        select: {
          id: true,
          userId: true,
          app: true,
          mfaVerifiedAt: true,
          lastSeenAt: true,
          user: { select: { status: true } },
        },
      });
      if (!session || session.user.status !== 'active') return null;
      if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
        await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      }
      return {
        sessionId: session.id,
        userId: session.userId,
        app: session.app,
        mfaVerified: session.mfaVerifiedAt !== null,
      };
    });
  }

  async revoke(
    sessionId: string,
    userId: string,
    reason: 'signout' | 'user_revoked',
  ): Promise<boolean> {
    return this.db.withContext('identity', async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      if (revoked.count === 0) return false;
      await appendOutboxEvents(tx, [
        {
          type: 'identity.session.revoked',
          estateId: null,
          aggregateType: 'session',
          aggregateId: sessionId,
          payload: { userId, sessionId, reason },
          audit: {
            actorType: 'user',
            actorId: userId,
            action: 'identity.session.revoke',
            resourceType: 'session',
            resourceId: sessionId,
            reason,
          },
        },
      ]);
      return true;
    });
  }

  async markMfaVerified(tx: Tx, sessionId: string): Promise<void> {
    await tx.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
  }
}
