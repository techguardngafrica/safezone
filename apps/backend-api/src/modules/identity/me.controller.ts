import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  idParamSchema,
  sessionSummarySchema,
  totpConfirmResponseSchema,
  totpConfirmSchema,
  totpEnrolmentSchema,
  updateProfileSchema,
  userProfileSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  AllowGateSession,
  AllowMfaPending,
  type AuthContext,
  CurrentAuth,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { NotFoundError } from '../../common/errors/domain-error';
import { IdentityService } from './identity.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

@Controller('v1/me')
export class MeController {
  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  @SignedIn()
  @AllowGateSession()
  @AllowMfaPending()
  @Contract({ summary: 'My profile', tags: ['me'], response: userProfileSchema })
  profile(@CurrentAuth() auth: AuthContext) {
    return this.identity.getProfile(auth.userId);
  }

  @Patch()
  @SignedIn()
  @Contract({
    summary: 'Update my profile',
    tags: ['me'],
    body: updateProfileSchema,
    response: userProfileSchema,
  })
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof updateProfileSchema>,
  ) {
    return this.identity.updateProfile(auth.userId, body);
  }

  @Get('sessions')
  @SignedIn()
  @Contract({
    summary: 'My signed-in devices',
    tags: ['me'],
    response: z.array(sessionSummarySchema),
  })
  listSessions(@CurrentAuth() auth: AuthContext) {
    return this.identity.listSessions(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:id')
  @SignedIn()
  @HttpCode(204)
  @Contract({
    summary: 'Sign out one of my devices',
    tags: ['me'],
    params: idParamSchema,
    status: 204,
    errors: [404],
  })
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
  ) {
    const revoked = await this.sessions.revoke(params.id, auth.userId, 'user_revoked');
    if (!revoked) throw new NotFoundError('Session not found', 'SESSION_NOT_FOUND');
  }

  @Post('mfa/totp')
  @SignedIn()
  @AllowMfaPending()
  @HttpCode(200)
  @Contract({
    summary: 'Start authenticator app enrolment',
    tags: ['me'],
    response: totpEnrolmentSchema,
    errors: [409],
  })
  startTotp(@CurrentAuth() auth: AuthContext) {
    return this.mfa.startEnrolment(auth.userId);
  }

  @Post('mfa/totp/confirm')
  @SignedIn()
  @AllowMfaPending()
  @HttpCode(200)
  @Contract({
    summary: 'Confirm enrolment with a first code; returns recovery codes once',
    tags: ['me'],
    body: totpConfirmSchema,
    response: totpConfirmResponseSchema,
    errors: [404, 429],
  })
  confirmTotp(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof totpConfirmSchema>,
  ) {
    return this.mfa.confirmEnrolment(auth.userId, auth.sessionId, body.factorId, body.code);
  }
}
