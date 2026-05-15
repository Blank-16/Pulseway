import type { MonitorStatus } from '@pulseway/types';

const STYLES: Record<MonitorStatus, string> = {
  up: 'bg-green-500/10 text-green-400 ring-green-500/20',
  down: 'bg-red-500/10 text-red-400 ring-red-500/20',
  degraded: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20',
};

const LABELS: Record<MonitorStatus, string> = {
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
};

interface Props {
  status: MonitorStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STYLES[status]} ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'up' ? 'bg-green-400' : status === 'down' ? 'bg-red-400 animate-pulse' : 'bg-yellow-400'}`}
      />
      {LABELS[status]}
    </span>
  );
}
