import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/** Shared Redis connection for rate limits, caches and BullMQ producers. Connects on first command. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      connectionName: `safezone-${env.APP_PROCESS}`,
    });
    // Without a listener ioredis prints "Unhandled error event"; reconnects are automatic.
    this.client.on('error', (error: Error) =>
      this.logger.warn({ msg: 'redis error', error: error.name }),
    );
  }

  async isReady(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end' && this.client.status !== 'wait') await this.client.quit();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
