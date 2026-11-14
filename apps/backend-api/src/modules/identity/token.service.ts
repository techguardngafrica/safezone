import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { generateToken, hmac } from './domain/crypto';

const ISSUER = 'safezone';
const AUDIENCE = 'safezone-api';
const KEY_ID = 'access-v1';

/** Access token claims: sub, sid, app only. Roles are evaluated per request (identity.md §6.5). */
const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  app: z.string().min(1).max(40),
});
export type AccessClaims = z.infer<typeof claimsSchema>;

@Injectable()
export class TokenService {
  private readonly jwt: JwtService;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.jwt = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, keyid: KEY_ID },
      verifyOptions: { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE },
    });
  }

  issueAccessToken(
    claims: AccessClaims,
    now: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + this.env.JWT_ACCESS_TTL * 1000);
    const token = this.jwt.sign(claims, { expiresIn: this.env.JWT_ACCESS_TTL });
    return { token, expiresAt };
  }

  /** Returns the claims, or null for any invalid, expired or malformed token. */
  verifyAccessToken(token: string): AccessClaims | null {
    try {
      const payload: unknown = this.jwt.verify(token);
      const parsed = claimsSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Opaque refresh token: only its HMAC is stored. */
  newRefreshToken(): { token: string; hash: string } {
    const token = generateToken(32);
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return hmac(this.env.JWT_REFRESH_SECRET, `refresh:${token}`);
  }

  get refreshTtlSeconds(): number {
    return this.env.JWT_REFRESH_TTL;
  }
}
