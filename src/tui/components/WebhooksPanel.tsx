import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { WebhookItem } from 'uniflex-sdk';
import { useUniflexClient } from 'uniflex-sdk/react';
import { formatDate, truncate } from './format';

interface WebhooksPanelProps {
  appId: string;
  refresh: number;
  inputActive: boolean;
  onAction: (action: string) => void;
  onSelectionChange: (webhook: WebhookItem | undefined) => void;
}

export function WebhooksPanel({ appId, refresh, inputActive, onAction, onSelectionChange }: WebhooksPanelProps) {
  const client = useUniflexClient();
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
    onSelectionChange(undefined);
  }, [appId, onSelectionChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client.admin.webhooks
      .list()
      .then(result => {
        if (!cancelled) {
          setWebhooks(result.webhooks);
          setSelectedIndex(0);
        }
      })
      .catch(reason => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setWebhooks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, client, refresh]);

  useEffect(() => {
    onSelectionChange(webhooks[selectedIndex]);
  }, [onSelectionChange, selectedIndex, webhooks]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex(current => Math.min(current + 1, Math.max(0, webhooks.length - 1)));
      } else if (key.upArrow) {
        setSelectedIndex(current => Math.max(0, current - 1));
      } else if (input === 'a') {
        onAction('webhook.create');
      } else if (input === 'd') {
        onAction('webhook.delete');
      }
    },
    { isActive: inputActive }
  );

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">WEBHOOKS / {appId}</Text>
        <Text dimColor>{webhooks.length} configured</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      {loading && webhooks.length === 0 ? (
        <Text color="yellow">Loading webhooks…</Text>
      ) : webhooks.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>No webhooks configured for this application.</Text>
          <Text dimColor>Press a to register one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {webhooks.map((webhook, index) => {
            const selected = index === selectedIndex;
            return (
              <Box flexDirection="column" key={webhook.id} marginBottom={1}>
                <Text bold={selected} color={selected ? 'cyan' : undefined}>
                  {selected ? '> ' : '  '}
                  {truncate(webhook.url, 88)}
                </Text>
                <Text dimColor>
                  {webhook.id} · {webhook.events.join(', ')} · {formatDate(webhook.createdAt)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Text dimColor>[↑↓] Select · [a] Add · [d] Delete</Text>
    </Box>
  );
}
