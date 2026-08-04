import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useUniflexClient } from '@uniflex/sdk/react';
import type { PanelProps } from './DataPanel';

export function RulesPanel({ appId, refresh }: PanelProps) {
  const client = useUniflexClient();
  const [rules, setRules] = useState<Record<string, Record<string, string>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.admin.rules
      .get()
      .then(res => {
        if (!cancelled) {
          setRules((res.rules as Record<string, Record<string, Record<string, string>>>)[appId] ?? null);
          setError(null);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, appId, refresh]);

  if (loading && rules === null) {
    return <Text color="yellow">Loading security rules...</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error}</Text>}
      <Text bold color="cyan">
        SECURITY RULES ({appId})
      </Text>
      {!rules || Object.keys(rules).length === 0 ? (
        <Text dimColor>No security rules configured for tenant "{appId}".</Text>
      ) : (
        <Box width="100%" flexDirection="column">
          <Text>{JSON.stringify(rules, null, 2)}</Text>
        </Box>
      )}
    </Box>
  );
}
