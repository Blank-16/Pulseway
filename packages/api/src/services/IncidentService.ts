import { IncidentRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import type { Incident, IncidentTimelineEvent } from '@pulseway/types';

export class IncidentService {
  private readonly incidentRepo = new IncidentRepository();

  async list(
    workspaceId: string,
    pageSize: number,
    cursor?: string,
  ): Promise<{ incidents: Incident[]; nextCursor: string | null; total: number }> {
    return this.incidentRepo.findByWorkspace(workspaceId, pageSize, cursor);
  }

  async get(id: string, workspaceId: string): Promise<Incident> {
    // Single query with workspace join — prevents IDOR and avoids extra round-trip
    const incident = await this.incidentRepo.findByIdAndWorkspace(id, workspaceId);
    if (!incident) throw AppError.notFound('Incident not found');
    return incident;
  }

  async getTimeline(id: string, workspaceId: string): Promise<IncidentTimelineEvent[]> {
    await this.get(id, workspaceId);
    return this.incidentRepo.getTimeline(id);
  }

  async acknowledge(id: string, workspaceId: string, userId: string): Promise<Incident> {
    const incident = await this.get(id, workspaceId);
    if (incident.status !== 'open') {
      throw AppError.conflict('Incident is not in open state');
    }

    const updated = await this.incidentRepo.acknowledge(id, userId);
    if (!updated) throw AppError.notFound('Incident not found');

    await this.incidentRepo.appendTimeline(id, 'incident_acknowledged', 'Incident acknowledged', userId);
    return updated;
  }

  async resolve(id: string, workspaceId: string, userId: string): Promise<Incident> {
    const incident = await this.get(id, workspaceId);
    if (incident.status === 'resolved') {
      throw AppError.conflict('Incident is already resolved');
    }

    const updated = await this.incidentRepo.resolve(id);
    if (!updated) throw AppError.notFound('Incident not found');

    await this.incidentRepo.appendTimeline(id, 'incident_resolved', 'Incident manually resolved', userId);
    return updated;
  }

  async addNote(id: string, workspaceId: string, userId: string, note: string): Promise<IncidentTimelineEvent> {
    await this.get(id, workspaceId);
    return this.incidentRepo.appendTimeline(id, 'note_added', note, userId);
  }
}
