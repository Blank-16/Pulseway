import type { Metadata } from 'next';
import { MonitorListClient } from './MonitorListClient';

export const metadata: Metadata = { title: 'Monitors' };

async function getWorkspaceId(): Promise<string> {
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function MonitorsPage() {
  const workspaceId = await getWorkspaceId();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Monitors</h1>
          <p className="mt-1 text-sm text-gray-400">All registered HTTP endpoints</p>
        </div>
        <a
          href="/monitors/new"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          Add monitor
        </a>
      </div>
      <MonitorListClient workspaceId={workspaceId} />
    </div>
  );
}
