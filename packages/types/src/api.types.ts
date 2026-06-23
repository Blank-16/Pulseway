import type { MonitorStatus } from './monitor.types.js';

export type SSEEvent =
  | { type: 'check:completed'; data: { monitorId: string; status: MonitorStatus; responseTimeMs: number; region: string } }
  | { type: 'incident:opened'; data: { incidentId: string; monitorId: string } }
  | { type: 'incident:resolved'; data: { incidentId: string; durationSeconds: number } }
  | { type: 'alert:sent'; data: { incidentId: string; channel: string } };

export interface ApiResponse<T> {
  data: T;
}

/**
 * Cursor-based paginated response.
 * Pass nextCursor as `cursor` query param in the next request.
 * nextCursor is null when there are no more pages.
 */
export interface CursorPaginatedResponse<T> {
  data      : T[];
  total     : number;
  nextCursor: string | null;
}

/**
 * @deprecated Use CursorPaginatedResponse — the API uses keyset pagination.
 * Retained for backwards compatibility with any existing consumers.
 */
export interface PaginatedResponse<T> {
  data    : T[];
  total   : number;
  /** @deprecated */
  page    : number;
  /** @deprecated */
  pageSize: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
