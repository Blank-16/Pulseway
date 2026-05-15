import { Router } from 'express';
import { WorkspaceRepository, MonitorRepository, IncidentRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import { handler } from '../middleware/handler.js';

const workspaceRepo = new WorkspaceRepository();
const monitorRepo = new MonitorRepository();
const incidentRepo = new IncidentRepository();

export function statusRoutes(): Router {
  const router = Router();

  router.get('/:slug', handler(async (req, res) => {
    const workspace = await workspaceRepo.findBySlug(req.params['slug']!);
    if (!workspace) throw AppError.notFound('Status page not found');

    const monitors = await monitorRepo.findByWorkspace(workspace.id);

    const openIncidents = (
      await Promise.all(monitors.map((m) => incidentRepo.findOpenByMonitorId(m.id)))
    ).filter(Boolean);

    const overallStatus =
      openIncidents.length === 0
        ? 'operational'
        : openIncidents.length < monitors.length / 2
        ? 'partial_outage'
        : 'major_outage';

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.json({
      data: {
        workspace: { name: workspace.name, slug: workspace.slug },
        overallStatus,
        monitors: monitors.map((m) => ({
          id: m.id,
          name: m.name,
          url: m.url,
          isActive: m.isActive,
          hasOpenIncident: openIncidents.some((i) => i?.monitorId === m.id),
        })),
        openIncidents,
      },
    });
  }));

  return router;
}
