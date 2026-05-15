'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api-client';
import { useSSE } from './useSSE';
import type { Incident, SSEEvent } from '@pulseway/types';

interface UseIncidentsReturn {
  incidents: Incident[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  setPage: (p: number) => void;
  refetch: () => Promise<void>;
}

export function useIncidents(workspaceId: string, pageSize = 20): UseIncidentsReturn {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchIncidents = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get<{ data: Incident[]; total: number }>(
        `/incidents/workspace/${workspaceId}?page=${page}&pageSize=${pageSize}`,
      );
      setIncidents(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, page, pageSize]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  useSSE(workspaceId, (event: SSEEvent) => {
    if (event.type === 'incident:opened' || event.type === 'incident:resolved') {
      fetchIncidents();
    }
  });

  return { incidents, total, loading, error, page, setPage, refetch: fetchIncidents };
}
