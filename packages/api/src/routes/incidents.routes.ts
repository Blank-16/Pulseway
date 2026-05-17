import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { IncidentService } from '../services/IncidentService.js';
import { auditService } from '../services/AuditService.js';

const NoteSchema = z.object({ note: z.string().min(1).max(2000) });

export function incidentRoutes(): Router {
  const router         = Router();
  const incidentService = new IncidentService();
  router.use(handler(authenticate));

  router.get('/workspace/:workspaceId',
    authHandler(authorize('viewer')),
    authHandler(async (req, res) => {
      const pageSize = Math.min(Number(req.query['pageSize'] ?? 20), 100);
      const cursor   = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
      const result   = await incidentService.list(req.params['workspaceId']!, pageSize, cursor);
      res.json({ data: result.incidents, total: result.total, nextCursor: result.nextCursor });
    }),
  );

  router.get('/:id/workspace/:workspaceId',
    authHandler(authorize('viewer')),
    authHandler(async (req, res) => {
      const [incident, timeline] = await Promise.all([
        incidentService.get(req.params['id']!, req.params['workspaceId']!),
        incidentService.getTimeline(req.params['id']!, req.params['workspaceId']!),
      ]);
      res.json({ data: { ...incident, timeline } });
    }),
  );

  router.post('/:id/workspace/:workspaceId/acknowledge',
    authHandler(authorize('admin')),
    authHandler(async (req, res) => {
      const incident = await incidentService.acknowledge(req.params['id']!, req.params['workspaceId']!, req.user.id);
      auditService.log({ workspaceId: req.params['workspaceId']!, action: 'incident.acknowledge', resourceType: 'incident', resourceId: req.params['id']!, req });
      res.json({ data: incident });
    }),
  );

  router.post('/:id/workspace/:workspaceId/resolve',
    authHandler(authorize('admin')),
    authHandler(async (req, res) => {
      const incident = await incidentService.resolve(req.params['id']!, req.params['workspaceId']!, req.user.id);
      auditService.log({ workspaceId: req.params['workspaceId']!, action: 'incident.resolve', resourceType: 'incident', resourceId: req.params['id']!, req });
      res.json({ data: incident });
    }),
  );

  router.post('/:id/workspace/:workspaceId/notes',
    authHandler(authorize('viewer')),
    handler(validateBody(NoteSchema)),
    authHandler(async (req, res) => {
      const event = await incidentService.addNote(req.params['id']!, req.params['workspaceId']!, req.user.id, req.body.note);
      res.status(201).json({ data: event });
    }),
  );

  return router;
}
