import { Inject, Injectable } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../common/database/database.service';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  RateLimitedError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { decryptSecret, encryptSecret, generateToken, hmac } from './domain/crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './domain/totp';
import { SessionService } from './session.service';

const RECOVERY_CODE_COUNT = 10;
const MFA_ATTEMPTS_PER_15_MIN = 5;

/** TOTP MFA with recovery codes (identity.md §2.3). Secrets are AES-GCM encrypted at rest. */
@Injectable()
export class MfaService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  async startEnrolment(userId: string) {
    return this.db.withContext('identity', async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { phoneE164: true },
      });
      const confirmed = await tx.mfaFactor.findFirst({
        where: { userId, confirmedAt: { not: null } },
      });
      if (confirmed)
        throw new ConflictError('MFA_ALREADY_ENABLED', 'Two-step verification is already on.');
      await tx.mfaFactor.deleteMany({ where: { userId, confirmedAt: null } });
      const secret = generateTotpSecret();
      const factor = await tx.mfaFactor.create({
        data: { userId, secretEncrypted: encryptSecret(this.env.MFA_ENCRYPTION_KEY, secret) },
        select: { id: true },
      });
      return {
        factorId: factor.id,
        secret,
        otpauthUri: otpauthUri(secret, maskPhone(user.phoneE164)),
      };
    });
  }

  /** Confirms enrolment with a first code, marks this session verified and returns recovery codes once. */
  async confirmEnrolment(userId: string, sessionId: string, factorId: string, code: string) {
    await this.limit(userId);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      formatRecoveryCode(generateToken(8)),
    );
    await this.db.withContext('identity', async (tx) => {
      const factor = await tx.mfaFactor.findFirst({
        where: { id: factorId, userId, confirmedAt: null },
      });
      if (!factor) throw new NotFoundError('Start enrolment again', 'MFA_ENROLMENT_NOT_FOUND');
      const step = verifyTotp(
        decryptSecret(this.env.MFA_ENCRYPTION_KEY, factor.secretEncrypted),
        code,
      );
      if (step === null)
        throw new DomainError(
          'MFA_CODE_INVALID',
          'The code is wrong. Check your authenticator app.',
          400,
        );

      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(step) },
      });
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId,
          codeHash: this.hashRecoveryCode(recoveryCode),
        })),
      });
      await this.sessions.markMfaVerified(tx, sessionId);
      await appendOutboxEvents(tx, [
        {
          type: 'identity.mfa.enabled',
          estateId: null,
          aggregateType: 'user',
          aggregateId: userId,
          payload: { userId },
          audit: {
            actorType: 'user',
            actorId: userId,
            action: 'identity.mfa.enable',
            resourceType: 'user',
            resourceId: userId,
          },
        },
      ]);
    });
    return { recoveryCodes };
  }

  /** Completes MFA for the current session with a TOTP code or a one-time recovery code. */
  async verify(userId: string, sessionId: string, input: { code?: string; recoveryCode?: string }) {
    await this.limit(userId);
    const ok = await this.db.withContext('identity', async (tx) => {
      const factor = await tx.mfaFactor.findFirst({
        where: { userId, confirmedAt: { not: null } },
      });
      if (!factor)
        throw new DomainError('MFA_NOT_ENROLLED', 'Set up two-step verification first.', 409);

      if (input.code) {
        const step = verifyTotp(
          decryptSecret(this.env.MFA_ENCRYPTION_KEY, factor.secretEncrypted),
          input.code,
        );
        if (step === null) return false;
        // Replay protection: each 30-second code works once.
        const accepted = await tx.mfaFactor.updateMany({
          where: {
            id: factor.id,
            OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
          },
          data: { lastUsedStep: BigInt(step) },
        });
        if (accepted.count === 0) return false;
      } else if (input.recoveryCode) {
        const used = await tx.recoveryCode.updateMany({
          where: { userId, codeHash: this.hashRecoveryCode(input.recoveryCode), usedAt: null },
          data: { usedAt: new Date() },
        });
        if (used.count === 0) return false;
      } else {
        return false;
      }
      await this.sessions.markMfaVerified(tx, sessionId);
      return true;
    });
    if (!ok)
      throw new DomainError('MFA_CODE_INVALID', 'The code is wrong or was already used.', 400);
    return { mfaVerified: true as const };
  }

  private async limit(userId: string): Promise<void> {
    const result = await this.rateLimiter.hit(`mfa:${userId}`, MFA_ATTEMPTS_PER_15_MIN, 900);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }

  private hashRecoveryCode(code: string): string {
    return hmac(
      this.env.JWT_REFRESH_SECRET,
      `recovery:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
    );
  }
}

/** 10 uppercase alphanumerics as XXXXX-XXXXX (easy to read out and type). */
function formatRecoveryCode(token: string): string {
  const clean = token
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .padEnd(10, 'X')
    .slice(0, 10);
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}
