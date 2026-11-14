import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { JsonLogger } from './common/observability/json-logger';
import { loadEnv } from './config/env';
import { configureHttpApp } from './common/http/configure-http-app';
import { RealtimeModule } from './realtime/realtime.module';

/**
 * Realtime gateway process (APP_PROCESS=realtime): Socket.IO for SOS, gate events, chat and dashboards.
 * Phase 0 adds the Redis adapter (@socket.io/redis-adapter) and token authentication on connect.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(RealtimeModule, {
    logger: new JsonLogger(env.LOG_LEVEL, 'realtime'),
    bodyParser: false,
  });
  configureHttpApp(app, env);
  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(env.REALTIME_PORT);
  Logger.log(`Realtime gateway listening on port ${env.REALTIME_PORT}`, 'Bootstrap');
}

void bootstrap();
