import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureHttpApp } from './common/http/configure-http-app';
import { JsonLogger } from './common/observability/json-logger';
import { loadEnv } from './config/env';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/**
 * Realtime gateway process (APP_PROCESS=realtime): Socket.IO with Redis adapter for SOS,
 * gate events, chat and dashboards.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(RealtimeModule, {
    logger: new JsonLogger(env.LOG_LEVEL, 'realtime'),
    bodyParser: false,
  });
  configureHttpApp(app, env);
  const redisAdapter = new RedisIoAdapter(app, env);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  await app.listen(env.REALTIME_PORT);
  Logger.log(`Realtime gateway listening on port ${env.REALTIME_PORT}`, 'Bootstrap');
}

void bootstrap();
