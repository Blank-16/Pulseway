/**
 * Re-exports shared trace helpers from @pulseway/config.
 * Worker-specific span utilities (startWorkerSpan) remain here.
 */
export { injectTraceContext, extractTraceContext } from '@pulseway/config';

import { trace } from '@opentelemetry/api';
import type { context } from '@opentelemetry/api';

export function startWorkerSpan(
  name: string,
  ctx: ReturnType<typeof context.active>,
) {
  const tracer = trace.getTracer('pulseway-worker');
  return tracer.startActiveSpan(name, {}, ctx, (span) => span);
}
