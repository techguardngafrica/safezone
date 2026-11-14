/**
 * pnpm --filter @safezone/backend-api openapi
 * Writes packages/contracts/openapi.json from the API's route contracts. CI regenerates it and fails
 * when the committed file differs (the contract drifted from the code).
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../common/contract/openapi';
import { collectRoutes } from '../common/contract/route-catalogue';

async function main(): Promise<void> {
  process.env.OUTBOX_RELAY_DISABLED = 'true';
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  try {
    const routes = collectRoutes(app.get(ModulesContainer));
    const document = buildOpenApiDocument(routes, '0.1.0');
    const target = path.resolve(__dirname, '../../../../packages/contracts/openapi.json');
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
    console.warn(`openapi.json written (${routes.length} operations)`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'openapi generation failed');
  process.exit(1);
});
