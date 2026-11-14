import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApp } from './common/http/configure-http-app';
import { JsonLogger } from './common/observability/json-logger';
import { loadEnv } from './config/env';

/** HTTP API process (APP_PROCESS=api). */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(env.LOG_LEVEL, 'api'),
    bodyParser: false,
    // Webhook signatures are computed over the exact bytes received.
    rawBody: true,
  });
  configureHttpApp(app, env);

  await app.listen(env.API_PORT);
  Logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
