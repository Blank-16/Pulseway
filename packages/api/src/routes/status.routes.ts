import { Router } from 'express';
import { WorkspaceRepository, MonitorRepository, IncidentRepository } from '@pulseway/db';
import { StatsRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import { handler } from '../middleware/handler.js';
import type { SSEManager } from '../sse/SSEManager.js';

const workspaceRepo = new WorkspaceRepository();
const monitorRepo   = new MonitorRepository();
const incidentRepo  = new IncidentRepository();
const statsRepo     = new StatsRepository();

const DAILY_BUCKETS = 90;

export function statusRoutes(sseManager?: SSEManager): Router {
  const router = Router();

  // Public status page data — no auth required
  router.get('/:slug', handler(async (req, res) => {
    const workspace = await workspaceRepo.findBySlug(req.params['slug']!);
    if (!workspace) throw AppError.notFound('Status page not found');

    const { monitors } = await monitorRepo.findByWorkspace(workspace.id, 500);
    const activeMonitors = monitors.filter((m) => m.isActive);
    const monitorIds     = activeMonitors.map((m) => m.id);

    // Two queries total regardless of monitor count — no N+1
    const [openIncidentMap, uptimeMap] = await Promise.all([
      incidentRepo.findOpenByMonitorIds(monitorIds),
      statsRepo.getUptimePercentBatch(monitorIds, DAILY_BUCKETS),
    ]);

    const monitorData = activeMonitors.map((m) => ({
      id             : m.id,
      name           : m.name,
      url            : m.url,
      uptime90d      : uptimeMap.get(m.id) ?? 100,
      hasOpenIncident: openIncidentMap.has(m.id),
      currentStatus  : openIncidentMap.has(m.id) ? 'down' : 'operational',
    }));

    const openCount = monitorData.filter((m) => m.hasOpenIncident).length;
    const overallStatus =
      openCount === 0
        ? 'operational'
        : openCount < activeMonitors.length / 2
        ? 'partial_outage'
        : 'major_outage';

    // Cache for 30s — SSE pushes live updates to the browser
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.json({
      data: {
        workspace    : { name: workspace.name, slug: workspace.slug },
        overallStatus,
        monitors     : monitorData,
        generatedAt  : new Date().toISOString(),
      },
    });
  }));

  // SSE stream for the public status page — no auth, workspace-scoped
  router.get('/:slug/events', handler(async (req, res) => {
    if (!sseManager) { res.status(503).end(); return; }

    const workspace = await workspaceRepo.findBySlug(req.params['slug']!);
    if (!workspace) throw AppError.notFound('Status page not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const remove = sseManager.add(workspace.id, res);
    if (!remove) {
      res.write('event: error\ndata: {"code":"TOO_MANY_CONNECTIONS"}\n\n');
      res.end();
      return;
    }

    // Snapshot: two batch queries, not N per monitor
    const { monitors } = await monitorRepo.findByWorkspace(workspace.id, 500);
    const activeMonitors = monitors.filter((m) => m.isActive);
    const monitorIds     = activeMonitors.map((m) => m.id);
    const openIncidentMap = await incidentRepo.findOpenByMonitorIds(monitorIds);

    const snapshot = activeMonitors.map((m) => ({
      monitorId      : m.id,
      name           : m.name,
      hasOpenIncident: openIncidentMap.has(m.id),
    }));

    res.write(`event: snapshot\ndata: ${JSON.stringify({ monitors: snapshot })}\n\n`);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 30_000);

    req.on('close', () => { clearInterval(heartbeat); remove(); });
  }));

  return router;
}
