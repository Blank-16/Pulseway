import Link from 'next/link';
import type { Monitor } from '@pulseway/types';
import { StatusBadge } from './StatusBadge';
import type { MonitorStatus } from '@pulseway/types';

interface Props {
  monitor: Monitor & {
    uptime30d?: number;
    latestStatus?: string;
    latestResponseTimeMs?: number;
  };
  workspaceId: string;
}

export function MonitorCard({ monitor, workspaceId }: Props) {
  const status = (monitor.latestStatus ?? 'up') as MonitorStatus;
  const responseTime = monitor.latestResponseTimeMs;

  return (
    <Link
      href={`/monitors/${monitor.id}?workspaceId=${workspaceId}`}
      className="block rounded-xl border border-white/5 bg-white/2 p-5 transition hover:bg-white/5 hover:border-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-100">{monitor.name}</p>
          <p className="mt-0.5 truncate text-sm text-gray-400">{monitor.url}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4 flex items-center gap-6 text-sm text-gray-400">
        {monitor.uptime30d !== undefined && (
          <span>
            <span className="font-medium text-gray-200">{monitor.uptime30d.toFixed(2)}%</span> uptime
          </span>
        )}
        {responseTime !== undefined && (
          <span>
            <span className="font-medium text-gray-200">{responseTime}ms</span>
          </span>
        )}
        <span className="ml-auto">Every {monitor.checkIntervalSeconds}s</span>
      </div>
    </Link>
  );
}
