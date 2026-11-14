import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { OutboxRelay } from '../common/outbox/outbox-relay';
import { QueuesModule } from '../common/queues/queues.module';
import { RedisModule } from '../common/redis/redis.module';
import { ConfigModule } from '../config/config.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuditConsumer } from '../modules/audit/audit.consumer';
import { AuditService } from '../modules/audit/audit.service';
import { FilesConsumer } from '../modules/files/files.consumer';
import { FilesService } from '../modules/files/files.service';
import { DeliveryService } from '../modules/notifications/delivery.service';
import { NotificationsConsumer } from '../modules/notifications/notifications.consumer';

/**
 * Root module for the worker process: outbox relay and queue consumers.
 * The `sos` queue gets its own worker pool when the emergency module lands (Phase 1); never put other
 * work on it.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, QueuesModule, IntegrationsModule],
  providers: [
    OutboxRelay,
    AuditService,
    AuditConsumer,
    DeliveryService,
    NotificationsConsumer,
    FilesService,
    FilesConsumer,
  ],
})
export class WorkerModule {}
