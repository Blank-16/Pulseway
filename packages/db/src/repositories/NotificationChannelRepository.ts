import { getPool } from '../client.js';
import type { NotificationChannel, NotificationChannelType } from '@pulseway/types';

interface ChannelRow {
  id: string;
  workspace_id: string;
  channel_type: string;
  config: Record<string, string>;
  is_active: boolean;
  created_at: Date;
}

function toChannel(row: ChannelRow): NotificationChannel {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channelType: row.channel_type as NotificationChannelType,
    config: row.config,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

export class NotificationChannelRepository {
  async insert(workspaceId: string, channelType: NotificationChannelType, config: Record<string, string>): Promise<NotificationChannel> {
    const pool = getPool();
    const { rows } = await pool.query<ChannelRow>(
      `INSERT INTO notification_channels (workspace_id, channel_type, config)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [workspaceId, channelType, JSON.stringify(config)],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toChannel(row);
  }

  async findByWorkspace(workspaceId: string): Promise<NotificationChannel[]> {
    const pool = getPool();
    const { rows } = await pool.query<ChannelRow>(
      'SELECT * FROM notification_channels WHERE workspace_id = $1 ORDER BY created_at',
      [workspaceId],
    );
    return rows.map(toChannel);
  }

  async findActiveByWorkspace(workspaceId: string): Promise<NotificationChannel[]> {
    const pool = getPool();
    const { rows } = await pool.query<ChannelRow>(
      'SELECT * FROM notification_channels WHERE workspace_id = $1 AND is_active = true',
      [workspaceId],
    );
    return rows.map(toChannel);
  }

  async update(id: string, config: Record<string, string>, isActive: boolean): Promise<NotificationChannel | null> {
    const pool = getPool();
    const { rows } = await pool.query<ChannelRow>(
      `UPDATE notification_channels SET config = $1, is_active = $2 WHERE id = $3 RETURNING *`,
      [JSON.stringify(config), isActive, id],
    );
    return rows[0] ? toChannel(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM notification_channels WHERE id = $1', [id]);
  }
}
