'use client';

import { useEffect, useRef } from 'react';
import type { SSEEvent } from '@pulseway/types';

const RECONNECT_DELAY_MS = 5_000;

export function useSSE(workspaceId: string, onEvent: (event: SSEEvent) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!workspaceId) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect(): void {
      source = new EventSource(`/api/events/workspace/${workspaceId}`, { withCredentials: true });

      source.onmessage = (e: MessageEvent<string>) => {
        try {
          const event = JSON.parse(e.data) as SSEEvent;
          onEventRef.current(event);
        } catch {
          // Ignore parse errors (heartbeat comments etc.)
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [workspaceId]);
}
