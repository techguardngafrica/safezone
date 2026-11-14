import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JsonLogger } from './common/observability/json-logger';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker/worker.module';

/**
 * Background worker process (APP_PROCESS=worker).
 * Runs BullMQ processors: outbox relay, notifications, SOS fan-out (own pool), billing, imports, exports, ads.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new JsonLogger(env.LOG_LEVEL, 'worker'),
  });
  app.enableShutdownHooks();
  await app.init();
  Logger.log('Worker started: outbox relay and audit consumer running', 'Bootstrap');

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}

void bootstrap();
