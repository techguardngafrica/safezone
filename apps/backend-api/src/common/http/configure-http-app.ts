import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '../../config/env';

/** Settings shared by the API and realtime HTTP servers. */
export function configureHttpApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.set('trust proxy', env.TRUST_PROXY_HOPS);
  express.useBodyParser('json', { limit: '256kb' });
  express.use(
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  // Explicit allowlist only (AGENTS.md §6.1).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
}
