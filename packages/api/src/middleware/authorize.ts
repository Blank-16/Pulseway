import type { Response, NextFunction } from 'express';
import type { MemberRole } from '@pulseway/types';
import { getMemberRole } from '../services/MembershipCache.js';
import type { AuthenticatedRequest } from './authenticate.js';

const ROLE_HIERARCHY: Record<MemberRole, number> = { viewer: 0, admin: 1, owner: 2 };

export function authorize(minimumRole: MemberRole) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = req.params['workspaceId'] ?? (req.body as Record<string, string> | undefined)?.['workspaceId'];
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required' });
      return;
    }

    const wsIdStr = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;
    if (!wsIdStr) {
      res.status(400).json({ error: 'workspaceId is required' });
      return;
    }

    const role = await getMemberRole(req.user.id, wsIdStr);
    if (!role || ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minimumRole]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
