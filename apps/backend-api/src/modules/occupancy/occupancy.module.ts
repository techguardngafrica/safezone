import { Module } from '@nestjs/common';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzModule } from '../authz/authz.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { JoinRequestsService } from './join-requests.service';
import { EstateOccupancyController, MyOccupancyController } from './occupancy.controller';
import { OccupancyService } from './occupancy.service';

@Module({
  imports: [TenancyModule, AuthzModule, IdentityModule, NotificationsModule, PropertyModule],
  controllers: [MyOccupancyController, EstateOccupancyController],
  providers: [
    OccupancyService,
    JoinRequestsService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [OccupancyService],
})
export class OccupancyModule {}
