import { Module } from '@nestjs/common';
import { HealthController } from '../common/health/health.controller';
import { ConfigModule } from '../config/config.module';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [EventsGateway],
})
export class RealtimeModule {}
