import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { ApiKeyRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import type { MemberRole } from '@pulseway/types';

const CreateApiKeySchema = z.object({
  name     : z.string().min(1).max(100).trim(),
  role     : z.enum(['admin', 'viewer']).default('viewer'),
  expiresAt: z.string().datetime().optional(),
});

export function apiKeyRoutes(): Router {
  const router = Router();
  const repo   = new ApiKeyRepository();
  router.use(handler(authenticate));

  router.get('/workspace/:workspaceId',
    authHandler(authorize('admin')),
    authHandler(async (req: any, res) => {
      const keys = await repo.listByWorkspace(req.params['workspaceId']!);
      // Never expose key_hash — only prefix + metadata
      res.json({ data: keys });
    }),
  );

  router.post('/workspace/:workspaceId',
    authHandler(authorize('admin')),
    handler(validateBody(CreateApiKeySchema)),
    authHandler(async (req: any, res) => {
      const { apiKey, rawKey } = await repo.create(
        req.params['workspaceId']!,
        req.body.name,
        req.body.role as MemberRole,
        req.user.id,
        req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      );
      // rawKey is returned exactly once — not stored, not retrievable
      res.status(201).json({ data: { ...apiKey, key: rawKey } });
    }),
  );

  router.delete('/workspace/:workspaceId/:keyId',
    authHandler(authorize('admin')),
    authHandler(async (req: any, res) => {
      const revoked = await repo.revoke(req.params['keyId']!, req.params['workspaceId']!);
      if (!revoked) throw AppError.notFound('API key not found');
      res.status(204).end();
    }),
  );

  return router;
}
