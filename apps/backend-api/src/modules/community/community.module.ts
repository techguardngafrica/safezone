import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AnnouncementsService } from './announcements.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [TenancyModule, PropertyModule, OccupancyModule, NotificationsModule],
  controllers: [CommunityController],
  providers: [AnnouncementsService],
})
export class CommunityModule {}
