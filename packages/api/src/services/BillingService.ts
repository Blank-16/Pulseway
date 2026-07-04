import Stripe from 'stripe';
import { WorkspaceRepository, getPool } from '@pulseway/db';
import { getConfig } from '@pulseway/config';
import { AppError, ErrorCode } from '../errors.js';
import type { WorkspacePlan } from '@pulseway/types';

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getConfig().STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });
  }
  return stripeClient;
}

function getPriceToPlan(): Record<string, WorkspacePlan> {
  const config = getConfig();
  return {
    [config.STRIPE_PRICE_PRO_MONTHLY] : 'pro',
    [config.STRIPE_PRICE_TEAM_MONTHLY]: 'team',
  };
}

function assertOwnOrigin(url: string): void {
  const config = getConfig();
  const allowed = new URL(config.APP_ORIGIN);
  const target  = new URL(url);
  if (target.origin !== allowed.origin) {
    throw AppError.badRequest(`Redirect URL must be on ${allowed.origin}`);
  }
}

export class BillingService {
  private readonly workspaceRepo = new WorkspaceRepository();

  async createCheckoutSession(
    workspaceId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    // Prevent open-redirect via Stripe — only allow URLs on our own origin
    assertOwnOrigin(successUrl);
    assertOwnOrigin(cancelUrl);

    const validPriceIds = Object.keys(getPriceToPlan());
    if (!validPriceIds.includes(priceId)) {
      throw AppError.badRequest('Invalid price ID');
    }

    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw AppError.notFound('Workspace not found');

    const params: Stripe.Checkout.SessionCreateParams = {
      mode       : 'subscription',
      line_items : [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url : cancelUrl,
      metadata   : { workspaceId },
    };
    if (workspace.stripeCustomerId) {
      params.customer = workspace.stripeCustomerId;
    }
    const session = await getStripe().checkout.sessions.create(params);

    if (!session.url) throw new AppError(500, ErrorCode.INTERNAL, 'Failed to create checkout session');
    return session.url;
  }

  async createPortalSession(workspaceId: string, returnUrl: string): Promise<string> {
    assertOwnOrigin(returnUrl);

    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace?.stripeCustomerId) throw AppError.badRequest('No billing account found');

    const session = await getStripe().billingPortal.sessions.create({
      customer  : workspace.stripeCustomerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, getConfig().STRIPE_WEBHOOK_SECRET);
    } catch {
      throw AppError.badRequest('Invalid webhook signature');
    }

    const pool = getPool();
    const { rowCount } = await pool.query(
      'INSERT INTO stripe_events (id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [event.id, event.type],
    );
    if (rowCount === 0) return;

    switch (event.type) {
      case 'checkout.session.completed': {
        const session     = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.['workspaceId'];
        if (!workspaceId || !session.customer || !session.subscription) break;
        await this.workspaceRepo.updateStripeIds(
          workspaceId,
          session.customer as string,
          session.subscription as string,
        );
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub     = event.data.object as Stripe.Subscription;
        const priceId = sub.items.data[0]?.price.id ?? '';
        const plan: WorkspacePlan = event.type === 'customer.subscription.deleted'
          ? 'free'
          : (getPriceToPlan()[priceId] ?? 'free');

        const { rows } = await pool.query<{ id: string }>(
          'SELECT id FROM workspaces WHERE stripe_sub_id = $1',
          [sub.id],
        );
        if (rows[0]) {
          await this.workspaceRepo.updatePlan(rows[0].id, plan);
        }
        break;
      }
    }
  }
}
