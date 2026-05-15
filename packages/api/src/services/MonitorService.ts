import { MonitorRepository, CheckResultRepository, WorkspaceRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import { getPublishClient, getCacheClient } from '../redis.js';
import type { Monitor, CreateMonitorDTO, UpdateMonitorDTO, PercentileStats } from '@pulseway/types';

const PLAN_MONITOR_LIMITS: Record<string, number> = { free: 3, pro: 50, team: 200 };

export class MonitorService {
  private readonly monitorRepo   = new MonitorRepository();
  private readonly checkRepo     = new CheckResultRepository();
  private readonly workspaceRepo = new WorkspaceRepository();

  async create(workspaceId: string, dto: CreateMonitorDTO): Promise<Monitor> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw AppError.notFound('Workspace not found');

    const count = await this.monitorRepo.countByWorkspace(workspaceId);
    const limit = PLAN_MONITOR_LIMITS[workspace.plan] ?? 3;
    if (count >= limit) {
      throw AppError.planLimitExceeded(`Monitor limit (${limit}) reached for ${workspace.plan} plan`);
    }

    const monitor = await this.monitorRepo.insert(workspaceId, dto);
    await getPublishClient().publish(
      'config-change',
      JSON.stringify({ action: 'created', monitorId: monitor.id }),
    );
    return monitor;
  }

  async list(workspaceId: string): Promise<Monitor[]> {
    return this.monitorRepo.findByWorkspace(workspaceId);
  }

  // Single DB query — workspace ownership enforced in the JOIN
  async get(id: string, workspaceId: string): Promise<Monitor> {
    const monitor = await this.monitorRepo.findByIdAndWorkspace(id, workspaceId);
    if (!monitor) throw AppError.notFound('Monitor not found');
    return monitor;
  }

  async update(id: string, workspaceId: string, dto: UpdateMonitorDTO): Promise<Monitor> {
    await this.get(id, workspaceId);
    const updated = await this.monitorRepo.update(id, dto);
    if (!updated) throw AppError.notFound('Monitor not found');
    await getPublishClient().publish('config-change', JSON.stringify({ action: 'updated', monitorId: id }));
    return updated;
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    await this.get(id, workspaceId);
    await this.monitorRepo.delete(id);
    await getPublishClient().publish('config-change', JSON.stringify({ action: 'deleted', monitorId: id }));
  }

  async getStats(id: string, workspaceId: string, rangeHours: number): Promise<PercentileStats[]> {
    await this.get(id, workspaceId);
    return this.checkRepo.getPercentileStats(id, rangeHours);
  }

  // Workspace ownership validated before calling — monitorId confirmed to belong to workspaceId
  async getUptimePercent(id: string, workspaceId: string, days: number): Promise<number> {
    await this.get(id, workspaceId);
    return this.checkRepo.getUptimePercent(id, days);
  }

  // Workspace ownership validated before calling
  async getLatestState(id: string, workspaceId: string): Promise<Record<string, unknown> | null> {
    await this.get(id, workspaceId);
    const raw = await getCacheClient().get(`monitor:${id}:latest`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }
}
