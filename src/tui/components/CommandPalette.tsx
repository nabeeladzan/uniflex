import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { App as AppType } from '@uniflex/sdk';
import type { TabKey } from '../App';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  appList: AppType[];
  activeAppId: string;
  onSelectApp: (appId: string) => void;
  onSelectTab: (tabKey: TabKey) => void;
  onRefresh: () => void;
  onQuit: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  detail?: string;
}

const BASE_ACTIONS: ActionItem[] = [
  { id: 'switch_app', label: '> Switch Application', detail: 'Select active tenant application' },
  { id: 'tab_apps', label: 'Go to Tab: Apps', detail: 'Jump to Apps tab (1)' },
  { id: 'tab_data', label: 'Go to Tab: Data', detail: 'Jump to Data tab (2)' },
  { id: 'tab_users', label: 'Go to Tab: Users', detail: 'Jump to Users tab (3)' },
  { id: 'tab_storage', label: 'Go to Tab: Storage', detail: 'Jump to Storage tab (4)' },
  { id: 'tab_rules', label: 'Go to Tab: Rules', detail: 'Jump to Rules tab (5)' },
  { id: 'tab_webhooks', label: 'Go to Tab: Webhooks', detail: 'Jump to Webhooks tab (6)' },
  { id: 'tab_realtime', label: 'Go to Tab: Realtime', detail: 'Jump to Realtime tab (7)' },
  { id: 'refresh', label: 'Refresh Data', detail: 'Reload active panel data (r)' },
  { id: 'quit', label: 'Quit TUI', detail: 'Exit application (q)' },
];

export function CommandPalette({
  isOpen,
  onClose,
  appList,
  activeAppId,
  onSelectApp,
  onSelectTab,
  onRefresh,
  onQuit,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<'actions' | 'apps'>('actions');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter items based on mode and query
  let items: ActionItem[] = [];
  if (mode === 'actions') {
    items = BASE_ACTIONS.filter(
      a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        (a.detail && a.detail.toLowerCase().includes(query.toLowerCase()))
    );
  } else {
    items = appList
      .filter(
        a =>
          a.id.toLowerCase().includes(query.toLowerCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase())
      )
      .map(a => ({
        id: a.id,
        label: `${a.id === activeAppId ? '* ' : '  '}${a.id}`,
        detail: `${a.name} (${a.id === activeAppId ? 'Active' : 'Select'})`,
      }));
  }

  useInput((input, key) => {
    if (!isOpen) return;

    if (key.escape) {
      if (mode === 'apps') {
        setMode('actions');
        setQuery('');
        setSelectedIndex(0);
      } else {
        onClose();
        setQuery('');
        setSelectedIndex(0);
      }
      return;
    }

    if (key.downArrow) {
      if (items.length > 0) {
        setSelectedIndex(prev => (prev + 1) % items.length);
      }
      return;
    }

    if (key.upArrow) {
      if (items.length > 0) {
        setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
      }
      return;
    }

    if (key.return) {
      if (items.length === 0) return;
      const selected = items[selectedIndex % items.length];
      if (mode === 'actions') {
        if (selected.id === 'switch_app') {
          setMode('apps');
          setQuery('');
          setSelectedIndex(0);
        } else if (selected.id.startsWith('tab_')) {
          const tabKey = selected.id.replace('tab_', '') as TabKey;
          onSelectTab(tabKey);
          onClose();
        } else if (selected.id === 'refresh') {
          onRefresh();
          onClose();
        } else if (selected.id === 'quit') {
          onQuit();
        }
      } else {
        // Mode === 'apps'
        onSelectApp(selected.id);
        onClose();
        setMode('actions');
        setQuery('');
        setSelectedIndex(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    // Type query text
    if (input && !key.ctrl && !key.meta && input.length === 1 && input.charCodeAt(0) >= 32) {
      setQuery(q => q + input);
      setSelectedIndex(0);
    }
  });

  if (!isOpen) return null;

  const promptText = mode === 'actions' ? 'Command Palette' : 'Select Application';

  return (
    <Box flexDirection="column" width="100%" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
      <Box width="100%">
        <Text bold color="cyan">
          {promptText} &gt;{' '}
        </Text>
        <Text color="yellow">{query}</Text>
        <Text dimColor>_</Text>
      </Box>

      {items.length === 0 ? (
        <Text dimColor>No matching commands found.</Text>
      ) : (
        <Box flexDirection="column" width="100%" marginTop={1}>
          {items.slice(0, 8).map((item, idx) => {
            const isSelected = idx === selectedIndex % items.length;
            return (
              <Box key={item.id} width="100%">
                <Box width={32}>
                  <Text bold={isSelected} color={isSelected ? 'cyan' : undefined} backgroundColor={isSelected ? 'black' : undefined}>
                    {isSelected ? `> ${item.label}` : `  ${item.label}`}
                  </Text>
                </Box>
                {item.detail && (
                  <Box width={40}>
                    <Text dimColor>{item.detail}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      <Box width="100%" marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
