import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FeatureFlagsService } from './feature-flags.service';
import { PlatformController } from './platform.controller';
import {
  EstateSupportAccessController,
  PlatformSupportAccessController,
} from './support-access.controller';
import { SupportAccessService } from './support-access.service';

/** Platform config and support-access consent. */
@Module({
  imports: [TenancyModule],
  controllers: [PlatformController, EstateSupportAccessController, PlatformSupportAccessController],
  providers: [FeatureFlagsService, SupportAccessService],
  exports: [FeatureFlagsService, SupportAccessService],
})
export class PlatformModule {}
