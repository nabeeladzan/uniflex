import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { App as AppType } from 'uniflex-sdk';
import { formatDate, truncate } from './format';

interface AppsPanelProps {
  activeAppId: string;
  apps: AppType[];
  error: string | null;
  loading: boolean;
  inputActive: boolean;
  onAction: (action: string) => void;
  onSelectApp: (appId: string) => void;
}

export function AppsPanel({
  activeAppId,
  apps,
  error,
  loading,
  inputActive,
  onAction,
  onSelectApp,
}: AppsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const activeIndex = apps.findIndex(app => app.id === activeAppId);
    setSelectedIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [activeAppId, apps]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex(current => Math.min(current + 1, Math.max(0, apps.length - 1)));
      } else if (key.upArrow) {
        setSelectedIndex(current => Math.max(0, current - 1));
      } else if (key.return && apps[selectedIndex]) {
        onSelectApp(apps[selectedIndex].id);
      } else if (input === 'a') {
        onAction('app.create');
      } else if (input === 's') {
        onAction('app.switch');
      }
    },
    { isActive: inputActive }
  );

  if (loading && apps.length === 0) {
    return <Text color="yellow">Loading applications…</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">APPLICATIONS</Text>
        <Text dimColor>{apps.length} registered</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      {apps.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>No applications registered.</Text>
          <Text dimColor>Press a to create the first tenant.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {apps.map((app, index) => {
            const selected = index === selectedIndex;
            const active = app.id === activeAppId;
            return (
              <Box flexDirection="column" key={app.id} marginBottom={1}>
                <Box width="100%">
                  <Text color={selected ? 'cyan' : undefined} bold={selected}>
                    {selected ? '> ' : '  '}
                    {app.name}
                  </Text>
                  {active && <Text color="green">  ACTIVE</Text>}
                </Box>
                <Text dimColor>
                  {app.id} · key {truncate(app.apiKey, 36)} · created {formatDate(app.createdAt)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Text dimColor>[↑↓] Select · [Enter] Activate · [a] Create · [s] Switch</Text>
    </Box>
  );
}
