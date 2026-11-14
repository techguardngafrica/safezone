import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../../common/rate-limit/rate-limiter';
import { AuthzModule } from '../../authz/authz.module';
import { FilesModule } from '../../files/files.module';
import { IdentityModule } from '../../identity/identity.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ApplicationsService } from './applications.service';
import { EstatesAdminService } from './estates-admin.service';
import {
  MyOnboardingController,
  PlatformOnboardingController,
  PublicOnboardingController,
  SetupController,
} from './onboarding.controller';
import { SetupService, SetupVerifiers } from './setup.service';

/**
 * Estate onboarding (tenancy.md §4): both workflows, invitations, setup wizard and the estate lifecycle.
 * Part of the tenancy module (it owns the same tables), kept separate so TenancyService stays free of
 * dependencies the authorization guard would loop on.
 */
@Module({
  imports: [AuthzModule, FilesModule, IdentityModule, NotificationsModule],
  controllers: [
    PublicOnboardingController,
    MyOnboardingController,
    PlatformOnboardingController,
    SetupController,
  ],
  providers: [
    ApplicationsService,
    EstatesAdminService,
    SetupService,
    SetupVerifiers,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [SetupVerifiers],
})
export class OnboardingModule {}
