import { getPool } from '../client.js';
import type { Workspace, WorkspaceMember, MemberRole } from '@pulseway/types';

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_sub_id: string | null;
  created_at: Date;
}

interface MemberRow {
  user_id: string;
  workspace_id: string;
  role: string;
  joined_at: Date;
  user_email?: string;
  user_name?: string;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan as Workspace['plan'],
    stripeCustomerId: row.stripe_customer_id,
    stripeSubId: row.stripe_sub_id,
    createdAt: row.created_at.toISOString(),
  };
}

export class WorkspaceRepository {
  async insert(name: string, slug: string): Promise<Workspace> {
    const pool = getPool();
    const { rows } = await pool.query<WorkspaceRow>(
      `INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING *`,
      [name, slug],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toWorkspace(row);
  }

  async findById(id: string): Promise<Workspace | null> {
    const pool = getPool();
    const { rows } = await pool.query<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1', [id]);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const pool = getPool();
    const { rows } = await pool.query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async updateStripeIds(id: string, customerId: string, subId: string | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE workspaces SET stripe_customer_id = $1, stripe_sub_id = $2 WHERE id = $3',
      [customerId, subId, id],
    );
  }

  async updatePlan(id: string, plan: Workspace['plan']): Promise<void> {
    const pool = getPool();
    await pool.query('UPDATE workspaces SET plan = $1 WHERE id = $2', [plan, id]);
  }

  async addMember(userId: string, workspaceId: string, role: MemberRole): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO workspace_members (user_id, workspace_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = $3`,
      [userId, workspaceId, role],
    );
  }

  async findMember(userId: string, workspaceId: string): Promise<WorkspaceMember | null> {
    const pool = getPool();
    const { rows } = await pool.query<MemberRow>(
      'SELECT * FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId],
    );
    if (!rows[0]) return null;
    return {
      userId: rows[0].user_id,
      workspaceId: rows[0].workspace_id,
      role: rows[0].role as MemberRole,
      joinedAt: rows[0].joined_at.toISOString(),
    };
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const pool = getPool();
    const { rows } = await pool.query<MemberRow>(
      `SELECT wm.*, u.email AS user_email, u.name AS user_name
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.joined_at`,
      [workspaceId],
    );
    return rows.map((r) => {
      const member: WorkspaceMember = {
        userId: r.user_id,
        workspaceId: r.workspace_id,
        role: r.role as MemberRole,
        joinedAt: r.joined_at.toISOString(),
      };
      if (r.user_email) {
        member.user = { id: r.user_id, email: r.user_email, name: r.user_name ?? '' };
      }
      return member;
    });
  }

  async removeMember(userId: string, workspaceId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
  }

  async findUserWorkspaces(userId: string): Promise<Workspace[]> {
    const pool = getPool();
    const { rows } = await pool.query<WorkspaceRow>(
      `SELECT w.* FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1
       ORDER BY w.created_at`,
      [userId],
    );
    return rows.map(toWorkspace);
  }
}
