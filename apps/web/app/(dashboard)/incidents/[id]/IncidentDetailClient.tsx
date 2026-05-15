'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../../lib/api-client';
import { IncidentTimeline } from '../../../../components/incidents/IncidentTimeline';
import type { Incident, IncidentTimelineEvent } from '@pulseway/types';

interface IncidentFull extends Incident {
  timeline: IncidentTimelineEvent[];
}

interface Props {
  incidentId: string;
  workspaceId: string;
}

const STATUS_STYLES: Record<Incident['status'], string> = {
  open: 'text-red-400 bg-red-500/10 ring-red-500/20',
  acknowledged: 'text-yellow-400 bg-yellow-500/10 ring-yellow-500/20',
  resolved: 'text-green-400 bg-green-500/10 ring-green-500/20',
};

export function IncidentDetailClient({ incidentId, workspaceId }: Props) {
  const [incident, setIncident] = useState<IncidentFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: IncidentFull }>(
        `/incidents/${incidentId}/workspace/${workspaceId}`,
      );
      setIncident(res.data);
    } finally {
      setLoading(false);
    }
  }, [incidentId, workspaceId]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action: 'acknowledge' | 'resolve') {
    setSubmitting(true);
    try {
      await api.post(`/incidents/${incidentId}/workspace/${workspaceId}/${action}`);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/incidents/${incidentId}/workspace/${workspaceId}/notes`, { note });
      setNote('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !incident) {
    return <div className="h-96 animate-pulse rounded-xl bg-white/5" />;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Incident</h1>
          <p className="mt-1 font-mono text-sm text-gray-500">{incident.id}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset capitalize ${STATUS_STYLES[incident.status]}`}
        >
          {incident.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Started" value={new Date(incident.startedAt).toLocaleString()} />
        {incident.acknowledgedAt && (
          <Stat label="Acknowledged" value={new Date(incident.acknowledgedAt).toLocaleString()} />
        )}
        {incident.resolvedAt && (
          <Stat label="Resolved" value={new Date(incident.resolvedAt).toLocaleString()} />
        )}
        {incident.durationSeconds != null && (
          <Stat label="Duration" value={formatDuration(incident.durationSeconds)} />
        )}
      </div>

      {incident.status !== 'resolved' && (
        <div className="flex gap-3">
          {incident.status === 'open' && (
            <button
              onClick={() => handleAction('acknowledge')}
              disabled={submitting}
              className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400 transition hover:bg-yellow-500/20 disabled:opacity-50"
            >
              Acknowledge
            </button>
          )}
          <button
            onClick={() => handleAction('resolve')}
            disabled={submitting}
            className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 transition hover:bg-green-500/20 disabled:opacity-50"
          >
            Mark Resolved
          </button>
        </div>
      )}

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-6 text-sm font-semibold text-gray-200">Timeline</h2>
        <IncidentTimeline events={incident.timeline} />
      </section>

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-200">Add Note</h2>
        <form onSubmit={handleAddNote} className="flex gap-3">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Document what you investigated or found..."
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={submitting || !note.trim()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-200">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
