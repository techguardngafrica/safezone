import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './common/database/database.module';
import { HealthController } from './common/health/health.controller';
import { HttpCoreModule } from './common/http/http-core.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { QueuesModule } from './common/queues/queues.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthorizationGuard } from './modules/authz/authorization.guard';
import { AuthzModule } from './modules/authz/authz.module';
import { AuthenticationGuard } from './modules/identity/authentication.guard';
import { IdentityModule } from './modules/identity/identity.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformModule } from './modules/platform/platform.module';
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AppModule {}
