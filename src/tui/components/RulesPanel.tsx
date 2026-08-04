import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useUniflexClient } from 'uniflex-sdk/react';

interface RulesPanelProps {
  appId: string;
  refresh: number;
  inputActive: boolean;
  onAction: (action: string) => void;
}

type Rules = Record<string, Record<string, string>>;

export function RulesPanel({ appId, refresh, inputActive, onAction }: RulesPanelProps) {
  const client = useUniflexClient();
  const [rules, setRules] = useState<Rules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client.admin.rules
      .get()
      .then(result => {
        if (!cancelled) setRules(result.rules[appId] ?? null);
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, client, refresh]);

  useInput(
    input => {
      if (input === 'e') onAction('rules.edit');
    },
    { isActive: inputActive }
  );

  const collections = Object.entries(rules ?? {});

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">SECURITY RULES / {appId}</Text>
        <Text dimColor>{collections.length} collections</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      {loading ? (
        <Text color="yellow">Loading rules…</Text>
      ) : collections.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>No rules configured for this application.</Text>
          <Text dimColor>Press e to define collection access rules.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {collections.map(([collection, operations]) => (
            <Box flexDirection="column" key={collection} marginBottom={1}>
              <Text bold color="cyan">{collection}</Text>
              {Object.entries(operations).map(([operation, expression]) => (
                <Text key={operation}>
                  <Text color="yellow">  {operation.padEnd(6)}</Text>
                  <Text dimColor>{expression}</Text>
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      )}
      <Text dimColor>[e] Edit rules</Text>
    </Box>
  );
}
