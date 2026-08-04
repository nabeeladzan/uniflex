import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useUniflexClient } from 'uniflex-sdk/react';
import type { App as AppType } from 'uniflex-sdk';
import type { PanelProps } from './DataPanel';

export function AppsPanel({ appId, refresh, onAppsLoaded }: PanelProps) {
  const client = useUniflexClient();
  const [apps, setApps] = useState<AppType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.admin.apps
      .list()
      .then(res => {
        if (!cancelled) {
          setApps(res.apps);
          setError(null);
          setLoading(false);
          if (onAppsLoaded) onAppsLoaded(res.apps);
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
  }, [client, refresh, onAppsLoaded]);

  if (loading && apps.length === 0) {
    return <Text color="yellow">Loading applications...</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error}</Text>}
      <Text bold color="cyan">
        APPLICATIONS ({apps.length})
      </Text>
      {apps.length === 0 ? (
        <Text dimColor>No applications registered.</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          <Box width="100%">
            <Box width={16}><Text bold color="yellow">ID</Text></Box>
            <Box width={20}><Text bold color="yellow">NAME</Text></Box>
            <Box width={38}><Text bold color="yellow">API KEY</Text></Box>
            <Box width={12}><Text bold color="yellow">STATUS</Text></Box>
            <Box width={24}><Text bold color="yellow">CREATED AT</Text></Box>
          </Box>
          {apps.map(app => {
            const isActive = app.id === appId;
            return (
              <Box key={app.id} width="100%">
                <Box width={16}>
                  <Text bold={isActive} color={isActive ? 'cyan' : undefined}>
                    {app.id}
                  </Text>
                </Box>
                <Box width={20}><Text>{app.name}</Text></Box>
                <Box width={38}><Text>{app.apiKey}</Text></Box>
                <Box width={12}>
                  {isActive ? (
                    <Text color="green" bold>[ACTIVE]</Text>
                  ) : (
                    <Text dimColor>select ('a')</Text>
                  )}
                </Box>
                <Box width={24}><Text>{new Date(app.createdAt).toLocaleString()}</Text></Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
