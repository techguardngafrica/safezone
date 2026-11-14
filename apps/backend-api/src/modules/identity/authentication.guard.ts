import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.decorators';
import { PUBLIC_KEY } from '../../common/auth/public.decorator';
import { UnauthorizedError } from '../../common/errors/domain-error';
import { requestContext } from '../../common/http/request-context';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * First global guard: verifies the bearer access token (15 min JWT) and that its session is still live,
 * so revocation and sign-out take effect immediately. Public routes skip it.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedError();

    const claims = this.tokens.verifyAccessToken(token);
    if (!claims) throw new UnauthorizedError('Your session has expired', 'TOKEN_INVALID');
    const session = await this.sessions.validate(claims.sid, claims.sub);
    if (!session)
      throw new UnauthorizedError('Your session has ended. Sign in again.', 'SESSION_INVALID');

    request.auth = {
      userId: session.userId,
      sessionId: session.sessionId,
      app: session.app,
      mfaVerified: session.mfaVerified,
    };
    requestContext.assign({ userId: session.userId, sessionId: session.sessionId });
    return true;
  }
}
