import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzModule } from '../authz/authz.module';
import { AuthController } from './auth.controller';
import { AuthenticationGuard } from './authentication.guard';
import { IdentityService } from './identity.service';
import { MeController } from './me.controller';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuthzModule],
  controllers: [AuthController, MeController],
  providers: [
    IdentityService,
    OtpService,
    SessionService,
    MfaService,
    TokenService,
    AuthenticationGuard,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [IdentityService, TokenService, SessionService, AuthenticationGuard],
})
export class IdentityModule {}
