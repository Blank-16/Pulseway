/**
 * Minimal OpenAPI 3.1 spec generated from route structure.
 * Served at GET /api/docs and GET /api/openapi.json.
 * For full schema generation, integrate @asteasolutions/zod-to-openapi.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title  : 'Pulseway API',
    version: '3.0.0',
    description: 'Uptime monitoring API. Authenticate with Bearer JWT or Bearer API key (prefix: pw_).',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT or API key' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code   : { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
            required: ['code', 'message'],
          },
        },
      },
      Monitor: {
        type: 'object',
        properties: {
          id                  : { type: 'string', format: 'uuid' },
          workspaceId         : { type: 'string', format: 'uuid' },
          name                : { type: 'string' },
          url                 : { type: 'string', format: 'uri' },
          httpMethod          : { type: 'string', enum: ['GET', 'POST', 'HEAD'] },
          expectedStatusCode  : { type: 'integer' },
          checkIntervalSeconds: { type: 'integer', enum: [30, 60, 300, 600] },
          regionCodes         : { type: 'array', items: { type: 'string' } },
          isActive            : { type: 'boolean' },
          createdAt           : { type: 'string', format: 'date-time' },
          updatedAt           : { type: 'string', format: 'date-time' },
        },
      },
      Incident: {
        type: 'object',
        properties: {
          id             : { type: 'string', format: 'uuid' },
          monitorId      : { type: 'string', format: 'uuid' },
          status         : { type: 'string', enum: ['open', 'acknowledged', 'resolved'] },
          startedAt      : { type: 'string', format: 'date-time' },
          acknowledgedAt : { type: 'string', format: 'date-time', nullable: true },
          resolvedAt     : { type: 'string', format: 'date-time', nullable: true },
          durationSeconds: { type: 'integer', nullable: true },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/auth/register': {
      post: {
        tags      : ['Auth'],
        summary   : 'Register a new user',
        security  : [],
        requestBody: {
          required: true,
          content : { 'application/json': { schema: {
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
          }}},
        },
        responses: { 201: { description: 'User registered' }, 409: { description: 'Email taken' } },
      },
    },
    '/auth/login': {
      post: {
        tags      : ['Auth'],
        summary   : 'Login',
        security  : [],
        requestBody: {
          required: true,
          content : { 'application/json': { schema: {
            type: 'object', required: ['email', 'password'],
            properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
          }}},
        },
        responses: { 200: { description: 'Returns access token' }, 401: { description: 'Invalid credentials' } },
      },
    },
    '/auth/refresh'        : { post: { tags: ['Auth'], summary: 'Refresh access token via cookie', security: [], responses: { 200: { description: 'New access token' } } } },
    '/auth/logout'         : { post: { tags: ['Auth'], summary: 'Logout and revoke refresh token', responses: { 200: { description: 'OK' } } } },
    '/auth/verify-email'   : { post: { tags: ['Auth'], summary: 'Verify email address', security: [], responses: { 200: { description: 'OK' }, 400: { description: 'Invalid token' } } } },
    '/auth/forgot-password': { post: { tags: ['Auth'], summary: 'Request password reset email', security: [], responses: { 200: { description: 'Always 200 (email-blind)' } } } },
    '/auth/reset-password' : { post: { tags: ['Auth'], summary: 'Reset password using token', security: [], responses: { 200: { description: 'OK' }, 400: { description: 'Invalid token' } } } },
    '/monitors/workspace/{workspaceId}': {
      get : { tags: ['Monitors'], summary: 'List monitors', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }, { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 200 } }], responses: { 200: { description: 'Monitor list' } } },
      post: { tags: ['Monitors'], summary: 'Create monitor', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Created' }, 403: { description: 'Plan limit exceeded' } } },
    },
    '/incidents/workspace/{workspaceId}': {
      get: { tags: ['Incidents'], summary: 'List incidents (keyset paginated)', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Incident list with nextCursor' } } },
    },
    '/api-keys/workspace/{workspaceId}': {
      get : { tags: ['API Keys'], summary: 'List API keys', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Key list (no secret values)' } } },
      post: { tags: ['API Keys'], summary: 'Create API key (secret returned once)', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Key created with raw value' } } },
    },
    '/health/live' : { get: { tags: ['Health'], summary: 'Liveness probe', security: [], responses: { 200: { description: 'Process alive' } } } },
    '/health/ready': { get: { tags: ['Health'], summary: 'Readiness probe (checks DB + Redis)', security: [], responses: { 200: { description: 'Ready' }, 503: { description: 'Dependency unavailable' } } } },
    '/metrics'     : { get: { tags: ['Observability'], summary: 'Prometheus metrics (requires METRICS_TOKEN bearer)', responses: { 200: { description: 'Prometheus text format' } } } },
  },
} as const;
