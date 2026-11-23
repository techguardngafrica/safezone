import { Module } from '@nestjs/common';
import { EstateNotificationTemplatesController } from './estate-notification-templates.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** API side. The worker adds DeliveryService and NotificationsConsumer (worker.module.ts). */
@Module({
  controllers: [NotificationsController, EstateNotificationTemplatesController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
