import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { getConfig } from '@pulseway/config';
import { SSEManager } from './sse/SSEManager.js';
import { errorHandler } from './middleware/error-handler.js';
import { livenessHandler, readinessHandler } from './health.js';
import { requestId } from './middleware/request-id.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { authRoutes } from './routes/auth.routes.js';
import { monitorRoutes } from './routes/monitors.routes.js';
import { incidentRoutes } from './routes/incidents.routes.js';
import { teamRoutes } from './routes/team.routes.js';
import { billingRoutes } from './routes/billing.routes.js';
import { statusRoutes } from './routes/status.routes.js';
import { eventsRoutes } from './routes/events.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { apiKeyRoutes } from './routes/api-keys.routes.js';
import { featureFlagRoutes } from './routes/feature-flags.routes.js';
import { openApiSpec } from './openapi.js';
import { logger } from './logger.js';
import { metricsAuth } from './middleware/metrics-auth.js';

export interface AppInstance {
  express: express.Express;
  sseManager: SSEManager;
}

export async function createApp(): Promise<AppInstance> {
  const app    = express();
  const config = getConfig();
  const sseManager = new SSEManager();

  // Trust exactly one proxy hop (ALB) so req.ip resolves to real client IP
  app.set('trust proxy', 1);

  app.use(compression({ threshold: 1024 })); // compress responses > 1KB

  // Security headers — helmet sets X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, X-XSS-Protection, and a restrictive CSP.
  // contentSecurityPolicy is loosened for the API (no inline scripts served).
  app.use(helmet({
    contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }));

  const allowedOrigins =
    config.NODE_ENV === 'production'
      ? ['https://app.pulseway.dev']
      : ['http://localhost:3000', 'http://localhost:4000'];

  // Stripe webhook needs raw body BEFORE json() parses it
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

  app.use(requestId());
  app.use(pinoHttp({
    logger,
    autoLogging : { ignore: (req) => req.url?.startsWith('/health') },
    customProps : (req) => ({
      requestId: (req as unknown as { id: string }).id,
      traceId  : (req as unknown as { traceId?: string }).traceId,
      spanId   : (req as unknown as { spanId?: string }).spanId,
    }),
    serializers : {
      req: (req) => ({ method: req.method, url: req.url, id: (req as unknown as { id: string }).id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Tight rate limits on auth endpoints to prevent brute-force
  app.use('/api/auth/login',    rateLimiter({ limit: 10,  windowMs: 60_000, keyPrefix: 'rl:login'    }));
  app.use('/api/auth/register', rateLimiter({ limit: 5,   windowMs: 60_000, keyPrefix: 'rl:register' }));
  app.use('/api/auth/refresh',  rateLimiter({ limit: 30,  windowMs: 60_000, keyPrefix: 'rl:refresh'  }));

  app.use('/api/auth/verify-email',    rateLimiter({ limit: 5,   windowMs: 60_000, keyPrefix: 'rl:verify'        }));
  app.use('/api/auth/resend-verification', rateLimiter({ limit: 3, windowMs: 300_000, keyPrefix: 'rl:resend'       }));
  app.use('/api/auth/forgot-password', rateLimiter({ limit: 3,   windowMs: 300_000, keyPrefix: 'rl:forgot'        }));
  app.use('/api/auth/reset-password',  rateLimiter({ limit: 5,   windowMs: 60_000,  keyPrefix: 'rl:reset'         }));

  // General API rate limit
  app.use('/api', rateLimiter({ limit: 300, windowMs: 60_000, keyPrefix: 'rl:api' }));

  app.use('/api/auth',     authRoutes());
  app.use('/api/monitors', monitorRoutes());
  app.use('/api/incidents', incidentRoutes());
  app.use('/api/team',     teamRoutes());
  app.use('/api/billing',  billingRoutes());
  app.use('/api/status',   statusRoutes(sseManager));
  app.use('/api/events',   eventsRoutes(sseManager));
  app.use('/api/api-keys', apiKeyRoutes());
  app.use('/api/flags',    featureFlagRoutes());

  // /metrics requires bearer token from METRICS_TOKEN env var
  app.use('/metrics', metricsAuth(), metricsRoutes(sseManager));

  // OpenAPI spec — no auth required (public contract)
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));
  app.get('/api/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><title>Pulseway API Docs</title>
      <meta charset="utf-8">
      <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
      </head><body>
      <rapi-doc spec-url="/api/openapi.json" theme="dark" show-header="false" render-style="read" style="height:100vh;width:100%"></rapi-doc>
      </body></html>`);
  });
  app.get('/health/live',  livenessHandler);
  app.get('/health/ready', readinessHandler);
  // Legacy alias
  app.get('/health', readinessHandler);

  app.use(errorHandler);

  return { express: app, sseManager };
}
