import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useUniflexClient } from '@uniflex/sdk/react';
import type { WebhookItem } from '@uniflex/sdk';
import type { PanelProps } from './DataPanel';

export function WebhooksPanel({ appId, refresh }: PanelProps) {
  const client = useUniflexClient();
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.admin.webhooks
      .list()
      .then(res => {
        if (!cancelled) {
          setWebhooks(res.webhooks);
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

  if (loading && webhooks.length === 0) {
    return <Text color="yellow">Loading webhooks for tenant "{appId}"...</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error}</Text>}
      <Text bold color="cyan">
        WEBHOOKS ({webhooks.length})
      </Text>
      {webhooks.length === 0 ? (
        <Text dimColor>No webhooks configured for tenant "{appId}".</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          <Box width="100%">
            <Box width={20}><Text bold color="yellow">ID</Text></Box>
            <Box width={30}><Text bold color="yellow">URL</Text></Box>
            <Box width={24}><Text bold color="yellow">EVENTS</Text></Box>
            <Box width={24}><Text bold color="yellow">CREATED AT</Text></Box>
          </Box>
          {webhooks.map(w => (
            <Box key={w.id} width="100%">
              <Box width={20}><Text>{w.id}</Text></Box>
              <Box width={30}><Text>{w.url}</Text></Box>
              <Box width={24}><Text>{w.events.join(', ')}</Text></Box>
              <Box width={24}><Text>{new Date(w.createdAt).toLocaleString()}</Text></Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
