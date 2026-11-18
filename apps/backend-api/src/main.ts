import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApp } from './common/http/configure-http-app';
import { mountDevCheckout } from './integrations/payments/dev-checkout-routes';
import { PaymentGateway } from './integrations/payments/payment-gateway';
import { mountDevStorage } from './integrations/storage/dev-storage-routes';
import { ObjectStorage } from './integrations/storage/object-storage';
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
  // STORAGE_DRIVER=local (development only): the API serves its own signed upload/download URLs.
  if (mountDevStorage(app, app.get(ObjectStorage))) {
    Logger.log(`Local file storage in ${env.DEV_STORAGE_DIR} (no storage container)`, 'Bootstrap');
  }
  // PAYMENTS_PROVIDER=fake in development: a test checkout page to finish or fail payments by hand.
  if (mountDevCheckout(app, app.get(PaymentGateway))) {
    Logger.log('Test checkout at /dev-checkout/<reference> (fake payments)', 'Bootstrap');
  }

  await app.listen(env.API_PORT);
  Logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
