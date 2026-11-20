import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { OutboxRelay } from '../common/outbox/outbox-relay';
import { QueuesModule } from '../common/queues/queues.module';
import { RealtimePublisherModule } from '../common/realtime/realtime-publisher.service';
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
import { BillingConsumer } from '../modules/billing/billing.consumer';
import { BillingModule } from '../modules/billing/billing.module';
import { PaymentsConsumer } from '../modules/payments/payments.consumer';
import { PaymentsModule } from '../modules/payments/payments.module';
import { MaintenanceConsumer } from '../modules/maintenance/maintenance.consumer';
import { MaintenanceModule } from '../modules/maintenance/maintenance.module';
import { MovesConsumer } from '../modules/occupancy/moves/moves.consumer';
import { MovesModule } from '../modules/occupancy/moves/moves.module';
import { PurchasesConsumer } from '../modules/utilities/purchases/purchases.consumer';
import { UtilityPurchasesModule } from '../modules/utilities/purchases/purchases.module';
import { ExportRegistryModule } from '../common/export/export-registry';
import { ExportsConsumer } from '../modules/platform/exports/exports.consumer';
import { ExportsModule } from '../modules/platform/exports/exports.module';
import { FacilitiesConsumer } from '../modules/facilities/facilities.consumer';
import { CommunityConsumer } from '../modules/community/community.consumer';
import { FacilitiesModule } from '../modules/facilities/facilities.module';
import { DocumentsModule } from '../modules/documents/documents.module';
import { AuditModule } from '../modules/audit/audit.module';
import { CommunityModule } from '../modules/community/community.module';
import { EmergencyModule } from '../modules/emergency/emergency.module';

/**
 * Root module for the worker process: outbox relay and queue consumers.
 * SosConsumer is the `sos` queue's own worker pool; never put other work on that queue.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    RealtimePublisherModule,
    QueuesModule,
    IntegrationsModule,
    BillingModule,
    PaymentsModule,
    MaintenanceModule,
    MovesModule,
    UtilityPurchasesModule,
    ExportRegistryModule,
    ExportsModule,
    // Loaded so their export datasets are registered in the worker that builds exports.
    AuditModule,
    CommunityModule,
    EmergencyModule,
    FacilitiesModule,
    DocumentsModule,
  ],
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
    PaymentsConsumer,
    BillingConsumer,
    MaintenanceConsumer,
    MovesConsumer,
    PurchasesConsumer,
    ExportsConsumer,
    FacilitiesConsumer,
    CommunityConsumer,
  ],
})
export class WorkerModule {}
