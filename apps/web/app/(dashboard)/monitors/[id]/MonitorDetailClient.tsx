'use client';

import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api-client';
import { ResponseTimeChart } from '../../../../components/charts/ResponseTimeChart';
import { StatusBadge } from '../../../../components/monitors/StatusBadge';
import type { Monitor, CheckResult, PercentileStats, MonitorStatus } from '@pulseway/types';

type RangeKey = '1h' | '24h' | '7d' | '30d';

interface MonitorDetail extends Monitor {
  latestState: { status: MonitorStatus; responseTimeMs: number; checkedAt: string } | null;
  uptime30d: number;
}

interface Props {
  monitorId: string;
  workspaceId: string;
}

export function MonitorDetailClient({ monitorId, workspaceId }: Props) {
  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [stats, setStats] = useState<PercentileStats[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [range, setRange] = useState<RangeKey>('24h');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [monitorRes, statsRes, checksRes] = await Promise.all([
          api.get<{ data: MonitorDetail }>(`/monitors/${monitorId}/workspace/${workspaceId}`),
          api.get<{ data: PercentileStats[] }>(`/monitors/${monitorId}/workspace/${workspaceId}/stats?range=${range}`),
          api.get<{ data: CheckResult[] }>(`/monitors/${monitorId}/workspace/${workspaceId}/checks?limit=50`),
        ]);
        setMonitor(monitorRes.data);
        setStats(statsRes.data);
        setChecks(checksRes.data);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorId, workspaceId]);

  // Reload only stats on range change
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    api.get<{ data: PercentileStats[] }>(`/monitors/${monitorId}/workspace/${workspaceId}/stats?range=${range}`)
      .then((r) => { if (!cancelled) setStats(r.data); })
      .catch(() => null)
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [range, monitorId, workspaceId]);

  if (loading || !monitor) {
    return <div className="h-96 animate-pulse rounded-xl bg-white/5" />;
  }

  const latestStatus = (monitor.latestState?.status ?? 'up') as MonitorStatus;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">{monitor.name}</h1>
          <p className="mt-1 text-sm text-gray-400">{monitor.url}</p>
        </div>
        <StatusBadge status={latestStatus} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Response time" value={monitor.latestState ? `${monitor.latestState.responseTimeMs}ms` : '—'} />
        <Stat label="Uptime (30d)" value={`${monitor.uptime30d.toFixed(2)}%`} />
        <Stat label="Interval" value={`${monitor.checkIntervalSeconds}s`} />
      </div>

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Response Time</h2>
          <RangeSelector value={range} onChange={setRange} />
        </div>
        <ResponseTimeChart data={stats} />
      </section>

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-200">Check History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Response</th>
                <th className="pb-3 pr-4 font-medium">HTTP</th>
                <th className="pb-3 pr-4 font-medium">Region</th>
                <th className="pb-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {checks.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums text-gray-300">{c.responseTimeMs}ms</td>
                  <td className="py-2.5 pr-4 tabular-nums text-gray-400">{c.statusCode ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-400">{c.region}</td>
                  <td className="py-2.5 text-gray-500">{new Date(c.checkedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-gray-100">{value}</p>
    </div>
  );
}

const RANGES: RangeKey[] = ['1h', '24h', '7d', '30d'];

function RangeSelector({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-white/5 p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            r === value ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
