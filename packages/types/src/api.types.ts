import type { MonitorStatus } from './monitor.types.js';

export type SSEEvent =
  | { type: 'check:completed'; data: { monitorId: string; status: MonitorStatus; responseTimeMs: number; region: string } }
  | { type: 'incident:opened'; data: { incidentId: string; monitorId: string } }
  | { type: 'incident:resolved'; data: { incidentId: string; durationSeconds: number } }
  | { type: 'alert:sent'; data: { incidentId: string; channel: string } };

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
