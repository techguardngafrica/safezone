import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { FeatureFlagsService } from './feature-flags.service';
import { PlatformController } from './platform.controller';
import {
  EstateSupportAccessController,
  PlatformSupportAccessController,
} from './support-access.controller';
import { SupportAccessService } from './support-access.service';
import { SupportTicketsController } from './support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';

/** Platform config, support-access consent, support tickets and compliance (ADR-0022). */
@Module({
  imports: [TenancyModule],
  controllers: [
    PlatformController,
    EstateSupportAccessController,
    PlatformSupportAccessController,
    SupportTicketsController,
    ComplianceController,
  ],
  providers: [FeatureFlagsService, SupportAccessService, SupportTicketsService, ComplianceService],
  exports: [FeatureFlagsService, SupportAccessService, SupportTicketsService, ComplianceService],
})
export class PlatformModule {}
