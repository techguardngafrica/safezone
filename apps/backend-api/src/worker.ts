import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker/worker.module';

/**
 * Background worker process (APP_PROCESS=worker).
 * Runs BullMQ processors: outbox relay, notifications, SOS fan-out (own pool), billing, imports, exports, ads.
 * Queues are registered in Phase 0 task 8 (see AGENTS.md §11).
 */
async function bootstrap(): Promise<void> {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.enableShutdownHooks();
  await app.init();
  app.flushLogs();
  Logger.log('Worker started (no queues registered yet)', 'Bootstrap');

  // Keep the process alive until queue processors hold their own Redis connections.
  const keepAlive = setInterval(() => undefined, 60_000);
  const stop = async () => {
    clearInterval(keepAlive);
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}

void bootstrap();
