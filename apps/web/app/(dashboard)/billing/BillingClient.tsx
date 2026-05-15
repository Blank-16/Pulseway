'use client';

import { useState } from 'react';
import { api } from '../../../lib/api-client';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    monitors: 3,
    interval: '60s',
    priceId: null,
  },
  {
    name: 'Pro',
    price: '$29/mo',
    monitors: 50,
    interval: '30s',
    priceId: 'price_pro_monthly',
  },
  {
    name: 'Team',
    price: '$99/mo',
    monitors: 200,
    interval: '30s',
    priceId: 'price_team_monthly',
  },
] as const;

interface Props {
  workspaceId: string;
}

export function BillingClient({ workspaceId }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleUpgrade(priceId: string) {
    setLoading(true);
    try {
      const origin = window.location.origin;
      const res = await api.post<{ data: { url: string } }>(
        `/billing/workspace/${workspaceId}/checkout`,
        {
          priceId,
          successUrl: `${origin}/billing?success=1`,
          cancelUrl: `${origin}/billing`,
        },
      );
      window.location.href = res.data.url;
    } finally {
      setLoading(false);
    }
  }

  async function handlePortal() {
    setLoading(true);
    try {
      const res = await api.post<{ data: { url: string } }>(
        `/billing/workspace/${workspaceId}/portal`,
        { returnUrl: window.location.href },
      );
      window.location.href = res.data.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className="rounded-xl border border-white/5 bg-white/2 p-6"
          >
            <h3 className="text-base font-semibold text-gray-100">{plan.name}</h3>
            <p className="mt-1 text-2xl font-bold text-gray-100">{plan.price}</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-400">
              <li>Up to {plan.monitors} monitors</li>
              <li>Checks every {plan.interval}</li>
            </ul>
            {plan.priceId && (
              <button
                onClick={() => handleUpgrade(plan.priceId!)}
                disabled={loading}
                className="mt-6 w-full rounded-lg bg-brand-500 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                Upgrade to {plan.name}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Manage Subscription</h3>
        <p className="mb-4 text-sm text-gray-400">
          Update payment method, view invoices, or cancel via the Stripe portal.
        </p>
        <button
          onClick={handlePortal}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Open Billing Portal
        </button>
      </div>
    </div>
  );
}
