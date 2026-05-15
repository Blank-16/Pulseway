'use client';

import Link from 'next/link';
import { useIncidents } from '../../../hooks/useIncidents';
import type { Incident } from '@pulseway/types';

const STATUS_STYLES: Record<Incident['status'], string> = {
  open: 'text-red-400',
  acknowledged: 'text-yellow-400',
  resolved: 'text-green-400',
};

interface Props {
  workspaceId: string;
}

export function IncidentListClient({ workspaceId }: Props) {
  const { incidents, total, loading, error, page, setPage } = useIncidents(workspaceId, 20);
  const totalPages = Math.ceil(total / 20);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (incidents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
        <p className="text-gray-400">No incidents recorded. Your monitors are healthy.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-white/2">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Monitor</th>
              <th className="px-5 py-3 font-medium">Started</th>
              <th className="px-5 py-3 font-medium">Duration</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {incidents.map((incident) => (
              <tr key={incident.id} className="hover:bg-white/2">
                <td className="px-5 py-3.5">
                  <span className={`font-medium capitalize ${STATUS_STYLES[incident.status]}`}>
                    {incident.status}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-gray-400">
                  {incident.monitorId.slice(0, 8)}
                </td>
                <td className="px-5 py-3.5 text-gray-400">
                  {new Date(incident.startedAt).toLocaleString()}
                </td>
                <td className="px-5 py-3.5 tabular-nums text-gray-400">
                  {incident.durationSeconds != null
                    ? formatDuration(incident.durationSeconds)
                    : '—'}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Link
                    href={`/incidents/${incident.id}?workspaceId=${workspaceId}`}
                    className="text-xs text-brand-500 hover:text-brand-600"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{total} total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="rounded px-3 py-1 hover:bg-white/5 disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="px-2 py-1">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded px-3 py-1 hover:bg-white/5 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
