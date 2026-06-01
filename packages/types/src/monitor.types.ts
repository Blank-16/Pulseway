export type MonitorStatus = 'up' | 'down' | 'degraded';
export type HttpMethod = 'GET' | 'POST' | 'HEAD';
export type CheckIntervalSeconds = 30 | 60 | 300 | 600;

export interface Monitor {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  httpMethod: HttpMethod;
  requestHeaders: Record<string, string>;
  expectedStatusCode: number;
  checkIntervalSeconds: CheckIntervalSeconds;
  regionCodes: string[];
  isActive: boolean;
  lastCheckedAt    : string | null;
  createdAt        : string;
  updatedAt        : string;
  bodyContains?    : string | null;
  bodyJsonPath?    : string | null;
  bodyJsonValue?   : string | null;
}

export interface CheckResult {
  id: string;
  monitorId: string;
  status: MonitorStatus;
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
  region: string;
  checkedAt: string;
}

export interface MonitorLatestState {
  status: MonitorStatus;
  responseTimeMs: number;
  checkedAt: string;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  bucketStart: string;
}

export interface CreateMonitorDTO {
  name: string;
  url: string;
  httpMethod: HttpMethod;
  requestHeaders: Record<string, string>;
  expectedStatusCode: number;
  checkIntervalSeconds: CheckIntervalSeconds;
  regionCodes     : string[];
  bodyContains?   : string;
  bodyJsonPath?   : string;
  bodyJsonValue?  : string;
}

export interface UpdateMonitorDTO extends Partial<CreateMonitorDTO> {
  isActive?: boolean;
}
