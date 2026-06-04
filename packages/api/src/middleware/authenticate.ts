import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../jwt.js';
import { getConfig } from '@pulseway/config';
import { ApiKeyRepository } from '@pulseway/db';
import { ErrorCode } from '../errors.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; workspaceId?: string; role?: string; authMethod: 'jwt' | 'api_key' };
}

const apiKeyRepo = new ApiKeyRepository();

const API_KEY_PREFIX = 'pw_';

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;

  if (!header) {
    res.status(401).json({ error: { code: ErrorCode.UNAUTHORIZED, message: 'Missing authorization header' } });
    return;
  }

  // API key path
  if (header.startsWith('Bearer pw_') || header.startsWith('ApiKey ')) {
    const raw = header.startsWith('ApiKey ')
      ? header.slice(7).trim()
      : header.slice(7).trim();

    const apiKey = await apiKeyRepo.findByHash(raw);
    if (!apiKey) {
      res.status(401).json({ error: { code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired API key' } });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id         : apiKey.createdBy,
      email      : '',
      workspaceId: apiKey.workspaceId,
      role       : apiKey.role,
      authMethod : 'api_key',
    };
    next();
    return;
  }

  // JWT path
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: ErrorCode.UNAUTHORIZED, message: 'Missing authorization header' } });
    return;
  }

  try {
    const token   = header.slice(7);
    const payload = await verifyToken(token);
    (req as AuthenticatedRequest).user = {
      id         : payload.sub,
      email      : payload.email,
      workspaceId: payload.workspaceId,
      role       : payload.role,
      authMethod : 'jwt',
    };
    next();
  } catch {
    res.status(401).json({ error: { code: ErrorCode.TOKEN_EXPIRED, message: 'Invalid or expired token' } });
  }
}
