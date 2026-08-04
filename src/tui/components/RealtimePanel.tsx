import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RealtimeEvent } from 'uniflex-sdk';
import { useUniflexClient } from 'uniflex-sdk/react';
import { truncate } from './format';

interface RealtimePanelProps {
  appId: string;
  collection: string;
  reset: number;
  inputActive: boolean;
  onAction: (action: string) => void;
}

type ConnectionState = 'connected' | 'connecting' | 'reconnecting';

export function RealtimePanel({ appId, collection, reset, inputActive, onAction }: RealtimePanelProps) {
  const client = useUniflexClient();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    setEvents([]);
  }, [appId, collection, reset]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempts = 0;

    const connect = () => {
      setConnection(attempts === 0 ? 'connecting' : 'reconnecting');
      const endpoint = `${client.endpoint.replace(/^http/, 'ws')}/v1/realtime?appId=${encodeURIComponent(appId)}`;
      socket = new WebSocket(endpoint);

      socket.onopen = () => {
        attempts = 0;
        setConnection('connected');
        socket?.send(JSON.stringify({ type: 'subscribe', collection }));
      };

      socket.onmessage = event => {
        if (typeof event.data !== 'string') return;
        try {
          const frame = JSON.parse(event.data) as RealtimeEvent;
          if (frame.type === 'event' && (collection === '*' || frame.collection === collection)) {
            setEvents(current => [...current, frame].slice(-100));
          }
        } catch {
          // Ignore malformed frames; a single bad message should not terminate the monitor.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        attempts += 1;
        setConnection('reconnecting');
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5));
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [appId, client.endpoint, collection]);

  useInput(
    input => {
      if (input === 'c') onAction('realtime.collection');
      if (input === 'x') onAction('realtime.clear');
    },
    { isActive: inputActive }
  );

  const mutationCounts = useMemo(() => {
    return events.reduce(
      (counts, event) => {
        const action = event.action.toLowerCase();
        if (action === 'create') counts.create += 1;
        if (action === 'update') counts.update += 1;
        if (action === 'delete') counts.delete += 1;
        return counts;
      },
      { create: 0, update: 0, delete: 0 }
    );
  }, [events]);

  const connectionColor = connection === 'connected' ? 'green' : 'yellow';

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">REALTIME / {appId}</Text>
        <Text color={connectionColor}>{connection.toUpperCase()}</Text>
      </Box>
      <Text dimColor>
        Collection {collection} · {events.length} events · create {mutationCounts.create} · update {mutationCounts.update} · delete {mutationCounts.delete}
      </Text>
      {events.length === 0 ? (
        <Box marginTop={1}>
          <Text>Listening for document mutations…</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {events.slice(-20).map((event, index) => {
            const time = new Date().toLocaleTimeString();
            const payload = event.data.data ? JSON.stringify(event.data.data) : JSON.stringify(event.data);
            return (
              <Text key={`${event.data.id}-${index}`}>
                <Text dimColor>[{time}] </Text>
                <Text color={event.action === 'delete' ? 'red' : event.action === 'create' ? 'green' : 'yellow'}>
                  {event.action.toUpperCase()}
                </Text>
                <Text> {event.collection} · {event.data.id} · </Text>
                <Text dimColor>{truncate(payload, 100)}</Text>
              </Text>
            );
          })}
        </Box>
      )}
      <Text dimColor>[c] Collection filter · [x] Clear feed</Text>
    </Box>
  );
}
