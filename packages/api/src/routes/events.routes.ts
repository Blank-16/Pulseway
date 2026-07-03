import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { handler, authHandler } from '../middleware/handler.js';
import { getMemberRole } from '../services/MembershipCache.js';
import { MonitorRepository, IncidentRepository } from '@pulseway/db';
import { getCacheClient } from '../redis.js';
import { AppError } from '../errors.js';
import type { SSEManager } from '../sse/SSEManager.js';

export function eventsRoutes(sseManager: SSEManager): Router {
  const router = Router();

  router.get('/workspace/:workspaceId',
    handler(authenticate),
    authHandler(async (req: any, res) => {
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

      // Send current state snapshot so the client doesn't need a separate REST call.
      // This eliminates the race window between REST hydration and SSE subscription.
      try {
        const monitorRepo  = new MonitorRepository();
        const incidentRepo = new IncidentRepository();
        const redis        = getCacheClient();

        const { monitors } = await monitorRepo.findByWorkspace(workspaceId, 500);
        const latestStates = await Promise.all(
          monitors.map(async (m) => {
            const raw = await redis.get(`monitor:${m.id}:latest`).catch(() => null);
            return { monitorId: m.id, ...(raw ? JSON.parse(raw) as Record<string, unknown> : { status: 'unknown' }) };
          }),
        );
        const openIncidents = await Promise.all(
          monitors.map((m) => incidentRepo.findOpenByMonitorId(m.id)),
        );

        res.write(`event: snapshot\ndata: ${JSON.stringify({
          monitors: latestStates,
          openIncidents: openIncidents
            .filter(Boolean)
            .map((inc) => ({ id: inc!.id, monitorId: inc!.monitorId, startedAt: inc!.startedAt, status: inc!.status })),
        })}\n\n`);
      } catch {
        // Snapshot is best-effort — client can fall back to REST
      }

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
