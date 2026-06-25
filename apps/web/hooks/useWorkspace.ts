'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, setAccessToken } from '../lib/api-client';
import type { Workspace } from '@pulseway/types';

interface SessionState {
  workspaceId: string | null;
  workspaces : Workspace[];
  loading    : boolean;
  error      : string | null;
}

const STORAGE_KEY = 'pulseway_workspace_id';

function getStoredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeWorkspaceId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // sessionStorage may be unavailable (private browsing, storage full)
  }
}

function clearStoredWorkspaceId(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const initialWorkspaceId = getStoredWorkspaceId();

export function useWorkspace(): SessionState & { switchWorkspace: (id: string) => void } {
  const [state, setState] = useState<SessionState>({
    workspaceId: initialWorkspaceId,
    workspaces : [],
    loading    : true,
    error      : null,
  });

  const init = useCallback(async () => {
    try {
      // Refresh access token from httpOnly cookie
      const refreshRes = await api.post<{ data: { accessToken: string } }>(
        '/auth/refresh',
        undefined,
        { skipAuth: true },
      );
      setAccessToken(refreshRes.data.accessToken);

      const wsRes      = await api.get<{ data: Workspace[] }>('/team/workspaces');
      const workspaces = wsRes.data;
      const stored     = getStoredWorkspaceId();

      // Prefer stored workspace if it's still in the list (e.g. user refreshed the page)
      const active =
        workspaces.find((w) => w.id === stored) ??
        workspaces[0];

      if (!active) throw new Error('No workspaces found');

      storeWorkspaceId(active.id);
      setState({ workspaceId: active.id, workspaces, loading: false, error: null });
    } catch {
      clearStoredWorkspaceId();
      setState((prev) => ({ ...prev, loading: false, error: 'Session expired' }));
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  const switchWorkspace = useCallback((id: string) => {
    storeWorkspaceId(id);
    setState((prev) => ({ ...prev, workspaceId: id }));
  }, []);

  return { ...state, switchWorkspace };
}
