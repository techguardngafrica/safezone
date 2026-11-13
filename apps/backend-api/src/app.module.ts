import { Module } from '@nestjs/common';
import { AppConfigController } from './common/app-config/app-config.controller';
import { HealthController } from './common/health/health.controller';
import { ConfigModule } from './config/config.module';

/**
 * Root module for the HTTP API process.
 * Domain modules are added under src/modules/<module>/ in phase order (see src/modules/README.md).
 */
@Module({
  imports: [ConfigModule],
  controllers: [HealthController, AppConfigController],
})
export class AppModule {}
