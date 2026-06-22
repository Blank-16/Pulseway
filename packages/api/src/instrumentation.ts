import { logger } from './logger.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

const isEnabled = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] !== undefined;

if (isEnabled) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'pulseway-api',
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '1.0.0',
      environment: process.env['NODE_ENV'] ?? 'development',
    }),
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
        }),
      ),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/health',
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true }),
      new IORedisInstrumentation({ requireParentSpan: true }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => sdk.shutdown().catch((err) => logger.error({ err }, 'OTEL SDK shutdown failed')));
}
