import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRealtime } from 'uniflex-sdk/react';
import type { PanelProps } from './DataPanel';

export function RealtimePanel(_props: PanelProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const lastEvent = useRealtime('*');

  useEffect(() => {
    if (lastEvent) {
      const timeStr = new Date().toTimeString().split(' ')[0];
      const line = `[${timeStr}] [${lastEvent.collection}] ${lastEvent.action.toUpperCase()}: ${JSON.stringify(lastEvent.data)}`;
      setLogs(prev => [...prev, line].slice(-200));
    }
  }, [lastEvent]);

  return (
    <Box flexDirection="column" width="100%">
      <Box width="100%">
        <Text bold color="cyan">
          REALTIME STREAM (all tenant collections) —{' '}
        </Text>
        <Text color="green" bold>
          Subscribed
        </Text>
      </Box>

      {logs.length === 0 ? (
        <Text dimColor>Awaiting real-time events across all tenant collections...</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          {logs.slice(-25).map((log, i) => (
            <Text key={i}>{log}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
