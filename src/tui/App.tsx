import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { UniflexClient, type App as AppType } from 'uniflex-sdk';
import { UniflexProvider, useUniflexClient } from 'uniflex-sdk/react';
import { AppsPanel } from './components/AppsPanel';
import { DataPanel } from './components/DataPanel';
import { UsersPanel } from './components/UsersPanel';
import { StoragePanel } from './components/StoragePanel';
import { RulesPanel } from './components/RulesPanel';
import { WebhooksPanel } from './components/WebhooksPanel';
import { RealtimePanel } from './components/RealtimePanel';
import { CommandPalette } from './components/CommandPalette';

export type TabKey = 'apps' | 'data' | 'users' | 'storage' | 'rules' | 'webhooks' | 'realtime';

interface TabItem {
  key: TabKey;
  label: string;
  num: string;
}

const TABS: TabItem[] = [
  { key: 'apps', label: 'Apps', num: '1' },
  { key: 'data', label: 'Data', num: '2' },
  { key: 'users', label: 'Users', num: '3' },
  { key: 'storage', label: 'Storage', num: '4' },
  { key: 'rules', label: 'Rules', num: '5' },
  { key: 'webhooks', label: 'Webhooks', num: '6' },
  { key: 'realtime', label: 'Realtime', num: '7' },
];

export interface AppProps {
  client: UniflexClient;
  initialAppId?: string;
  onExit?: () => void;
}

function MainDashboard({ initialAppId, onExit }: { initialAppId?: string; onExit?: () => void }) {
  const client = useUniflexClient();
  const [activeTab, setActiveTab] = useState<TabKey>('apps');
  const [appId, setAppId] = useState<string>(initialAppId || client.appId);
  const [appList, setAppList] = useState<AppType[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [showPalette, setShowPalette] = useState(false);

  // Sync client appId state
  useEffect(() => {
    client.setAppId(appId);
  }, [client, appId]);

  // Fetch available apps on boot or refresh
  useEffect(() => {
    let cancelled = false;
    client.admin.apps
      .list()
      .then(res => {
        if (!cancelled) {
          setAppList(res.apps);
          const ids = res.apps.map(a => a.id);
          if (!initialAppId && ids.length > 0 && !ids.includes(appId)) {
            setAppId(ids[0]);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, refresh, initialAppId]);

  useInput((input, key) => {
    // Check for Ctrl+P (Command Palette)
    if ((key.ctrl && input === 'p') || input === '\x10') {
      setShowPalette(prev => !prev);
      return;
    }

    if (showPalette) return;

    if (input === 'q') {
      if (onExit) onExit();
      process.exit(0);
    }
    if (input === 'r') {
      setRefresh(c => c + 1);
      return;
    }
    if (['1', '2', '3', '4', '5', '6', '7'].includes(input)) {
      const idx = parseInt(input, 10) - 1;
      if (idx >= 0 && idx < TABS.length) {
        setActiveTab(TABS[idx].key);
      }
      return;
    }
    if (key.tab || key.rightArrow || key.downArrow) {
      if (key.shift) {
        setActiveTab(prev => {
          const idx = TABS.findIndex(t => t.key === prev);
          return TABS[(idx - 1 + TABS.length) % TABS.length].key;
        });
      } else {
        setActiveTab(prev => {
          const idx = TABS.findIndex(t => t.key === prev);
          return TABS[(idx + 1) % TABS.length].key;
        });
      }
    } else if (key.leftArrow || key.upArrow) {
      setActiveTab(prev => {
        const idx = TABS.findIndex(t => t.key === prev);
        return TABS[(idx - 1 + TABS.length) % TABS.length].key;
      });
    }
  });

  const activeTabLabel = TABS.find(t => t.key === activeTab)?.label ?? 'Apps';

  return (
    <Box flexDirection="column" width="100%">
      {/* 1-line Dense Header */}
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">
          UNIFLEX ADMIN
        </Text>
        <Text dimColor>
          Endpoint: {client.endpoint} | App: <Text color="green" bold>{appId}</Text> | Tab: {activeTabLabel}
        </Text>
      </Box>

      {/* 1-line Dense Tab Bar */}
      <Box width="100%" gap={1}>
        {TABS.map(tab => {
          const isActive = tab.key === activeTab;
          return (
            <Text
              key={tab.key}
              bold={isActive}
              color={isActive ? 'cyan' : 'gray'}
              backgroundColor={isActive ? 'black' : undefined}
            >
              {isActive ? `[${tab.num}:${tab.label}]` : `${tab.num}:${tab.label}`}
            </Text>
          );
        })}
      </Box>

      {/* Command Palette Overlay */}
      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        appList={appList}
        activeAppId={appId}
        onSelectApp={setAppId}
        onSelectTab={setActiveTab}
        onRefresh={() => setRefresh(c => c + 1)}
        onQuit={() => {
          if (onExit) onExit();
          process.exit(0);
        }}
      />

      {/* Dense Panel Content Area */}
      <Box width="100%" flexDirection="column" display={showPalette ? 'none' : 'flex'}>
        {activeTab === 'apps' && (
          <AppsPanel
            appId={appId}
            refresh={refresh}
            onSelectApp={setAppId}
            onAppsLoaded={apps => setAppList(apps)}
          />
        )}
        {activeTab === 'data' && <DataPanel appId={appId} refresh={refresh} />}
        {activeTab === 'users' && <UsersPanel appId={appId} refresh={refresh} />}
        {activeTab === 'storage' && <StoragePanel appId={appId} refresh={refresh} />}
        {activeTab === 'rules' && <RulesPanel appId={appId} refresh={refresh} />}
        {activeTab === 'webhooks' && <WebhooksPanel appId={appId} refresh={refresh} />}
        {activeTab === 'realtime' && <RealtimePanel appId={appId} />}
      </Box>

      {/* 1-line Dense Footer */}
      <Box width="100%">
        <Text dimColor>[Ctrl+P] Command Palette | [q] Quit | [Tab/Arrows] Switch Tab | [1-7] Direct Jump | [r] Refresh</Text>
      </Box>
    </Box>
  );
}

export function App({ client, initialAppId, onExit }: AppProps) {
  return (
    <UniflexProvider client={client}>
      <MainDashboard initialAppId={initialAppId} onExit={onExit} />
    </UniflexProvider>
  );
}
