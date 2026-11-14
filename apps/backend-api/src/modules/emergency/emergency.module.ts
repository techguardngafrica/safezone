import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { EmergencyController } from './emergency.controller';
import { SosService } from './sos.service';

@Module({
  imports: [TenancyModule, AuthzModule, OccupancyModule, PropertyModule, NotificationsModule],
  controllers: [EmergencyController],
  providers: [SosService],
  exports: [SosService],
})
export class EmergencyModule {}
