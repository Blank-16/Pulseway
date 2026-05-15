import type { Metadata } from 'next';
import { TeamClient } from './TeamClient';

export const metadata: Metadata = { title: 'Team' };

async function getWorkspaceId(): Promise<string> {
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function TeamPage() {
  const workspaceId = await getWorkspaceId();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Team</h1>
        <p className="mt-1 text-sm text-gray-400">Manage members and alert channels</p>
      </div>
      <TeamClient workspaceId={workspaceId} />
    </div>
  );
}
