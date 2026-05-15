export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type TimelineEventType =
  | 'incident_opened'
  | 'incident_acknowledged'
  | 'incident_resolved'
  | 'alert_sent'
  | 'note_added';

export interface Incident {
  id: string;
  monitorId: string;
  status: IncidentStatus;
  startedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  durationSeconds: number | null;
}

export interface IncidentTimelineEvent {
  id: string;
  incidentId: string;
  eventType: TimelineEventType;
  message: string;
  createdBy: string | null;
  createdAt: string;
}
