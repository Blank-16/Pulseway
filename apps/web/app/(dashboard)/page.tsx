import type { Metadata } from 'next';
import { MonitorListClient } from './monitors/MonitorListClient';

export const metadata: Metadata = { title: 'Overview' };

// workspaceId comes from cookie/session in production;
// here we read it from a server-side helper (stub for now)
async function getWorkspaceId(): Promise<string> {
  // In production: decode JWT from httpOnly cookie server-side
  // For now, return a placeholder that gets replaced by session middleware
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function DashboardPage() {
  const workspaceId = await getWorkspaceId();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Overview</h1>
        <p className="mt-1 text-sm text-gray-400">Real-time status across all monitors</p>
      </div>
      <MonitorListClient workspaceId={workspaceId} />
    </div>
  );
}
