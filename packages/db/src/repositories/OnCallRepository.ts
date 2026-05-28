import { getPool } from '../client.js';

export interface OnCallSchedule {
  id          : string;
  workspaceId : string;
  name        : string;
  timezone    : string;
  createdAt   : string;
}

export interface OnCallLayer {
  id         : string;
  scheduleId : string;
  userId     : string;
  weekdays   : number;
  startHour  : number;
  endHour    : number;
  priority   : number;
}

export interface EscalationPolicy {
  id          : string;
  workspaceId : string;
  name        : string;
  createdAt   : string;
}

export interface EscalationStep {
  id         : string;
  policyId   : string;
  stepOrder  : number;
  userId     : string | null;
  scheduleId : string | null;
  channel    : string;
  delayMins  : number;
}

export interface MaintenanceWindow {
  id          : string;
  workspaceId : string;
  name        : string;
  startsAt    : string;
  endsAt      : string;
  monitorIds  : string[];
  createdBy   : string | null;
  createdAt   : string;
}

export class OnCallRepository {
  async createSchedule(workspaceId: string, name: string, timezone: string): Promise<OnCallSchedule> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; timezone: string; created_at: Date;
    }>(
      `INSERT INTO oncall_schedules (workspace_id, name, timezone) VALUES ($1, $2, $3) RETURNING *`,
      [workspaceId, name, timezone],
    );
    const r = rows[0]!;
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, timezone: r.timezone, createdAt: r.created_at.toISOString() };
  }

  async findSchedulesByWorkspace(workspaceId: string): Promise<OnCallSchedule[]> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; timezone: string; created_at: Date;
    }>('SELECT * FROM oncall_schedules WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);
    return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, timezone: r.timezone, createdAt: r.created_at.toISOString() }));
  }

  async addLayer(
    scheduleId: string, userId: string, weekdays: number,
    startHour: number, endHour: number, priority: number,
  ): Promise<OnCallLayer> {
    const { rows } = await getPool().query<{
      id: string; schedule_id: string; user_id: string; weekdays: number;
      start_hour: number; end_hour: number; priority: number;
    }>(
      `INSERT INTO oncall_layers (schedule_id, user_id, weekdays, start_hour, end_hour, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [scheduleId, userId, weekdays, startHour, endHour, priority],
    );
    const r = rows[0]!;
    return { id: r.id, scheduleId: r.schedule_id, userId: r.user_id, weekdays: r.weekdays, startHour: r.start_hour, endHour: r.end_hour, priority: r.priority };
  }

  /**
   * Returns the user on-call right now for a given schedule.
   * Weekday bitmask: bit 0 = Monday (JS getDay() maps Sun=0 so we shift).
   */
  async findCurrentOnCall(scheduleId: string): Promise<string | null> {
    const now = new Date();
    const jsDay = now.getDay(); // 0=Sun, 1=Mon…6=Sat
    const bitDay = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon…6=Sun
    const hour = now.getHours();

    const { rows } = await getPool().query<{ user_id: string }>(
      `SELECT user_id FROM oncall_layers
       WHERE schedule_id = $1
         AND (weekdays >> $2) & 1 = 1
         AND start_hour <= $3 AND end_hour >= $3
       ORDER BY priority ASC
       LIMIT 1`,
      [scheduleId, bitDay, hour],
    );
    return rows[0]?.user_id ?? null;
  }

  async createPolicy(workspaceId: string, name: string): Promise<EscalationPolicy> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; created_at: Date;
    }>(
      `INSERT INTO escalation_policies (workspace_id, name) VALUES ($1, $2) RETURNING *`,
      [workspaceId, name],
    );
    const r = rows[0]!;
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, createdAt: r.created_at.toISOString() };
  }

  async findPoliciesByWorkspace(workspaceId: string): Promise<EscalationPolicy[]> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; created_at: Date;
    }>('SELECT * FROM escalation_policies WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);
    return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, createdAt: r.created_at.toISOString() }));
  }

  async addStep(
    policyId: string, stepOrder: number,
    target: { userId?: string; scheduleId?: string },
    channel: string, delayMins: number,
  ): Promise<EscalationStep> {
    const { rows } = await getPool().query<{
      id: string; policy_id: string; step_order: number;
      user_id: string | null; schedule_id: string | null; channel: string; delay_mins: number;
    }>(
      `INSERT INTO escalation_steps (policy_id, step_order, user_id, schedule_id, channel, delay_mins)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [policyId, stepOrder, target.userId ?? null, target.scheduleId ?? null, channel, delayMins],
    );
    const r = rows[0]!;
    return { id: r.id, policyId: r.policy_id, stepOrder: r.step_order, userId: r.user_id, scheduleId: r.schedule_id, channel: r.channel, delayMins: r.delay_mins };
  }

  async findStepsByPolicy(policyId: string): Promise<EscalationStep[]> {
    const { rows } = await getPool().query<{
      id: string; policy_id: string; step_order: number;
      user_id: string | null; schedule_id: string | null; channel: string; delay_mins: number;
    }>(
      'SELECT * FROM escalation_steps WHERE policy_id = $1 ORDER BY step_order',
      [policyId],
    );
    return rows.map((r) => ({
      id: r.id, policyId: r.policy_id, stepOrder: r.step_order,
      userId: r.user_id, scheduleId: r.schedule_id, channel: r.channel, delayMins: r.delay_mins,
    }));
  }

  async createMaintenanceWindow(
    workspaceId: string, name: string, startsAt: Date, endsAt: Date,
    monitorIds: string[], createdBy: string,
  ): Promise<MaintenanceWindow> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; starts_at: Date;
      ends_at: Date; monitor_ids: string[]; created_by: string | null; created_at: Date;
    }>(
      `INSERT INTO maintenance_windows (workspace_id, name, starts_at, ends_at, monitor_ids, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [workspaceId, name, startsAt, endsAt, monitorIds, createdBy],
    );
    const r = rows[0]!;
    return {
      id: r.id, workspaceId: r.workspace_id, name: r.name,
      startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(),
      monitorIds: r.monitor_ids, createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    };
  }

  async findActiveMaintenanceWindows(workspaceId: string, monitorId?: string): Promise<MaintenanceWindow[]> {
    const { rows } = await getPool().query<{
      id: string; workspace_id: string; name: string; starts_at: Date;
      ends_at: Date; monitor_ids: string[]; created_by: string | null; created_at: Date;
    }>(
      `SELECT * FROM maintenance_windows
       WHERE workspace_id = $1
         AND starts_at <= NOW() AND ends_at > NOW()
         AND ($2::uuid IS NULL OR $2::uuid = ANY(monitor_ids) OR cardinality(monitor_ids) = 0)`,
      [workspaceId, monitorId ?? null],
    );
    return rows.map((r) => ({
      id: r.id, workspaceId: r.workspace_id, name: r.name,
      startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(),
      monitorIds: r.monitor_ids, createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    }));
  }

  async isInMaintenance(workspaceId: string, monitorId: string): Promise<boolean> {
    const windows = await this.findActiveMaintenanceWindows(workspaceId, monitorId);
    return windows.length > 0;
  }
}
