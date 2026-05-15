'use client';

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PercentileStats } from '@pulseway/types';

interface Props {
  data: PercentileStats[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ResponseTimeChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        No data available for this time range
      </div>
    );
  }

  const chartData = data.map((d) => ({
    time: formatTime(d.bucketStart),
    p50: Math.round(d.p50),
    p95: Math.round(d.p95),
    p99: Math.round(d.p99),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="time"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          unit="ms"
          width={52}
        />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#d1d5db' }}
          itemStyle={{ color: '#d1d5db' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
        <Line type="monotone" dataKey="p50" name="P50" stroke="#4ade80" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="p95" name="P95" stroke="#fb923c" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="p99" name="P99" stroke="#f87171" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
