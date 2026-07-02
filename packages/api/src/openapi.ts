/**
 * Auto-generated OpenAPI 3.1 spec using @asteasolutions/zod-to-openapi.
 * Schemas are defined once in the route files and registered here.
 * The spec is served at GET /api/openapi.json and rendered at GET /api/docs.
 *
 * To regenerate after adding routes: the spec is built at server startup —
 * no manual update required.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Security schemes
registry.registerComponent('securitySchemes', 'BearerAuth', {
  type        : 'http',
  scheme      : 'bearer',
  bearerFormat: 'JWT or API key (prefix: pw_)',
  description : 'Pass a JWT access token or an API key (pw_...) as the Bearer token.',
});

// Common schemas
const UuidSchema     = z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' });
const DateTimeSchema = z.string().datetime().openapi({ example: '2025-01-15T10:30:00.000Z' });

const ErrorSchema = registry.register('Error', z.object({
  error: z.object({
    code   : z.string().openapi({ example: 'NOT_FOUND' }),
    message: z.string().openapi({ example: 'Monitor not found' }),
  }),
}));

const MonitorSchema = registry.register('Monitor', z.object({
  id                  : UuidSchema,
  workspaceId         : UuidSchema,
  name                : z.string().openapi({ example: 'Production API' }),
  url                 : z.string().url().openapi({ example: 'https://api.example.com/health' }),
  httpMethod          : z.enum(['GET', 'POST', 'HEAD']),
  expectedStatusCode  : z.number().int().openapi({ example: 200 }),
  checkIntervalSeconds: z.number().int().openapi({ example: 60 }),
  regionCodes         : z.array(z.string()).openapi({ example: ['us-east-1', 'eu-west-1'] }),
  isActive            : z.boolean(),
  bodyContains        : z.string().nullable().optional(),
  bodyJsonPath        : z.string().nullable().optional(),
  bodyJsonValue       : z.string().nullable().optional(),
  lastCheckedAt       : DateTimeSchema.nullable(),
  createdAt           : DateTimeSchema,
  updatedAt           : DateTimeSchema,
}));

const IncidentSchema = registry.register('Incident', z.object({
  id             : UuidSchema,
  monitorId      : UuidSchema,
  status         : z.enum(['open', 'acknowledged', 'resolved']),
  startedAt      : DateTimeSchema,
  acknowledgedAt : DateTimeSchema.nullable(),
  acknowledgedBy : UuidSchema.nullable(),
  resolvedAt     : DateTimeSchema.nullable(),
  durationSeconds: z.number().int().nullable(),
  groupId        : UuidSchema.nullable(),
}));

const ApiKeySchema = registry.register('ApiKey', z.object({
  id         : UuidSchema,
  workspaceId: UuidSchema,
  name       : z.string().openapi({ example: 'CI Deploy Key' }),
  keyPrefix  : z.string().openapi({ example: 'pw_abc12345' }),
  role       : z.enum(['admin', 'viewer']),
  lastUsedAt : DateTimeSchema.nullable(),
  expiresAt  : DateTimeSchema.nullable(),
  revoked    : z.boolean(),
  createdAt  : DateTimeSchema,
}));

// Auth routes
registry.registerPath({
  method     : 'post',
  path       : '/api/auth/register',
  summary    : 'Register a new user',
  tags       : ['Auth'],
  security   : [],
  request    : {
    body: {
      required: true,
      content : { 'application/json': { schema: z.object({ name: z.string().min(1).max(100), email: z.string().email(), password: z.string().min(8).max(128) }) } },
    },
  },
  responses  : {
    201: { description: 'User registered', content: { 'application/json': { schema: z.object({ data: z.object({ accessToken: z.string(), user: z.object({ id: UuidSchema, email: z.string(), name: z.string(), emailVerified: z.boolean() }) }) }) } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method   : 'post',
  path     : '/api/auth/login',
  summary  : 'Login with email and password',
  tags     : ['Auth'],
  security : [],
  request  : { body: { required: true, content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } } },
  responses: {
    200: { description: 'Access token + refresh cookie set', content: { 'application/json': { schema: z.object({ data: z.object({ accessToken: z.string() }) }) } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Email not verified', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

registry.registerPath({ method: 'post', path: '/api/auth/refresh',            summary: 'Refresh access token (uses httpOnly refresh cookie)', tags: ['Auth'], security: [], responses: { 200: { description: 'New access + refresh token' }, 401: { description: 'Invalid or replayed token' } } });
registry.registerPath({ method: 'post', path: '/api/auth/logout',             summary: 'Logout and revoke refresh token', tags: ['Auth'], responses: { 200: { description: 'Logged out' } } });
registry.registerPath({ method: 'post', path: '/api/auth/verify-email',       summary: 'Verify email address with token', tags: ['Auth'], security: [], responses: { 200: { description: 'Email verified' }, 400: { description: 'Invalid or expired token' } } });
registry.registerPath({ method: 'post', path: '/api/auth/resend-verification', summary: 'Resend verification email', tags: ['Auth'], responses: { 200: { description: 'Email sent' }, 409: { description: 'Already verified' } } });
registry.registerPath({ method: 'post', path: '/api/auth/forgot-password',    summary: 'Request password reset (always 200)', tags: ['Auth'], security: [], responses: { 200: { description: 'If email exists, reset link was sent' } } });
registry.registerPath({ method: 'post', path: '/api/auth/reset-password',     summary: 'Reset password using token', tags: ['Auth'], security: [], responses: { 200: { description: 'Password reset, all sessions revoked' }, 400: { description: 'Invalid or expired token' } } });

// Monitor routes
registry.registerPath({
  method    : 'get',
  path      : '/api/monitors/workspace/{workspaceId}',
  summary   : 'List monitors',
  tags      : ['Monitors'],
  security  : [{ BearerAuth: [] }],
  request   : { params: z.object({ workspaceId: UuidSchema }), query: z.object({ cursor: z.string().optional(), pageSize: z.coerce.number().int().max(500).default(200).optional() }) },
  responses : { 200: { description: 'Paginated monitor list', content: { 'application/json': { schema: z.object({ data: z.array(MonitorSchema), nextCursor: z.string().nullable() }) } } } },
});

registry.registerPath({
  method    : 'post',
  path      : '/api/monitors/workspace/{workspaceId}',
  summary   : 'Create a monitor',
  tags      : ['Monitors'],
  security  : [{ BearerAuth: [] }],
  request   : { params: z.object({ workspaceId: UuidSchema }) },
  responses : {
    201: { description: 'Monitor created', content: { 'application/json': { schema: z.object({ data: MonitorSchema }) } } },
    403: { description: 'Plan monitor limit reached', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

registry.registerPath({ method: 'get',    path: '/api/monitors/{id}/workspace/{workspaceId}',        summary: 'Get monitor with latest state + uptime', tags: ['Monitors'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Monitor detail' }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'patch',  path: '/api/monitors/{id}/workspace/{workspaceId}',        summary: 'Update monitor (If-Match header for optimistic lock)', tags: ['Monitors'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Updated' }, 409: { description: 'Stale update — If-Match mismatch' } } });
registry.registerPath({ method: 'delete', path: '/api/monitors/{id}/workspace/{workspaceId}',        summary: 'Delete monitor (resolves open incidents)', tags: ['Monitors'], security: [{ BearerAuth: [] }], responses: { 204: { description: 'Deleted' } } });
registry.registerPath({ method: 'get',    path: '/api/monitors/{id}/workspace/{workspaceId}/stats',  summary: 'Response time percentile stats', tags: ['Monitors'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'p50/p75/p95/p99 per time bucket' } } });
registry.registerPath({ method: 'get',    path: '/api/monitors/{id}/workspace/{workspaceId}/checks', summary: 'Check result history (cursor paginated)', tags: ['Monitors'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Check results' } } });

// Incident routes
registry.registerPath({ method: 'get',  path: '/api/incidents/workspace/{workspaceId}',                       summary: 'List incidents (keyset paginated)', tags: ['Incidents'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Incidents + nextCursor + total', content: { 'application/json': { schema: z.object({ data: z.array(IncidentSchema), total: z.number(), nextCursor: z.string().nullable() }) } } } } });
registry.registerPath({ method: 'get',  path: '/api/incidents/{id}/workspace/{workspaceId}',                  summary: 'Get incident with timeline', tags: ['Incidents'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Incident detail + timeline events' }, 404: { description: 'Not found or wrong workspace' } } });
registry.registerPath({ method: 'post', path: '/api/incidents/{id}/workspace/{workspaceId}/acknowledge',       summary: 'Acknowledge an open incident', tags: ['Incidents'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Acknowledged' }, 409: { description: 'Not in open state' } } });
registry.registerPath({ method: 'post', path: '/api/incidents/{id}/workspace/{workspaceId}/resolve',           summary: 'Manually resolve an incident', tags: ['Incidents'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Resolved' }, 409: { description: 'Already resolved' } } });
registry.registerPath({ method: 'post', path: '/api/incidents/{id}/workspace/{workspaceId}/notes',             summary: 'Add a note to the incident timeline', tags: ['Incidents'], security: [{ BearerAuth: [] }], responses: { 201: { description: 'Note added' } } });

// API Key routes
registry.registerPath({ method: 'get',    path: '/api/api-keys/workspace/{workspaceId}',         summary: 'List API keys (no secret values)', tags: ['API Keys'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Key list', content: { 'application/json': { schema: z.object({ data: z.array(ApiKeySchema) }) } } } } });
registry.registerPath({ method: 'post',   path: '/api/api-keys/workspace/{workspaceId}',         summary: 'Create API key — raw key returned once only', tags: ['API Keys'], security: [{ BearerAuth: [] }], responses: { 201: { description: 'Key created with raw value (pw_...)' } } });
registry.registerPath({ method: 'delete', path: '/api/api-keys/workspace/{workspaceId}/{keyId}', summary: 'Revoke an API key', tags: ['API Keys'], security: [{ BearerAuth: [] }], responses: { 204: { description: 'Revoked' } } });

// Feature flags
registry.registerPath({ method: 'get', path: '/api/flags/workspace/{workspaceId}',             summary: 'List feature flags with resolved values', tags: ['Feature Flags'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Flag list' } } });
registry.registerPath({ method: 'put', path: '/api/flags/workspace/{workspaceId}/{flagName}',  summary: 'Override a feature flag for a workspace (admin only)', tags: ['Feature Flags'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Flag updated' } } });

// Status page (public)
registry.registerPath({ method: 'get', path: '/api/status/{slug}',        summary: 'Public status page data', tags: ['Status'], security: [], responses: { 200: { description: 'Per-monitor status + 90d uptime + overall status' }, 404: { description: 'Workspace not found' } } });
registry.registerPath({ method: 'get', path: '/api/status/{slug}/events', summary: 'SSE stream with initial snapshot (public)', tags: ['Status'], security: [], responses: { 200: { description: 'text/event-stream — first event is a full state snapshot' } } });

// Internal SSE
registry.registerPath({ method: 'get', path: '/api/events/workspace/{workspaceId}', summary: 'Authenticated SSE stream — sends snapshot on connect', tags: ['Events'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'text/event-stream' } } });

// Billing
registry.registerPath({ method: 'post', path: '/api/billing/workspace/{workspaceId}/checkout', summary: 'Create Stripe checkout session', tags: ['Billing'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Stripe checkout URL' } } });
registry.registerPath({ method: 'post', path: '/api/billing/workspace/{workspaceId}/portal',   summary: 'Create Stripe billing portal session', tags: ['Billing'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Stripe portal URL' } } });
registry.registerPath({ method: 'post', path: '/api/billing/webhook',                          summary: 'Stripe webhook receiver', tags: ['Billing'], security: [], responses: { 200: { description: 'Received' } } });

// Health + Metrics
registry.registerPath({ method: 'get', path: '/health/live',  summary: 'Liveness probe — always 200 if process is alive', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } });
registry.registerPath({ method: 'get', path: '/health/ready', summary: 'Readiness probe — checks Postgres + Redis', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' }, 503: { description: 'Dependency unavailable' } } });
registry.registerPath({ method: 'get', path: '/metrics',      summary: 'Prometheus metrics (requires METRICS_TOKEN bearer)', tags: ['Observability'], security: [{ BearerAuth: [] }], responses: { 200: { description: 'Prometheus text format 0.0.4' } } });

// Generate the spec
const generator = new OpenApiGeneratorV31(registry.definitions);
export const openApiSpec: any = generator.generateDocument({
  openapi: '3.1.0',
  info   : {
    title      : 'Pulseway API',
    version    : '1.0.0',
    description: [
      'Uptime monitoring API.',
      '',
      '**Authentication:** Pass a JWT access token or an API key (`pw_...`) as `Authorization: Bearer <token>`.',
      '',
      '**Pagination:** Incidents and monitors use keyset pagination — pass `nextCursor` from the previous response as `cursor` in the next request.',
      '',
      '**Optimistic locking:** For `PATCH /monitors/:id`, pass `If-Match: <monitor.updatedAt>` to prevent conflicting concurrent updates.',
    ].join('\n'),
  },
  servers : [
    { url: 'https://api.pulseway.dev', description: 'Production' },
    { url: 'https://staging.api.pulseway.dev', description: 'Staging' },
    { url: 'http://localhost:4000', description: 'Local' },
  ],
});
