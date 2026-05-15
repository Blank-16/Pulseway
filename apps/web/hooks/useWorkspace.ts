'use client';

import { useState, useEffect } from 'react';
import { api, setAccessToken } from '../lib/api-client';
import type { Workspace } from '@pulseway/types';

interface SessionState {
  workspaceId: string | null;
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
}

let cachedWorkspaceId: string | null = null;

export function useWorkspace(): SessionState {
  const [state, setState] = useState<SessionState>({
    workspaceId: cachedWorkspaceId,
    workspaces: [],
    loading: !cachedWorkspaceId,
    error: null,
  });

  useEffect(() => {
    if (cachedWorkspaceId) return;

    async function init() {
      try {
        // Refresh access token from httpOnly cookie
        const refreshRes = await api.post<{ data: { accessToken: string } }>(
          '/auth/refresh',
          undefined,
          { skipAuth: true },
        );
        setAccessToken(refreshRes.data.accessToken);

        // Fetch workspaces for the authenticated user
        const wsRes = await api.get<{ data: Workspace[] }>('/team/workspaces');
        const workspaces = wsRes.data;
        const defaultWs = workspaces[0];

        if (!defaultWs) throw new Error('No workspaces found');

        cachedWorkspaceId = defaultWs.id;
        setState({ workspaceId: defaultWs.id, workspaces, loading: false, error: null });
      } catch {
        setState((prev) => ({ ...prev, loading: false, error: 'Session expired' }));
        // Redirect to login handled by Next.js middleware on next navigation
      }
    }

    init();
  }, []);

  return state;
}
