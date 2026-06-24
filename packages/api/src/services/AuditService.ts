import { getPool } from '@pulseway/db';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../middleware/authenticate.js';
import { logger } from '../logger.js';

export type AuditAction =
  | 'monitor.create' | 'monitor.update' | 'monitor.delete'
  | 'incident.acknowledge' | 'incident.resolve' | 'incident.note_added'
  | 'member.invite' | 'member.role_updated' | 'member.removed'
  | 'api_key.create' | 'api_key.revoke'
  | 'billing.checkout' | 'billing.portal'
  | 'channel.create' | 'channel.update' | 'channel.delete';

export interface AuditParams {
  workspaceId  : string;
  action       : AuditAction;
  resourceType : string;
  resourceId?  : string;
  diff?        : unknown;
  req          : Request;
}

export class AuditService {
  log(params: AuditParams): void {
    const authReq = params.req as AuthenticatedRequest;
    const pool    = getPool();
    const ip      = params.req.ip ?? null;
    const ua      = (params.req.headers['user-agent'] ?? null) as string | null;

    // Fire-and-forget — audit logging must never block the response
    pool.query(
      `INSERT INTO audit_events
         (workspace_id, actor_id, auth_method, action, resource_type, resource_id, diff, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)`,
      [
        params.workspaceId,
        authReq.user?.id ?? null,
        authReq.user?.authMethod ?? 'jwt',
        params.action,
        params.resourceType,
        params.resourceId ?? null,
        params.diff !== undefined ? JSON.stringify(params.diff) : null,
        ip,
        ua,
      ],
    ).catch((err: unknown) => {
      // Structured log — never throw; audit failure must not affect the API response
      logger.error(
        {
          err,
          action     : params.action,
          workspaceId: params.workspaceId,
          resourceId : params.resourceId,
        },
        'Audit log insert failed',
      );
    });
  }
}

export const auditService = new AuditService();
