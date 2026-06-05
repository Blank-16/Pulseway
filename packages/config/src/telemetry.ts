/**
 * Shared OTEL trace context propagation helpers.
 * Lives in @pulseway/config so both the scheduler and worker can import
 * without creating a cross-package dependency on @pulseway/worker.
 */
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';

export type SQSMessageAttr = { DataType: string; StringValue: string };

/**
 * Injects the active OTEL trace context into a string-keyed attribute map.
 * Works for both SQS MessageAttributes and Azure Service Bus ApplicationProperties.
 */
export function injectTraceContext(): Record<string, SQSMessageAttr> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const attrs: Record<string, SQSMessageAttr> = {};
  for (const [key, value] of Object.entries(carrier)) {
    attrs[key] = { DataType: 'String', StringValue: value };
  }
  return attrs;
}

/**
 * Extracts OTEL trace context from a string-keyed attribute map.
 * Returns an active context suitable for otelContext.with().
 */
export function extractTraceContext(
  attrs: Record<string, { StringValue?: string }> = {},
): ReturnType<typeof context.active> {
  const carrier: Record<string, string> = {};
  for (const [key, attr] of Object.entries(attrs)) {
    if (attr.StringValue) carrier[key] = attr.StringValue;
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}
