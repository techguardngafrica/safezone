import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../config/env';

/**
 * Socket.IO adapter backed by @socket.io/redis-adapter so multiple realtime processes share room state.
 * Enforces explicit CORS allowlist from env.CORS_ORIGINS (AGENTS.md §6.1).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  private pubClient: Redis | undefined;
  private subClient: Redis | undefined;

  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    this.pubClient = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectionName: 'safezone-realtime-pub',
    });
    this.subClient = this.pubClient.duplicate({
      connectionName: 'safezone-realtime-sub',
    });
    this.pubClient.on('error', (error: Error) =>
      this.redisLogger.warn({ msg: 'redis adapter pub error', error: error.name }),
    );
    this.subClient.on('error', (error: Error) =>
      this.redisLogger.warn({ msg: 'redis adapter sub error', error: error.name }),
    );
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const merged: Partial<ServerOptions> = {
      ...(options ?? {}),
      cors: {
        origin: this.env.CORS_ORIGINS,
        credentials: true,
      },
    };
    const server = super.createIOServer(port, merged as ServerOptions) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
