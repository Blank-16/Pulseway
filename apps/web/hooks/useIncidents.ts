'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api-client';
import { useSSE } from './useSSE';
import type { Incident, SSEEvent } from '@pulseway/types';

interface UseIncidentsReturn {
  incidents  : Incident[];
  total      : number;
  loading    : boolean;
  error      : string | null;
  hasNextPage: boolean;
  loadNextPage: () => void;
  refetch    : () => Promise<void>;
}

/**
 * Cursor-based incident pagination.
 *
 * The API returns { data, total, nextCursor } — page numbers are not supported
 * server-side. This hook maintains a cursor stack so the UI can page forward.
 * If you need numbered pages, cache the cursors: cursors[pageN] = cursorFromPageN-1.
 */
export function useIncidents(workspaceId: string, pageSize = 20): UseIncidentsReturn {
  const [incidents,   setIncidents  ] = useState<Incident[]>([]);
  const [total,       setTotal      ] = useState(0);
  const [nextCursor,  setNextCursor ] = useState<string | null>(null);
  const [loading,     setLoading    ] = useState(true);
  const [error,       setError      ] = useState<string | null>(null);

  // Cursor stack — entry 0 = first page (no cursor), entry N = cursor for page N+1
  const cursorStack = useRef<Array<string | null>>([null]);
  const pageIndex   = useRef(0);

  const fetchPage = useCallback(async (cursor: string | null, replace: boolean) => {
    try {
      setLoading(true);
      setError(null);
      const query = cursor
        ? `/incidents/workspace/${workspaceId}?pageSize=${pageSize}&cursor=${encodeURIComponent(cursor)}`
        : `/incidents/workspace/${workspaceId}?pageSize=${pageSize}`;
      const res = await api.get<{ data: Incident[]; total: number; nextCursor: string | null }>(query);
      setIncidents(replace ? res.data : (prev) => [...prev, ...res.data]);
      setTotal(res.total);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, pageSize]);

  // Initial load
  useEffect(() => {
    cursorStack.current = [null];
    pageIndex.current   = 0;
    fetchPage(null, true);
  }, [fetchPage]);

  const loadNextPage = useCallback(() => {
    if (!nextCursor || loading) return;
    cursorStack.current.push(nextCursor);
    pageIndex.current++;
    fetchPage(nextCursor, false);
  }, [nextCursor, loading, fetchPage]);

  const refetch = useCallback(async () => {
    // Re-fetch from the first page and reset cursor state
    cursorStack.current = [null];
    pageIndex.current   = 0;
    await fetchPage(null, true);
  }, [fetchPage]);

  // Live updates via SSE
  useSSE(workspaceId, (event: SSEEvent) => {
    if (event.type === 'incident:opened' || event.type === 'incident:resolved') {
      // Reload first page so newly opened/resolved incidents appear immediately.
      // Appended pages remain visible — the user keeps their scroll position.
      refetch();
    }
  });

  return {
    incidents,
    total,
    loading,
    error,
    hasNextPage: nextCursor !== null,
    loadNextPage,
    refetch,
  };
}
