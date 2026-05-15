import type { Metadata } from 'next';
import { BillingClient } from './BillingClient';

export const metadata: Metadata = { title: 'Billing' };

async function getWorkspaceId(): Promise<string> {
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function BillingPage() {
  const workspaceId = await getWorkspaceId();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Billing</h1>
        <p className="mt-1 text-sm text-gray-400">Manage your subscription</p>
      </div>
      <BillingClient workspaceId={workspaceId} />
    </div>
  );
}
