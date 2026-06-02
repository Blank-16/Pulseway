import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody, validateQuery } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { MonitorService } from '../services/MonitorService.js';
import { auditService } from '../services/AuditService.js';
import { CheckResultRepository } from '@pulseway/db';

const CreateMonitorSchema = z.object({
  name                : z.string().min(1).max(200).trim(),
  url                 : z.string().url(),
  httpMethod          : z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  requestHeaders      : z.record(z.string()).default({}),
  expectedStatusCode  : z.number().int().min(100).max(599).default(200),
  checkIntervalSeconds: z.union([z.literal(30), z.literal(60), z.literal(300), z.literal(600)]).default(60),
  regionCodes         : z.array(z.string().min(1)).min(1).max(10).default(['us-east-1']),
  bodyContains        : z.string().max(500).optional(),
  bodyJsonPath        : z.string().max(200).optional(),
  bodyJsonValue       : z.string().max(500).optional(),
});

const UpdateMonitorSchema = CreateMonitorSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const StatsQuerySchema = z.object({
  range: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
});

const RANGE_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };

export function monitorRoutes(): Router {
  const router          = Router();
  const monitorService  = new MonitorService();
  const checkResultRepo = new CheckResultRepository();
  router.use(handler(authenticate));

  router.get('/workspace/:workspaceId',
    authHandler(authorize('viewer')),
    authHandler(async (req, res) => {
      const pageSize = Math.min(Number(req.query['pageSize'] ?? 200), 500);
      const cursor   = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
      const result   = await monitorService.list(req.params['workspaceId']!, pageSize, cursor);
      res.json({ data: result.monitors, nextCursor: result.nextCursor });
    }),
  );

  router.post('/workspace/:workspaceId',
    authHandler(authorize('admin')),
    handler(validateBody(CreateMonitorSchema)),
    authHandler(async (req, res) => {
      const monitor = await monitorService.create(req.params['workspaceId']!, req.body);
      auditService.log({ workspaceId: req.params['workspaceId']!, action: 'monitor.create', resourceType: 'monitor', resourceId: monitor.id, diff: req.body, req });
      res.status(201).json({ data: monitor });
    }),
  );

  router.get('/:id/workspace/:workspaceId',
    authHandler(authorize('viewer')),
    authHandler(async (req, res) => {
      const id          = req.params['id']!;
      const workspaceId = req.params['workspaceId']!;
      // All three calls validate workspace ownership — no cross-workspace data leak
      const [monitor, state, uptime30d] = await Promise.all([
        monitorService.get(id, workspaceId),
        monitorService.getLatestState(id, workspaceId),
        monitorService.getUptimePercent(id, workspaceId, 30),
      ]);
      res.json({ data: { ...monitor, latestState: state, uptime30d } });
    }),
  );

  router.patch('/:id/workspace/:workspaceId',
    authHandler(authorize('admin')),
    handler(validateBody(UpdateMonitorSchema)),
    authHandler(async (req, res) => {
      // If-Match: <updatedAt> enables optimistic locking — 409 on stale write
      const ifMatch = req.headers['if-match'] as string | undefined;
      const monitor = await monitorService.update(
        req.params['id']!, req.params['workspaceId']!, req.body, ifMatch,
      );
      auditService.log({ workspaceId: req.params['workspaceId']!, action: 'monitor.update', resourceType: 'monitor', resourceId: monitor.id, diff: req.body, req });
      res.json({ data: monitor });
    }),
  );

  router.delete('/:id/workspace/:workspaceId',
    authHandler(authorize('admin')),
    authHandler(async (req, res) => {
      await monitorService.delete(req.params['id']!, req.params['workspaceId']!);
      auditService.log({ workspaceId: req.params['workspaceId']!, action: 'monitor.delete', resourceType: 'monitor', resourceId: req.params['id']!, req });
      res.status(204).end();
    }),
  );

  router.get('/:id/workspace/:workspaceId/stats',
    authHandler(authorize('viewer')),
    handler(validateQuery(StatsQuerySchema)),
    authHandler(async (req, res) => {
      const hours = RANGE_HOURS[req.query['range'] as string] ?? 24;
      const stats = await monitorService.getStats(req.params['id']!, req.params['workspaceId']!, hours);
      res.json({ data: stats });
    }),
  );

  router.get('/:id/workspace/:workspaceId/checks',
    authHandler(authorize('viewer')),
    authHandler(async (req, res) => {
      // Ownership enforced by the service before reading checks
      await monitorService.get(req.params['id']!, req.params['workspaceId']!);
      const limit  = Math.min(Number(req.query['limit'] ?? 100), 500);
      const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
      const page   = await checkResultRepo.findByMonitorCursor(req.params['id']!, limit, cursor);
      res.json({ data: page.items, nextCursor: page.nextCursor });
    }),
  );

  return router;
}
