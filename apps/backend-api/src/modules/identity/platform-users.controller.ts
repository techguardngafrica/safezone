import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  idParamSchema,
  platformUserActionSchema,
  platformUserDetailSchema,
  platformUserListQuerySchema,
  platformUserSummarySchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { PlatformUsersService } from './platform-users.service';

@Controller('v1/platform/users')
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get()
  @Can('platform.user.manage')
  @Contract({
    summary: 'Platform-wide user lookup by phone, email, name or user id',
    tags: ['platform'],
    query: platformUserListQuerySchema,
    response: platformUserSummarySchema,
    paginated: true,
  })
  list(@ValidQuery() query: z.infer<typeof platformUserListQuerySchema>) {
    return this.users.list(query);
  }

  @Get(':id')
  @Can('platform.user.manage')
  @Contract({
    summary: 'User profile and estate membership names (no tenant data)',
    tags: ['platform'],
    params: idParamSchema,
    response: platformUserDetailSchema,
    errors: [404],
  })
  get(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.users.get(params.id);
  }

  @Post(':id/lock')
  @Can('platform.user.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Lock a user account and revoke active sessions',
    tags: ['platform'],
    params: idParamSchema,
    body: platformUserActionSchema,
    response: platformUserDetailSchema,
    errors: [404, 409],
  })
  lock(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof platformUserActionSchema>,
  ) {
    return this.users.setLock(auth.userId, params.id, true, body.reason);
  }

  @Post(':id/unlock')
  @Can('platform.user.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Unlock a locked user account',
    tags: ['platform'],
    params: idParamSchema,
    body: platformUserActionSchema,
    response: platformUserDetailSchema,
    errors: [404],
  })
  unlock(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof platformUserActionSchema>,
  ) {
    return this.users.setLock(auth.userId, params.id, false, body.reason);
  }

  @Post(':id/revoke-sessions')
  @Can('platform.user.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Force sign-out of all devices for a user',
    tags: ['platform'],
    params: idParamSchema,
    body: platformUserActionSchema,
    response: platformUserDetailSchema,
    errors: [404],
  })
  revokeSessions(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof platformUserActionSchema>,
  ) {
    return this.users.revokeAllSessions(auth.userId, params.id, body.reason);
  }

  @Post(':id/reset-mfa')
  @Can('platform.user.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Reset TOTP MFA and revoke active sessions (requires re-enrolment)',
    tags: ['platform'],
    params: idParamSchema,
    body: platformUserActionSchema,
    response: platformUserDetailSchema,
    errors: [404],
  })
  resetMfa(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof platformUserActionSchema>,
  ) {
    return this.users.resetMfa(auth.userId, params.id, body.reason);
  }
}
