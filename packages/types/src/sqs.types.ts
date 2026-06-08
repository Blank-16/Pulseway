import type { HttpMethod } from './monitor.types.js';

export interface SqsCheckJob {
  monitorId: string;
  workspaceId: string;
  url: string;
  httpMethod: HttpMethod;
  requestHeaders: Record<string, string>;
  expectedStatusCode: number;
  region            : string;
  enqueuedAt        : string;
  bodyContains?     : string;
  bodyJsonPath?     : string;
  bodyJsonValue?    : string;
}

export interface SqsAlertJob {
  incidentId: string;
  monitorId: string;
  workspaceId: string;
  eventType: 'opened' | 'resolved';
  enqueuedAt: string;
}
