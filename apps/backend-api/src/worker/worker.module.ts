import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { OutboxRelay } from '../common/outbox/outbox-relay';
import { QueuesModule } from '../common/queues/queues.module';
import { RedisModule } from '../common/redis/redis.module';
import { ConfigModule } from '../config/config.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuditConsumer } from '../modules/audit/audit.consumer';
import { AuditService } from '../modules/audit/audit.service';
import { AuthzService } from '../modules/authz/authz.service';
import { SosConsumer } from '../modules/emergency/sos.consumer';
import { UserDirectory } from '../modules/identity/user-directory.service';
import { PropertyService } from '../modules/property/property.service';
import { FilesConsumer } from '../modules/files/files.consumer';
import { FilesService } from '../modules/files/files.service';
import { DeliveryService } from '../modules/notifications/delivery.service';
import { ContactDeliveryService } from '../modules/notifications/contact-delivery.service';
import { NotificationsConsumer } from '../modules/notifications/notifications.consumer';
import { OnboardingConsumer } from '../modules/tenancy/onboarding/onboarding.consumer';
import { TenancyService } from '../modules/tenancy/tenancy.service';
import { PassKeysService } from '../modules/visitor/pass-keys.service';
import { VisitorConsumer } from '../modules/visitor/visitor.consumer';

/**
 * Root module for the worker process: outbox relay and queue consumers.
 * SosConsumer is the `sos` queue's own worker pool; never put other work on that queue.
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
    ContactDeliveryService,
    OnboardingConsumer,
    TenancyService,
    PassKeysService,
    VisitorConsumer,
    AuthzService,
    UserDirectory,
    PropertyService,
    SosConsumer,
  ],
})
export class WorkerModule {}
