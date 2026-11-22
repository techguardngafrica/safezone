import { UserDirectory } from './user-directory.service';
import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzModule } from '../authz/authz.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AuthenticationGuard } from './authentication.guard';
import { IdentityService } from './identity.service';
import { MeController } from './me.controller';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuthzModule, TenancyModule],
  controllers: [AuthController, MeController, PlatformUsersController],
  providers: [
    UserDirectory,
    IdentityService,
    PlatformUsersService,
    OtpService,
    SessionService,
    MfaService,
    TokenService,
    AuthenticationGuard,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [
    UserDirectory,
    IdentityService,
    PlatformUsersService,
    TokenService,
    SessionService,
    AuthenticationGuard,
  ],
})
export class IdentityModule {}
