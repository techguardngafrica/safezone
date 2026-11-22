import { Module } from '@nestjs/common';
import { AuthzModule } from '../../authz/authz.module';
import { IdentityModule } from '../../identity/identity.module';
import { OnboardingModule } from '../../tenancy/onboarding/onboarding.module';
import { PlatformModule } from '../platform.module';
import { PlatformAdminController } from './platform-admin.controller';

/** Composition module for Super Admin overview and platform staff views (ADR-0021, ADR-0022). */
@Module({
  imports: [AuthzModule, IdentityModule, OnboardingModule, PlatformModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
