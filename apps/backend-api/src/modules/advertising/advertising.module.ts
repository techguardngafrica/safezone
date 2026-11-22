import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { FilesModule } from '../files/files.module';
import { IdentityModule } from '../identity/identity.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AdCache } from './ad-cache';
import { AdvertisersService } from './advertisers.service';
import { AdvertisingController } from './advertising.controller';
import { CampaignsService } from './campaigns.service';
import { DecisionsService } from './decisions.service';
import { PlatformAdvertisingController } from './platform-advertising.controller';

/**
 * Managed advertising (advertising.md, ADR-0024). AdvertisingConsumer runs in the worker; the access
 * module (access/) is used by the authorization guard.
 */
@Module({
  imports: [FilesModule, IdentityModule, OccupancyModule, PaymentsModule, TenancyModule],
  controllers: [AdvertisingController, PlatformAdvertisingController],
  providers: [
    AdCache,
    AdvertisersService,
    CampaignsService,
    DecisionsService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [AdvertisersService, CampaignsService, DecisionsService],
})
export class AdvertisingModule {}
