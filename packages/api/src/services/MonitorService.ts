import { MonitorRepository, WorkspaceRepository, IncidentRepository, getPool } from '@pulseway/db';
import { featureFlags } from './FeatureFlagService.js';
import { StatsRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import { getPublishClient, getCacheClient } from '../redis.js';
import type { Monitor, CreateMonitorDTO, UpdateMonitorDTO, PercentileStats } from '@pulseway/types';

const PLAN_MONITOR_LIMITS: Record<string, number> = { free: 3, pro: 50, team: 200 };

export class MonitorService {
  private readonly monitorRepo   = new MonitorRepository();
  private readonly statsRepo     = new StatsRepository();
  private readonly workspaceRepo = new WorkspaceRepository();

  async create(workspaceId: string, dto: CreateMonitorDTO): Promise<Monitor> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw AppError.notFound('Workspace not found');

    const count = await this.monitorRepo.countByWorkspace(workspaceId);
    const limit = PLAN_MONITOR_LIMITS[workspace.plan] ?? 3;
    if (count >= limit) {
      throw AppError.planLimitExceeded(`Monitor limit (${limit}) reached for ${workspace.plan} plan`);
    }

    // Strip body assertions if feature flag is disabled for this workspace
    const bodyAssertionsEnabled = await featureFlags.isEnabled('body_assertions', workspaceId);
    const sanitizedDto = bodyAssertionsEnabled
      ? dto
      : { ...dto, bodyContains: undefined, bodyJsonPath: undefined, bodyJsonValue: undefined };

    const monitor = await this.monitorRepo.insert(workspaceId, sanitizedDto);
    await getPublishClient().publish(
      'config-change',
      JSON.stringify({ action: 'created', monitorId: monitor.id }),
    );
    return monitor;
  }

  async list(
    workspaceId: string,
    pageSize = 200,
    cursor?: string,
  ): Promise<{ monitors: Monitor[]; nextCursor: string | null }> {
    return this.monitorRepo.findByWorkspace(workspaceId, pageSize, cursor);
  }

  // Single DB query — workspace ownership enforced in the JOIN
  async get(id: string, workspaceId: string): Promise<Monitor> {
    const monitor = await this.monitorRepo.findByIdAndWorkspace(id, workspaceId);
    if (!monitor) throw AppError.notFound('Monitor not found');
    return monitor;
  }

  async update(id: string, workspaceId: string, dto: UpdateMonitorDTO, expectedUpdatedAt?: string): Promise<Monitor> {
    await this.get(id, workspaceId);
    const updated = await this.monitorRepo.update(id, dto, expectedUpdatedAt);
    if (!updated) throw AppError.notFound('Monitor not found');
    await getPublishClient().publish('config-change', JSON.stringify({ action: 'updated', monitorId: id }));
    return updated;
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    await this.get(id, workspaceId);

    // Resolve all open incidents before deleting — prevents orphaned open incidents
    const incidentRepo = new IncidentRepository();
    const pool         = getPool();
    const client       = await pool.connect();
    try {
      await client.query('BEGIN');
      // Soft-delete the monitor
      await client.query(`UPDATE monitors SET deleted_at = NOW() WHERE id = $1`, [id]);
      // Resolve any open incidents
      const { rows: openIncidents } = await client.query<{ id: string }>(
        `SELECT id FROM incidents WHERE monitor_id = $1 AND status != 'resolved'`,
        [id],
      );
      for (const { id: incidentId } of openIncidents) {
        await client.query(
          `UPDATE incidents SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
          [incidentId],
        );
        await client.query(
          `INSERT INTO incident_timeline (incident_id, event_type, message, created_by)
           VALUES ($1, 'incident_resolved', 'Resolved automatically: monitor deleted', NULL)`,
          [incidentId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await getPublishClient().publish('config-change', JSON.stringify({ action: 'deleted', monitorId: id }));
  }

  async getStats(id: string, workspaceId: string, rangeHours: number): Promise<PercentileStats[]> {
    await this.get(id, workspaceId);
    return this.statsRepo.getPercentileStats(id, rangeHours);
  }

  // Workspace ownership validated before calling — monitorId confirmed to belong to workspaceId
  async getUptimePercent(id: string, workspaceId: string, days: number): Promise<number> {
    await this.get(id, workspaceId);
    return this.statsRepo.getUptimePercent(id, days);
  }

  // Workspace ownership validated before calling
  async getLatestState(id: string, workspaceId: string): Promise<Record<string, unknown> | null> {
    await this.get(id, workspaceId);
    const raw = await getCacheClient().get(`monitor:${id}:latest`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }
}
