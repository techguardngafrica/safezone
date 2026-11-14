import { Module } from '@nestjs/common';
import { HealthController } from '../common/health/health.controller';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../common/database/database.module';
import { HttpCoreModule } from '../common/http/http-core.module';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [ConfigModule, DatabaseModule, HttpCoreModule],
  controllers: [HealthController],
  providers: [EventsGateway],
})
export class RealtimeModule {}
