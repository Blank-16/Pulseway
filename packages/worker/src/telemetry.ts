import { trace, context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { MessageAttributeValue } from '@aws-sdk/client-sqs';

const TRACEPARENT_KEY = 'traceparent';
const TRACESTATE_KEY  = 'tracestate';

/**
 * Injects the active OTEL trace context into SQS MessageAttributes.
 * Call this before SendMessageCommand to propagate trace across the queue boundary.
 */
export function injectTraceContext(): Record<string, MessageAttributeValue> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const attrs: Record<string, MessageAttributeValue> = {};
  for (const [key, value] of Object.entries(carrier)) {
    attrs[key] = { DataType: 'String', StringValue: value };
  }
  return attrs;
}

/**
 * Extracts OTEL trace context from SQS MessageAttributes.
 * Returns an active context that, when used, creates child spans of the originating trace.
 */
export function extractTraceContext(
  messageAttributes: Record<string, { StringValue?: string }> = {},
): ReturnType<typeof context.active> {
  const carrier: Record<string, string> = {};
  for (const [key, attr] of Object.entries(messageAttributes)) {
    if (attr.StringValue) carrier[key] = attr.StringValue;
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export function startWorkerSpan(name: string, ctx: ReturnType<typeof context.active>) {
  const tracer = trace.getTracer('pulseway-worker');
  return tracer.startActiveSpan(name, {}, ctx, (span) => span);
}
