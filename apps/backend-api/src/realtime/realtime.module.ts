import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { HealthController } from '../common/health/health.controller';
import { HttpCoreModule } from '../common/http/http-core.module';
import { RedisModule } from '../common/redis/redis.module';
import { ConfigModule } from '../config/config.module';
import { AuthzService } from '../modules/authz/authz.service';
import { ChannelMembershipReader } from '../modules/community/channel-membership.service';
import { TokenService } from '../modules/identity/token.service';
import { TenancyService } from '../modules/tenancy/tenancy.service';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, HttpCoreModule],
  controllers: [HealthController],
  providers: [TokenService, AuthzService, TenancyService, ChannelMembershipReader, EventsGateway],
})
export class RealtimeModule {}
