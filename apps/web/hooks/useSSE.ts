'use client';

import { useEffect, useRef } from 'react';
import type { SSEEvent } from '@pulseway/types';

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

// Named SSE events emitted by the server that need addEventListener, not onmessage
const NAMED_EVENTS = ['snapshot', 'error', 'shutdown'] as const;
type NamedEvent = typeof NAMED_EVENTS[number];

export function useSSE(workspaceId: string, onEvent: (event: SSEEvent | { type: NamedEvent; data: unknown }) => void): void {
  const onEventRef     = useRef(onEvent);
  const reconnectDelay = useRef(RECONNECT_DELAY_MS);
  onEventRef.current   = onEvent;

  useEffect(() => {
    if (!workspaceId) return;

    let source        : EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed     = false;

    function connect(): void {
      source = new EventSource(
        `/api/events/workspace/${workspaceId}`,
        { withCredentials: true },
      );

      // Unnamed events (type: "message") — check:completed, incident:opened, incident:resolved
      source.onmessage = (e: MessageEvent<string>) => {
        try {
          const event = JSON.parse(e.data) as SSEEvent;
          onEventRef.current(event);
        } catch {
          // Ignore heartbeat comments and malformed payloads
        }
      };

      // Named events require addEventListener — onmessage never receives them
      for (const eventName of NAMED_EVENTS) {
        source.addEventListener(eventName, (e: Event) => {
          const msgEvent = e as MessageEvent<string>;
          try {
            const data = JSON.parse(msgEvent.data) as unknown;
            onEventRef.current({ type: eventName, data } as SSEEvent);
          } catch {
            // Malformed named event payload — ignore
          }
        });
      }

      source.onopen = () => {
        // Reset reconnect delay on successful connection
        reconnectDelay.current = RECONNECT_DELAY_MS;
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (!destroyed) {
          // Exponential backoff — cap at MAX_RECONNECT_DELAY_MS
          reconnectTimer = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY_MS);
            connect();
          }, reconnectDelay.current);
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
