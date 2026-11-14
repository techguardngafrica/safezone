import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { SecurityModule } from '../security/security.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { GateService } from './gate.service';
import { PassKeysService } from './pass-keys.service';
import { PassesService } from './passes.service';
import { PublicPassController, VisitorController } from './visitor.controller';

@Module({
  imports: [TenancyModule, PropertyModule, OccupancyModule, SecurityModule, NotificationsModule],
  controllers: [PublicPassController, VisitorController],
  providers: [
    PassKeysService,
    PassesService,
    GateService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [PassesService, GateService],
})
export class VisitorModule {}
