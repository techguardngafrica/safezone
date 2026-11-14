import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FeatureFlagsService } from './feature-flags.service';
import { PlatformController } from './platform.controller';

/** Platform config (Phase 0 part): feature flags and app versions. Support access etc. arrive in Phase 1. */
@Module({
  imports: [TenancyModule],
  controllers: [PlatformController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class PlatformModule {}
