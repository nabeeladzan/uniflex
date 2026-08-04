import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useRealtime } from '@uniflex/sdk/react';
import type { PanelProps } from './DataPanel';

const SPARK_CHARS = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function RealtimePanel(_props: PanelProps) {
  const [totalEvents, setTotalEvents] = useState(0);
  const [breakdown, setBreakdown] = useState({ create: 0, update: 0, delete: 0 });
  const [colStats, setColStats] = useState<Record<string, number>>({});
  const [rateHistory, setRateHistory] = useState<number[]>(new Array(30).fill(0));
  const [recentFeed, setRecentFeed] = useState<string[]>([]);
  const windowCount = useRef(0);

  const lastEvent = useRealtime('*');

  // Track incoming events
  useEffect(() => {
    if (lastEvent) {
      windowCount.current += 1;
      setTotalEvents((t) => t + 1);

      const action = lastEvent.action.toLowerCase();
      setBreakdown((prev) => ({
        ...prev,
        create: prev.create + (action === 'create' ? 1 : 0),
        update: prev.update + (action === 'update' ? 1 : 0),
        delete: prev.delete + (action === 'delete' ? 1 : 0),
      }));

      setColStats((prev) => ({
        ...prev,
        [lastEvent.collection]: (prev[lastEvent.collection] || 0) + 1,
      }));

      const timeStr = new Date().toTimeString().split(' ')[0];
      const feedLine = `[${timeStr}] [${lastEvent.collection}] ${lastEvent.action.toUpperCase()}: ${JSON.stringify(lastEvent.data)}`;
      setRecentFeed((prev) => [...prev, feedLine].slice(-8));
    }
  }, [lastEvent]);

  // Tick 1-second interval for sparkline rate history
  useEffect(() => {
    const timer = setInterval(() => {
      const currentOps = windowCount.current;
      windowCount.current = 0;
      setRateHistory((prev) => [...prev.slice(1), currentOps]);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const currentRate = rateHistory[rateHistory.length - 1] || 0;
  const maxRate = Math.max(...rateHistory, 1);

  // Render Sparkline string
  const sparkline = rateHistory
    .map((rate) => {
      const idx = Math.min(Math.floor((rate / maxRate) * (SPARK_CHARS.length - 1)), SPARK_CHARS.length - 1);
      return SPARK_CHARS[idx];
    })
    .join('');

  const topCols = Object.entries(colStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Box flexDirection="column" width="100%">
      {/* Performance Header & Gauge */}
      <Box width="100%" justifyContent="space-between" marginBottom={1}>
        <Box gap={2}>
          <Text bold color="cyan">
            REALTIME PERFORMANCE MONITOR
          </Text>
          <Text color="green" bold>
            [SUBSCRIBED]
          </Text>
        </Box>
        <Text bold color="yellow">
          {currentRate} ops/sec
        </Text>
      </Box>

      {/* Sparkline Rate Bar */}
      <Box width="100%" borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold>Traffic (last 30s): </Text>
        <Text color="cyan" bold>
          {sparkline}
        </Text>
        <Text dimColor> (peak: {maxRate} ops/s)</Text>
      </Box>

      {/* Metrics Grid */}
      <Box width="100%" marginTop={1} gap={4}>
        {/* Total & Breakdown */}
        <Box flexDirection="column" width={32}>
          <Text bold color="yellow">
            MUTATION COUNTS
          </Text>
          <Text>
            Total Events: <Text bold>{totalEvents}</Text>
          </Text>
          <Text color="green"> CREATE: {breakdown.create}</Text>
          <Text color="cyan"> UPDATE: {breakdown.update}</Text>
          <Text color="red"> DELETE: {breakdown.delete}</Text>
        </Box>

        {/* Top Collections */}
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color="yellow">
            TOP ACTIVE COLLECTIONS
          </Text>
          {topCols.length === 0 ? (
            <Text dimColor>No activity recorded yet.</Text>
          ) : (
            topCols.map(([col, count]) => (
              <Text key={col}>
                {col}: <Text bold color="cyan">{count} events</Text>
              </Text>
            ))
          )}
        </Box>
      </Box>

      {/* Live Stream Feed */}
      <Box flexDirection="column" marginTop={1} width="100%">
        <Text bold color="yellow">
          LIVE FEED (latest 8 events)
        </Text>
        {recentFeed.length === 0 ? (
          <Text dimColor>Awaiting real-time events across all tenant collections...</Text>
        ) : (
          recentFeed.map((line, i) => <Text key={i}>{line}</Text>)
        )}
      </Box>
    </Box>
  );
}
