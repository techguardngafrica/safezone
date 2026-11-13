import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { loadEnv } from './config/env';
import { RealtimeModule } from './realtime/realtime.module';

/**
 * Realtime gateway process (APP_PROCESS=realtime): Socket.IO for SOS, gate events, chat and dashboards.
 * Phase 0 adds the Redis adapter (@socket.io/redis-adapter) and token authentication on connect.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(RealtimeModule, { bufferLogs: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.REALTIME_PORT);
  Logger.log(`Realtime gateway listening on ws://localhost:${env.REALTIME_PORT}`, 'Bootstrap');
}

void bootstrap();
