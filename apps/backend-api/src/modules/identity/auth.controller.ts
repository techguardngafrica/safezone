import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  mfaVerifyResponseSchema,
  mfaVerifySchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  signInResponseSchema,
  tokenPairSchema,
  WEB_APPS,
} from '@safezone/schemas';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  AllowMfaPending,
  type AuthContext,
  CurrentAuth,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody } from '../../common/contract/contract';
import { UnauthorizedError } from '../../common/errors/domain-error';
import { IdentityService } from './identity.service';
import { MfaService } from './mfa.service';
import { OTP_RESEND_SECONDS, OTP_TTL_SECONDS, OtpService } from './otp.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { SessionService } from './session.service';

/** Sign-in, token rotation and MFA (identity.md §7). */
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly identity: IdentityService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  @Post('otp/request')
  @Public()
  @HttpCode(200)
  @Contract({
    summary: 'Send a sign-in code by SMS',
    tags: ['auth'],
    body: otpRequestSchema,
    response: otpRequestResponseSchema,
    errors: [429, 503],
  })
  async requestOtp(@ValidBody() body: z.infer<typeof otpRequestSchema>, @Req() request: Request) {
    await this.otp.request(body.phone, request.ip);
    return { expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_SECONDS };
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @Contract({
    summary: 'Verify the code and sign in (creates the account on first use)',
    tags: ['auth'],
    body: otpVerifySchema,
    response: signInResponseSchema,
    errors: [403, 429],
  })
  async verifyOtp(
    @ValidBody() body: z.infer<typeof otpVerifySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.identity.signInWithOtp(body.phone, body.code, body.device, {
      ...(request.ip ? { ip: request.ip } : {}),
      ...(request.header('user-agent') ? { userAgent: request.header('user-agent') } : {}),
    });
    const isWeb = WEB_APPS.includes(body.device.app);
    if (isWeb)
      setRefreshCookie(
        response,
        result.tokens.refreshToken,
        this.env.JWT_REFRESH_TTL,
        this.secureCookies,
      );
    return {
      accessToken: result.tokens.accessToken,
      accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      ...(isWeb ? {} : { refreshToken: result.tokens.refreshToken }),
      mfaRequired: result.mfaRequired,
      mfaEnrolled: result.mfaEnrolled,
      user: result.user,
      isNewUser: result.isNewUser,
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Contract({
    summary: 'Rotate tokens (body on mobile, httpOnly cookie on web)',
    tags: ['auth'],
    body: refreshRequestSchema,
    response: tokenPairSchema,
  })
  async refresh(
    @ValidBody() body: z.infer<typeof refreshRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const fromCookie = body.refreshToken === undefined;
    const token = body.refreshToken ?? readRefreshCookie(request);
    // Cookie refreshes require the app header: browsers only send it after a CORS preflight.
    if (!token || (fromCookie && !request.header('x-safezone-app'))) throw new UnauthorizedError();
    try {
      const tokens = await this.sessions.refresh(token);
      const mfa = await this.identity.mfaState(tokens.userId ?? '', tokens.mfaVerified ?? false);
      if (fromCookie)
        setRefreshCookie(
          response,
          tokens.refreshToken,
          this.env.JWT_REFRESH_TTL,
          this.secureCookies,
        );
      return {
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
        ...(fromCookie ? {} : { refreshToken: tokens.refreshToken }),
        ...mfa,
      };
    } catch (error) {
      if (fromCookie) clearRefreshCookie(response, this.secureCookies);
      throw error;
    }
  }

  @Post('signout')
  @SignedIn()
  @AllowMfaPending()
  @HttpCode(204)
  @Contract({ summary: 'Sign out this session', tags: ['auth'], status: 204 })
  async signOut(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revoke(auth.sessionId, auth.userId, 'signout');
    clearRefreshCookie(response, this.secureCookies);
  }

  @Post('mfa/verify')
  @SignedIn()
  @AllowMfaPending()
  @HttpCode(200)
  @Contract({
    summary: 'Complete two-step verification for this session',
    tags: ['auth'],
    body: mfaVerifySchema,
    response: mfaVerifyResponseSchema,
    errors: [409, 429],
  })
  verifyMfa(@CurrentAuth() auth: AuthContext, @ValidBody() body: z.infer<typeof mfaVerifySchema>) {
    return this.mfa.verify(auth.userId, auth.sessionId, body);
  }

  private get secureCookies(): boolean {
    return this.env.NODE_ENV === 'staging' || this.env.NODE_ENV === 'production';
  }
}
