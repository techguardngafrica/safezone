import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, RateLimitedError } from '../../common/errors/domain-error';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { SmsSender } from '../../integrations/sms/sms-sender';
import { generateNumericCode, hmac, safeEqualHex } from './domain/crypto';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_PHONE_PER_HOUR = 5;
const OTP_PER_IP_PER_HOUR = 10;
const VERIFY_PER_PHONE_PER_HOUR = 15;

type Purpose = 'signin';

/**
 * Phone OTP (identity.md §5.1, §6.2-6.3). Codes are 6 digits, valid 5 minutes, hashed with HMAC and
 * never logged. Limits: 5 requests per phone and 10 per IP per hour; 5 attempts per code.
 * OTPs go straight to the SMS adapter (the dedicated OTP route), not through the worker queue,
 * so sign-in works with low latency even if queues are backed up.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('Otp');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly rateLimiter: RateLimiter,
    private readonly sms: SmsSender,
  ) {}

  async request(phone: string, ip: string | undefined, purpose: Purpose = 'signin'): Promise<void> {
    const phoneKey = this.phoneKey(phone);
    const byPhone = await this.rateLimiter.hit(
      `otp:req:phone:${phoneKey}`,
      OTP_PER_PHONE_PER_HOUR,
      3600,
    );
    const byIp = ip
      ? await this.rateLimiter.hit(`otp:req:ip:${ip}`, OTP_PER_IP_PER_HOUR, 3600)
      : null;
    if (!byPhone.allowed) throw new RateLimitedError(byPhone.retryAfterSeconds);
    if (byIp && !byIp.allowed) throw new RateLimitedError(byIp.retryAfterSeconds);

    const resend = await this.rateLimiter.hit(`otp:resend:${phoneKey}`, 1, OTP_RESEND_SECONDS);
    if (!resend.allowed)
      throw new RateLimitedError(
        resend.retryAfterSeconds,
        'Wait a moment before asking for another code.',
      );

    const code = generateNumericCode(6);
    await this.db.withContext('identity', async (tx) => {
      // A new code replaces any earlier unused one.
      await tx.otpChallenge.updateMany({
        where: { phoneE164: phone, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const challenge = await tx.otpChallenge.create({
        data: {
          phoneE164: phone,
          purpose,
          channel: 'sms',
          codeHash: 'pending',
          expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
          ...(ip ? { ip } : {}),
        },
        select: { id: true },
      });
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { codeHash: this.hashCode(challenge.id, code) },
      });
    });

    try {
      await this.sms.send({
        to: phone,
        kind: 'otp',
        body: `Your Safezone code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
      });
    } catch {
      this.logger.warn('otp sms delivery failed');
      throw new DomainError(
        'OTP_DELIVERY_FAILED',
        'We could not send the code. Try again shortly.',
        503,
      );
    }
  }

  /** Consumes the code. Throws OTP_INVALID for a wrong, expired or exhausted code (no detail leaked). */
  async verify(phone: string, code: string, purpose: Purpose = 'signin'): Promise<void> {
    const limit = await this.rateLimiter.hit(
      `otp:verify:${this.phoneKey(phone)}`,
      VERIFY_PER_PHONE_PER_HOUR,
      3600,
    );
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);

    const ok = await this.db.withContext('identity', async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: { phoneE164: phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) return false;

      // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
      const counted = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, attempts: { lt: OTP_MAX_ATTEMPTS }, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      if (counted.count === 0) return false;

      if (!safeEqualHex(challenge.codeHash, this.hashCode(challenge.id, code))) return false;
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return consumed.count === 1;
    });

    if (!ok) throw new DomainError('OTP_INVALID', 'The code is wrong or has expired.', 400);
  }

  private hashCode(challengeId: string, code: string): string {
    return hmac(this.env.OTP_HMAC_SECRET, `otp:${challengeId}:${code}`);
  }

  /** Rate-limit keys use a keyed hash so Redis never holds raw phone numbers. */
  private phoneKey(phone: string): string {
    return hmac(this.env.OTP_HMAC_SECRET, `rl:${phone}`).slice(0, 32);
  }
}
