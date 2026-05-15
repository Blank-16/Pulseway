import { getPool } from '../client.js';
import type { NotificationChannelType } from '@pulseway/types';

interface AlertLogRow {
  id: string;
  incident_id: string;
  channel_type: string;
  status: string;
  error: string | null;
  sent_at: Date;
}

export interface AlertLogEntry {
  id: string;
  incidentId: string;
  channelType: NotificationChannelType;
  status: 'sent' | 'failed';
  error: string | null;
  sentAt: string;
}

export class AlertLogRepository {
  async insert(params: {
    incidentId: string;
    channelType: NotificationChannelType;
    status: 'sent' | 'failed';
    error?: string;
  }): Promise<AlertLogEntry> {
    const pool = getPool();
    const { rows } = await pool.query<AlertLogRow>(
      `INSERT INTO alert_log (incident_id, channel_type, status, error)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [params.incidentId, params.channelType, params.status, params.error ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return {
      id: row.id,
      incidentId: row.incident_id,
      channelType: row.channel_type as NotificationChannelType,
      status: row.status as 'sent' | 'failed',
      error: row.error,
      sentAt: row.sent_at.toISOString(),
    };
  }

  async findByIncident(incidentId: string): Promise<AlertLogEntry[]> {
    const pool = getPool();
    const { rows } = await pool.query<AlertLogRow>(
      'SELECT * FROM alert_log WHERE incident_id = $1 ORDER BY sent_at',
      [incidentId],
    );
    return rows.map((r) => ({
      id: r.id,
      incidentId: r.incident_id,
      channelType: r.channel_type as NotificationChannelType,
      status: r.status as 'sent' | 'failed',
      error: r.error,
      sentAt: r.sent_at.toISOString(),
    }));
  }
}
