import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '@pulseway/config';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { BillingService } from '../services/BillingService.js';
import { AppError } from '../errors.js';

const CheckoutSchema = z.object({
  priceId   : z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl : z.string().url(),
});

const PortalSchema = z.object({ returnUrl: z.string().url().optional() });

export function billingRoutes(): Router {
  const router         = Router();
  const billingService = new BillingService();

  // Raw body applied in app.ts before json() — do NOT add express.json() here
  router.post('/webhook', handler(async (req, res) => {
    const sig = req.headers['stripe-signature'] as string | undefined;
    if (!sig) throw AppError.badRequest('Missing stripe-signature header');
    await billingService.handleWebhook(req.body as Buffer, sig);
    res.json({ received: true });
  }));

  router.use(handler(authenticate));

  router.post('/workspace/:workspaceId/checkout',
    authHandler(authorize('owner')),
    handler(validateBody(CheckoutSchema)),
    authHandler(async (req, res) => {
      const url = await billingService.createCheckoutSession(
        req.params['workspaceId']!,
        req.body.priceId,
        req.body.successUrl,
        req.body.cancelUrl,
      );
      res.json({ data: { url } });
    }),
  );

  router.post('/workspace/:workspaceId/portal',
    authHandler(authorize('owner')),
    handler(validateBody(PortalSchema)),
    authHandler(async (req, res) => {
      const config    = getConfig();
      const returnUrl = req.body.returnUrl ?? `${config.APP_ORIGIN}/billing`;
      const url       = await billingService.createPortalSession(req.params['workspaceId']!, returnUrl);
      res.json({ data: { url } });
    }),
  );

  return router;
}
