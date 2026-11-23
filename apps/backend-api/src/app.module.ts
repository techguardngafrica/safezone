import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './common/database/database.module';
import { HealthController } from './common/health/health.controller';
import { HttpCoreModule } from './common/http/http-core.module';
import { RealtimePublisherModule } from './common/realtime/realtime-publisher.service';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { QueuesModule } from './common/queues/queues.module';
import { AuditModule } from './modules/audit/audit.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BillingModule } from './modules/billing/billing.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { MovesModule } from './modules/occupancy/moves/moves.module';
import { ExportsModule } from './modules/platform/exports/exports.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AdvertisingModule } from './modules/advertising/advertising.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { StaffModule } from './modules/staff/staff.module';
import { ExportRegistryModule } from './common/export/export-registry';
import { PaymentsModule } from './modules/payments/payments.module';
import { UtilityPurchasesModule } from './modules/utilities/purchases/purchases.module';
import { UtilitiesModule } from './modules/utilities/utilities.module';
import { CommunityModule } from './modules/community/community.module';
import { EmergencyModule } from './modules/emergency/emergency.module';
import { AuthorizationGuard } from './modules/authz/authorization.guard';
import { AuthzModule } from './modules/authz/authz.module';
import { AuthenticationGuard } from './modules/identity/authentication.guard';
import { IdentityModule } from './modules/identity/identity.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PlatformAdminModule } from './modules/platform/admin/platform-admin.module';
import { OccupancyModule } from './modules/occupancy/occupancy.module';
import { PropertyModule } from './modules/property/property.module';
import { SecurityModule } from './modules/security/security.module';
import { VisitorModule } from './modules/visitor/visitor.module';
import { OnboardingModule } from './modules/tenancy/onboarding/onboarding.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

/**
 * Root module for the HTTP API process. Domain modules are added in phase order.
 * Guards run in order: AuthenticationGuard (who), then AuthorizationGuard (may they). Every route
 * must declare @Public, @SignedIn, @Member or @Can.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    RealtimePublisherModule,
    HttpCoreModule,
    QueuesModule,
    IntegrationsModule,
    AuditModule,
    TenancyModule,
    AuthzModule,
    IdentityModule,
    NotificationsModule,
    FilesModule,
    PlatformModule,
    OnboardingModule,
    PropertyModule,
    OccupancyModule,
    SecurityModule,
    VisitorModule,
    EmergencyModule,
    CommunityModule,
    BillingModule,
    AccountingModule,
    ProcurementModule,
    WorkforceModule,
    GovernanceModule,
    AnalyticsModule,
    PaymentsModule,
    MaintenanceModule,
    UtilitiesModule,
    UtilityPurchasesModule,
    MovesModule,
    ExportRegistryModule,
    ExportsModule,
    FacilitiesModule,
    MarketplaceModule,
    AdvertisingModule,
    DocumentsModule,
    ImportsModule,
    ReportsModule,
    SearchModule,
    StaffModule,
    PlatformAdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AppModule {}
