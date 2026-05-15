'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api-client';
import { useSSE } from './useSSE';
import type { Monitor, SSEEvent } from '@pulseway/types';

interface MonitorWithUptime extends Monitor {
  uptime30d?: number;
  latestStatus?: string;
  latestResponseTimeMs?: number;
}

interface UseMonitorsReturn {
  monitors: MonitorWithUptime[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMonitors(workspaceId: string): UseMonitorsReturn {
  const [monitors, setMonitors] = useState<MonitorWithUptime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMonitors = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get<{ data: MonitorWithUptime[] }>(
        `/monitors/workspace/${workspaceId}`,
      );
      setMonitors(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitors');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  useSSE(workspaceId, (event: SSEEvent) => {
    if (event.type === 'check:completed') {
      setMonitors((prev) =>
        prev.map((m) =>
          m.id === event.data.monitorId
            ? {
                ...m,
                latestStatus: event.data.status,
                latestResponseTimeMs: event.data.responseTimeMs,
              }
            : m,
        ),
      );
    }
  });

  return { monitors, loading, error, refetch: fetchMonitors };
}
