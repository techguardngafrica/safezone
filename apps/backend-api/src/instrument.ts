/**
 * Observability bootstrap: import this FIRST in every process entry point (main, worker, realtime)
 * so OpenTelemetry can patch modules before they load. Both are off unless configured.
 */
// Must stay the first import: it fills process.env from .env before anything reads it.
import './config/load-dotenv';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/nestjs';
import { loadEnv } from './config/env';
import { redact } from './common/observability/redact';

const env = loadEnv();
const serviceName = `safezone-${env.APP_PROCESS}`;

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    serverName: serviceName,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    beforeSend(event) {
      // Never ship request bodies, cookies, headers or query strings: they can hold PII or tokens.
      if (event.request) {
        event.request = { method: event.request.method, url: event.request.url?.split('?')[0] };
      }
      if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
      delete event.user;
      return event;
    },
  });
}

if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // URLs only; never record query strings or bodies.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') ?? false,
        },
      }),
    ],
  });
  sdk.start();
  const shutdown = () => void sdk.shutdown();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
