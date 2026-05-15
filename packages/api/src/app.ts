import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { getConfig } from '@pulseway/config';
import { SSEManager } from './sse/SSEManager.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthHandler } from './health.js';
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
    autoLogging : { ignore: (req) => req.url === '/health' },
    customProps : (req) => ({ requestId: req.id }),
    serializers : {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
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

  // General API rate limit
  app.use('/api', rateLimiter({ limit: 300, windowMs: 60_000, keyPrefix: 'rl:api' }));

  app.use('/api/auth',     authRoutes());
  app.use('/api/monitors', monitorRoutes());
  app.use('/api/incidents', incidentRoutes());
  app.use('/api/team',     teamRoutes());
  app.use('/api/billing',  billingRoutes());
  app.use('/api/status',   statusRoutes());
  app.use('/api/events',   eventsRoutes(sseManager));

  // /metrics requires bearer token from METRICS_TOKEN env var
  app.use('/metrics', metricsAuth(), metricsRoutes(sseManager));
  app.get('/health', healthHandler);

  app.use(errorHandler);

  return { express: app, sseManager };
}
