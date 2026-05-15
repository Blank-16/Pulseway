import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Settings' };

async function getWorkspaceId(): Promise<string> {
  return process.env['DEFAULT_WORKSPACE_ID'] ?? '';
}

export default async function SettingsPage() {
  const workspaceId = await getWorkspaceId();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Workspace configuration</p>
      </div>

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-200">Status Page</h2>
        <p className="text-sm text-gray-400">
          Your public status page is available at:
        </p>
        <code className="mt-2 block rounded-lg bg-black/30 px-4 py-3 text-sm text-brand-500">
          https://app.pulseway.dev/status/{workspaceId}
        </code>
      </section>

      <section className="rounded-xl border border-red-500/10 bg-red-500/5 p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-400">Danger Zone</h2>
        <p className="text-sm text-gray-400">
          Deleting a workspace is permanent and cannot be undone.
        </p>
        <button
          className="mt-4 rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
          disabled
        >
          Delete Workspace
        </button>
      </section>
    </div>
  );
}
