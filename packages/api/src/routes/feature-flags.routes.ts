import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { featureFlags } from '../services/FeatureFlagService.js';

const SetFlagSchema = z.object({
  enabled   : z.boolean(),
  rolloutPct: z.number().int().min(0).max(100).default(100),
});

export function featureFlagRoutes(): Router {
  const router = Router();
  router.use(handler(authenticate));

  router.get('/workspace/:workspaceId',
    authHandler(authorize('viewer')),
    authHandler(async (req: any, res) => {
      const flags = await featureFlags.listFlags(req.params['workspaceId']!);
      res.json({ data: flags });
    }),
  );

  // Admin-only: override a flag for a specific workspace
  router.put('/workspace/:workspaceId/:flagName',
    authHandler(authorize('admin')),
    handler(validateBody(SetFlagSchema)),
    authHandler(async (req: any, res) => {
      await featureFlags.setFlag(
        req.params['flagName']!,
        req.body.enabled,
        req.params['workspaceId']!,
        req.body.rolloutPct,
      );
      res.json({ data: { ok: true } });
    }),
  );

  return router;
}
