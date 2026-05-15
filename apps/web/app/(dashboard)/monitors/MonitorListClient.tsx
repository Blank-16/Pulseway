'use client';

import { useMonitors } from '../../../hooks/useMonitors';
import { MonitorCard } from '../../../components/monitors/MonitorCard';

interface Props {
  workspaceId: string;
}

export function MonitorListClient({ workspaceId }: Props) {
  const { monitors, loading, error } = useMonitors(workspaceId);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (monitors.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
        <p className="text-gray-400">No monitors yet. Create your first monitor to get started.</p>
      </div>
    );
  }

  // Failing monitors bubble to top
  const sorted = [...monitors].sort((a, b) => {
    const order = { down: 0, degraded: 1, up: 2 };
    const aStatus = (a.latestStatus ?? 'up') as keyof typeof order;
    const bStatus = (b.latestStatus ?? 'up') as keyof typeof order;
    return (order[aStatus] ?? 2) - (order[bStatus] ?? 2);
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((monitor) => (
        <MonitorCard key={monitor.id} monitor={monitor} workspaceId={workspaceId} />
      ))}
    </div>
  );
}
