import type { Metadata } from 'next';
import { IncidentListClient } from './IncidentListClient';

export const metadata: Metadata = { title: 'Incidents' };

async function getWorkspaceId(): Promise<string> {
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function IncidentsPage() {
  const workspaceId = await getWorkspaceId();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Incidents</h1>
        <p className="mt-1 text-sm text-gray-400">All detected outages and their timeline</p>
      </div>
      <IncidentListClient workspaceId={workspaceId} />
    </div>
  );
}
