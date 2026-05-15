import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { handler, authHandler } from '../middleware/handler.js';
import { getMemberRole } from '../services/MembershipCache.js';
import { AppError } from '../errors.js';
import type { SSEManager } from '../sse/SSEManager.js';

export function eventsRoutes(sseManager: SSEManager): Router {
  const router = Router();

  router.get('/workspace/:workspaceId',
    handler(authenticate),
    authHandler(async (req, res) => {
      const workspaceId = req.params['workspaceId']!;
      const role = await getMemberRole(req.user.id, workspaceId);
      if (!role) throw AppError.forbidden('Access denied');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const remove = sseManager.add(workspaceId, res);
      if (!remove) {
        res.write('event: error\ndata: {"code":"TOO_MANY_CONNECTIONS"}\n\n');
        res.end();
        return;
      }

      res.write(': connected\n\n');

      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
      }, 30_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        remove();
      });
    }),
  );

  return router;
}
