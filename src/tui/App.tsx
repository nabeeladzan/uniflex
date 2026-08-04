import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import {
  type App as AppType,
  type DocumentItem,
  type FileMeta,
  type UniflexClient,
  type User,
  type WebhookItem,
} from 'uniflex-sdk';
import { UniflexProvider } from 'uniflex-sdk/react';
import { AppsPanel } from './components/AppsPanel';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { ConfirmDialog, FormDialog, type FormField, type FormValues } from './components/Dialogs';
import { DataPanel } from './components/DataPanel';
import { documentPayload } from './components/format';
import { RealtimePanel } from './components/RealtimePanel';
import { RulesPanel } from './components/RulesPanel';
import { StoragePanel } from './components/StoragePanel';
import { UsersPanel } from './components/UsersPanel';
import { WebhooksPanel } from './components/WebhooksPanel';

export type TabKey = 'apps' | 'data' | 'users' | 'storage' | 'rules' | 'webhooks' | 'realtime';

type RecordDocument = DocumentItem<Record<string, unknown>>;
type NoticeKind = 'error' | 'info' | 'success';
type PaletteMode = 'apps' | 'commands' | null;

interface Notice {
  kind: NoticeKind;
  message: string;
}

interface FormSpec {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
}

interface ConfirmSpec {
  id: string;
  title: string;
  detail: string;
  confirmation: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

interface TabItem {
  key: TabKey;
  label: string;
  shortcut: string;
}

const TABS: TabItem[] = [
  { key: 'apps', label: 'Apps', shortcut: '1' },
  { key: 'data', label: 'Data', shortcut: '2' },
  { key: 'users', label: 'Users', shortcut: '3' },
  { key: 'storage', label: 'Storage', shortcut: '4' },
  { key: 'rules', label: 'Rules', shortcut: '5' },
  { key: 'webhooks', label: 'Webhooks', shortcut: '6' },
  { key: 'realtime', label: 'Realtime', shortcut: '7' },
];

export interface AppProps {
  client: UniflexClient;
  initialAppId?: string;
  onExit?: () => void;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function validCollection(value: string): string {
  const collection = value.trim();
  if (!/^[a-z0-9_-]{1,64}$/.test(collection)) {
    throw new Error('Collection names use 1–64 lowercase letters, numbers, underscores, or hyphens.');
  }
  return collection;
}

function MainDashboard({ client, initialAppId, onExit }: AppProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('apps');
  const [appId, setAppId] = useState(initialAppId || client.appId);
  const [apps, setApps] = useState<AppType[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [health, setHealth] = useState<'checking' | 'offline' | 'online'>('checking');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>(null);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmSpec | null>(null);
  const [dataCollection, setDataCollection] = useState('products');
  const [dataSearch, setDataSearch] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<RecordDocument | undefined>();
  const [selectedUser, setSelectedUser] = useState<User | undefined>();
  const [selectedFile, setSelectedFile] = useState<FileMeta | undefined>();
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookItem | undefined>();
  const [realtimeCollection, setRealtimeCollection] = useState('*');
  const [realtimeReset, setRealtimeReset] = useState(0);

  const overlayOpen = paletteMode !== null || form !== null || confirmation !== null;
  const activeTabLabel = TABS.find(tab => tab.key === activeTab)?.label ?? 'Apps';

  // Ink deactivates raw mode when a focused panel or dialog unmounts; restore it after each dashboard render.
  const { setRawMode } = useStdin();
  useEffect(() => {
    if (!overlayOpen) setRawMode(true);
  });

  const notify = (kind: NoticeKind, message: string) => {
    setNotice({ kind, message });
  };

  const refreshAll = () => {
    setRefresh(current => current + 1);
  };

  useEffect(() => {
    client.setAppId(appId);
    setSelectedDocument(undefined);
    setSelectedUser(undefined);
    setSelectedFile(undefined);
    setSelectedWebhook(undefined);
  }, [appId, client]);

  useEffect(() => {
    let cancelled = false;
    setAppsLoading(true);
    client.admin.apps
      .list()
      .then(result => {
        if (cancelled) return;
        setApps(result.apps);
        setAppsError(null);
        if (!initialAppId && result.apps.length > 0 && !result.apps.some(app => app.id === appId)) {
          setAppId(result.apps[0].id);
        }
      })
      .catch(reason => {
        if (!cancelled) setAppsError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setAppsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, client, initialAppId, refresh]);

  useEffect(() => {
    let cancelled = false;

    const checkHealth = () => {
      fetch(`${client.endpoint}/health`)
        .then(response => {
          if (!cancelled) setHealth(response.ok ? 'online' : 'offline');
        })
        .catch(() => {
          if (!cancelled) setHealth('offline');
        });
    };

    checkHealth();
    const interval = setInterval(checkHealth, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [client.endpoint]);

  const commandItems = useMemo<PaletteItem[]>(
    () => [
      { id: 'app.switch', label: 'App: switch active application', detail: 'Choose the tenant shown in every panel' },
      { id: 'app.create', label: 'App: create application', detail: 'Register a tenant with an optional slug' },
      { id: 'data.collection', label: 'Data: change collection', detail: `Current: ${dataCollection}` },
      { id: 'data.search', label: 'Data: search collection', detail: dataSearch ? `Current query: ${dataSearch}` : 'Full-text search' },
      { id: 'data.clear-search', label: 'Data: clear search', detail: 'Return to normal collection browsing', disabled: !dataSearch },
      { id: 'data.create', label: 'Data: create document', detail: `Add JSON to ${dataCollection}` },
      { id: 'data.edit', label: 'Data: edit selected document', detail: selectedDocument ? selectedDocument.id : 'Select a document first', disabled: !selectedDocument },
      { id: 'data.delete', label: 'Data: delete selected document', detail: selectedDocument ? selectedDocument.id : 'Select a document first', disabled: !selectedDocument },
      { id: 'user.create', label: 'Users: create user', detail: `Register a user in ${appId}` },
      { id: 'user.role', label: 'Users: change selected role', detail: selectedUser ? selectedUser.email : 'Select a user first', disabled: !selectedUser },
      { id: 'user.ban', label: selectedUser?.banned ? 'Users: unban selected user' : 'Users: ban selected user', detail: selectedUser ? selectedUser.email : 'Select a user first', disabled: !selectedUser },
      { id: 'user.password', label: 'Users: reset selected password', detail: selectedUser ? selectedUser.email : 'Select a user first', disabled: !selectedUser },
      { id: 'storage.upload', label: 'Storage: upload local file', detail: 'Send a file from this computer to the active tenant' },
      { id: 'storage.download', label: 'Storage: download selected file', detail: selectedFile ? selectedFile.filename : 'Select a file first', disabled: !selectedFile },
      { id: 'storage.delete', label: 'Storage: delete selected file', detail: selectedFile ? selectedFile.filename : 'Select a file first', disabled: !selectedFile },
      { id: 'rules.edit', label: 'Rules: edit active tenant rules', detail: 'Validate and save collection rule JSON' },
      { id: 'webhook.create', label: 'Webhooks: create webhook', detail: 'Register URL and event names' },
      { id: 'webhook.delete', label: 'Webhooks: delete selected webhook', detail: selectedWebhook ? selectedWebhook.url : 'Select a webhook first', disabled: !selectedWebhook },
      { id: 'realtime.collection', label: 'Realtime: change collection filter', detail: `Current: ${realtimeCollection}` },
      { id: 'realtime.clear', label: 'Realtime: clear event feed', detail: 'Discard displayed events and keep listening' },
      ...TABS.map(tab => ({ id: `tab.${tab.key}`, label: `Navigate: ${tab.label}`, detail: `Open tab ${tab.shortcut}` })),
      { id: 'system.refresh', label: 'System: refresh current data', detail: 'Reload server state' },
      { id: 'system.quit', label: 'System: quit dashboard', detail: 'Return to the terminal' },
    ],
    [appId, dataCollection, dataSearch, realtimeCollection, selectedDocument, selectedFile, selectedUser, selectedWebhook]
  );

  const runAction = (action: string) => {
    setPaletteMode(null);

    if (action === 'app.switch') {
      setPaletteMode('apps');
      return;
    }

    if (action === 'app.create') {
      setForm({
        id: 'create-app',
        title: 'Create application',
        description: 'A slug is optional. Leave it empty to have Uniflex generate an ID.',
        fields: [
          { key: 'name', label: 'Name', placeholder: 'Production API', required: true },
          { key: 'id', label: 'Slug', placeholder: 'production-api', description: 'Lowercase letters, numbers, underscores, and hyphens.' },
        ],
        submitLabel: 'Create application',
        onSubmit: async values => {
          const result = await client.admin.apps.create({
            name: values.name.trim(),
            id: values.id.trim() || undefined,
          });
          setApps(current => [...current, result.app]);
          setAppId(result.app.id);
          setActiveTab('apps');
          refreshAll();
          notify('success', `Created application ${result.app.id}.`);
        },
      });
      return;
    }

    if (action === 'data.collection') {
      setForm({
        id: 'data-collection',
        title: 'Change data collection',
        description: 'Collections are created on the first document write.',
        fields: [{ key: 'collection', label: 'Collection', initialValue: dataCollection, required: true }],
        submitLabel: 'Open collection',
        onSubmit: async values => {
          const collection = validCollection(values.collection);
          setDataCollection(collection);
          setDataSearch('');
          setActiveTab('data');
          notify('success', `Opened collection ${collection}.`);
        },
      });
      return;
    }

    if (action === 'data.search') {
      setForm({
        id: 'data-search',
        title: 'Search documents',
        description: `Searches every indexed field in ${dataCollection}.`,
        fields: [{ key: 'query', label: 'Search query', initialValue: dataSearch, required: true }],
        submitLabel: 'Search',
        onSubmit: async values => {
          setDataSearch(values.query.trim());
          setActiveTab('data');
          notify('success', `Searching ${dataCollection}.`);
        },
      });
      return;
    }

    if (action === 'data.clear-search') {
      setDataSearch('');
      notify('success', 'Search cleared.');
      return;
    }

    if (action === 'data.create') {
      setForm({
        id: `create-document-${dataCollection}`,
        title: `Create document in ${dataCollection}`,
        description: 'Paste a JSON object. An optional id is accepted on create.',
        fields: [{ key: 'document', label: 'Document JSON', placeholder: '{"title":"Example"}', required: true }],
        submitLabel: 'Create document',
        onSubmit: async values => {
          await client.data.create(dataCollection, parseJsonObject(values.document, 'Document JSON'));
          setDataSearch('');
          refreshAll();
          notify('success', `Created document in ${dataCollection}.`);
        },
      });
      return;
    }

    if (action === 'data.edit') {
      if (!selectedDocument) {
        notify('error', 'Select a document before editing it.');
        return;
      }
      const selected = selectedDocument;
      setForm({
        id: `edit-document-${selected.id}`,
        title: `Edit document ${selected.id}`,
        description: 'Replace the complete document payload. System fields are managed by Uniflex.',
        fields: [
          {
            key: 'document',
            label: 'Document JSON',
            initialValue: JSON.stringify(documentPayload(selected), null, 2),
            required: true,
          },
        ],
        submitLabel: 'Save document',
        onSubmit: async values => {
          await client.data.update(dataCollection, selected.id, parseJsonObject(values.document, 'Document JSON'));
          refreshAll();
          notify('success', `Saved document ${selected.id}.`);
        },
      });
      return;
    }

    if (action === 'data.delete') {
      if (!selectedDocument) {
        notify('error', 'Select a document before deleting it.');
        return;
      }
      const selected = selectedDocument;
      setConfirmation({
        id: `delete-document-${selected.id}`,
        title: 'Delete document',
        detail: `This permanently deletes ${selected.id} from ${dataCollection}.`,
        confirmation: 'DELETE',
        confirmLabel: 'Delete document',
        onConfirm: async () => {
          await client.data.delete(dataCollection, selected.id);
          refreshAll();
          notify('success', `Deleted document ${selected.id}.`);
        },
      });
      return;
    }

    if (action === 'user.create') {
      setForm({
        id: 'create-user',
        title: 'Create user',
        description: `Registers a user in ${appId}. This does not change the dashboard session.`,
        fields: [
          { key: 'email', label: 'Email', placeholder: 'owner@example.com', required: true },
          { key: 'password', label: 'Password', secret: true, required: true },
          { key: 'role', label: 'Role', initialValue: 'user', description: 'Use user or admin.', required: true },
        ],
        submitLabel: 'Create user',
        onSubmit: async values => {
          const role = values.role.trim();
          if (role !== 'user' && role !== 'admin') throw new Error('Role must be user or admin.');
          const originalToken = client.token;
          try {
            await client.auth.signup({ email: values.email.trim(), password: values.password, role });
          } finally {
            client.setToken(originalToken);
          }
          refreshAll();
          notify('success', `Created user ${values.email.trim()}.`);
        },
      });
      return;
    }

    if (action === 'user.role') {
      if (!selectedUser) {
        notify('error', 'Select a user before changing their role.');
        return;
      }
      const selected = selectedUser;
      setForm({
        id: `user-role-${selected.id}`,
        title: `Change role for ${selected.email}`,
        fields: [{ key: 'role', label: 'Role', initialValue: selected.role, description: 'Use user or admin.', required: true }],
        submitLabel: 'Save role',
        onSubmit: async values => {
          const role = values.role.trim();
          if (role !== 'user' && role !== 'admin') throw new Error('Role must be user or admin.');
          await client.admin.users.update(selected.id, { role });
          refreshAll();
          notify('success', `Changed ${selected.email} to ${role}.`);
        },
      });
      return;
    }

    if (action === 'user.ban') {
      if (!selectedUser) {
        notify('error', 'Select a user before changing their access.');
        return;
      }
      const selected = selectedUser;
      const banning = !selected.banned;
      setConfirmation({
        id: `${banning ? 'ban' : 'unban'}-user-${selected.id}`,
        title: banning ? 'Ban user' : 'Unban user',
        detail: banning
          ? `${selected.email} will no longer be able to authenticate.`
          : `${selected.email} will be allowed to authenticate again.`,
        confirmation: banning ? 'BAN' : 'UNBAN',
        confirmLabel: banning ? 'Ban user' : 'Unban user',
        onConfirm: async () => {
          await client.admin.users.update(selected.id, { banned: banning });
          refreshAll();
          notify('success', `${banning ? 'Banned' : 'Unbanned'} ${selected.email}.`);
        },
      });
      return;
    }

    if (action === 'user.password') {
      if (!selectedUser) {
        notify('error', 'Select a user before resetting their password.');
        return;
      }
      const selected = selectedUser;
      setForm({
        id: `user-password-${selected.id}`,
        title: `Reset password for ${selected.email}`,
        fields: [{ key: 'password', label: 'New password', secret: true, required: true }],
        submitLabel: 'Reset password',
        onSubmit: async values => {
          await client.admin.users.update(selected.id, { password: values.password });
          notify('success', `Reset password for ${selected.email}.`);
        },
      });
      return;
    }

    if (action === 'storage.upload') {
      setForm({
        id: 'storage-upload',
        title: 'Upload local file',
        description: 'The path is resolved on the computer running this TUI. Files over 50 MiB are rejected by the server.',
        fields: [{ key: 'path', label: 'Local path', placeholder: 'C:\\path\\to\\file.png', required: true }],
        submitLabel: 'Upload file',
        onSubmit: async values => {
          const path = values.path.trim();
          const file = Bun.file(path);
          if (!(await file.exists())) throw new Error(`File not found: ${path}`);
          const filename = path.replace(/^.*[\\/]/, '');
          await client.storage.upload(file, filename);
          refreshAll();
          notify('success', `Uploaded ${filename}.`);
        },
      });
      return;
    }

    if (action === 'storage.download') {
      if (!selectedFile) {
        notify('error', 'Select a file before downloading it.');
        return;
      }
      const selected = selectedFile;
      setForm({
        id: `storage-download-${selected.id}`,
        title: `Download ${selected.filename}`,
        description: 'The destination is resolved on the computer running this TUI. Existing files are never overwritten.',
        fields: [{ key: 'destination', label: 'Destination path', initialValue: selected.filename, required: true }],
        submitLabel: 'Download file',
        onSubmit: async values => {
          const destination = values.destination.trim();
          if (await Bun.file(destination).exists()) throw new Error(`Destination already exists: ${destination}`);
          const response = await fetch(client.storage.getUrl(selected.id), {
            headers: { 'X-Uniflex-App-ID': client.appId },
          });
          if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
          await Bun.write(destination, await response.arrayBuffer());
          notify('success', `Downloaded ${selected.filename} to ${destination}.`);
        },
      });
      return;
    }

    if (action === 'storage.delete') {
      if (!selectedFile) {
        notify('error', 'Select a file before deleting it.');
        return;
      }
      const selected = selectedFile;
      setConfirmation({
        id: `delete-file-${selected.id}`,
        title: 'Delete file',
        detail: `This permanently deletes ${selected.filename} and its stored binary.`,
        confirmation: 'DELETE',
        confirmLabel: 'Delete file',
        onConfirm: async () => {
          await client.storage.deleteFile(selected.id);
          refreshAll();
          notify('success', `Deleted ${selected.filename}.`);
        },
      });
      return;
    }

    if (action === 'rules.edit') {
      notify('info', 'Loading current rules…');
      void client.admin.rules
        .get()
        .then(result => {
          const rules = result.rules[appId] ?? {};
          setForm({
            id: `edit-rules-${appId}`,
            title: `Edit rules for ${appId}`,
            description: 'Paste a JSON object mapping collection names to read/create/update/delete/write expressions.',
            fields: [{ key: 'rules', label: 'Rules JSON', initialValue: JSON.stringify(rules, null, 2), required: true }],
            submitLabel: 'Save rules',
            onSubmit: async values => {
              const rulesValue = parseJsonObject(values.rules, 'Rules JSON') as Record<string, Record<string, string>>;
              await client.admin.rules.update(rulesValue);
              refreshAll();
              notify('success', `Saved rules for ${appId}.`);
            },
          });
          setNotice(null);
        })
        .catch(reason => {
          notify('error', reason instanceof Error ? reason.message : String(reason));
        });
      return;
    }

    if (action === 'webhook.create') {
      setForm({
        id: 'create-webhook',
        title: 'Create webhook',
        description: 'Enter a comma-separated list of subscribed event names, such as data.create,data.update.',
        fields: [
          { key: 'url', label: 'URL', placeholder: 'https://example.com/uniflex-events', required: true },
          { key: 'events', label: 'Events', placeholder: 'data.create,data.update', required: true },
        ],
        submitLabel: 'Create webhook',
        onSubmit: async values => {
          const events = values.events
            .split(',')
            .map(event => event.trim())
            .filter(Boolean);
          if (events.length === 0) throw new Error('Provide at least one event name.');
          await client.admin.webhooks.create({ url: values.url.trim(), events });
          refreshAll();
          notify('success', 'Created webhook.');
        },
      });
      return;
    }

    if (action === 'webhook.delete') {
      if (!selectedWebhook) {
        notify('error', 'Select a webhook before deleting it.');
        return;
      }
      const selected = selectedWebhook;
      setConfirmation({
        id: `delete-webhook-${selected.id}`,
        title: 'Delete webhook',
        detail: `This stops delivery to ${selected.url}.`,
        confirmation: 'DELETE',
        confirmLabel: 'Delete webhook',
        onConfirm: async () => {
          await client.admin.webhooks.delete(selected.id);
          refreshAll();
          notify('success', 'Deleted webhook.');
        },
      });
      return;
    }

    if (action === 'realtime.collection') {
      setForm({
        id: 'realtime-collection',
        title: 'Change realtime filter',
        description: 'Use * for every collection, or a single collection name.',
        fields: [{ key: 'collection', label: 'Collection', initialValue: realtimeCollection, required: true }],
        submitLabel: 'Update stream',
        onSubmit: async values => {
          const collection = values.collection.trim();
          setRealtimeCollection(collection === '*' ? '*' : validCollection(collection));
          setRealtimeReset(current => current + 1);
          setActiveTab('realtime');
          notify('success', `Streaming ${collection}.`);
        },
      });
      return;
    }

    if (action === 'realtime.clear') {
      setRealtimeReset(current => current + 1);
      notify('success', 'Realtime feed cleared.');
      return;
    }

    if (action.startsWith('tab.')) {
      setActiveTab(action.slice('tab.'.length) as TabKey);
      return;
    }

    if (action === 'system.refresh') {
      refreshAll();
      notify('success', 'Refreshing server state.');
      return;
    }

    if (action === 'system.quit') {
      onExit?.();
      process.exit(0);
    }
  };

  useInput(
    (input, key) => {
      if ((key.ctrl && input === 'p') || input === '\x10') {
        setPaletteMode('commands');
        return;
      }
      if (input === 'q') {
        onExit?.();
        process.exit(0);
      }
      if (input === 'r') {
        refreshAll();
        return;
      }
      if (TABS.some(tab => tab.shortcut === input)) {
        const tab = TABS.find(item => item.shortcut === input);
        if (tab) setActiveTab(tab.key);
        return;
      }
      if (key.tab || key.rightArrow) {
        setActiveTab(current => {
          const currentIndex = TABS.findIndex(tab => tab.key === current);
          const direction = key.shift ? -1 : 1;
          return TABS[(currentIndex + direction + TABS.length) % TABS.length].key;
        });
      } else if (key.leftArrow) {
        setActiveTab(current => {
          const currentIndex = TABS.findIndex(tab => tab.key === current);
          return TABS[(currentIndex - 1 + TABS.length) % TABS.length].key;
        });
      }
    },
    { isActive: !overlayOpen }
  );

  const paletteItems = paletteMode === 'apps'
    ? apps.map(app => ({
        id: app.id,
        label: app.id === appId ? `${app.name} [active]` : app.name,
        detail: app.id,
      }))
    : commandItems;

  const paletteTitle = paletteMode === 'apps' ? 'Switch application' : 'Command palette';
  const noticeColor: Record<NoticeKind, 'green' | 'red' | 'yellow'> = {
    error: 'red',
    info: 'yellow',
    success: 'green',
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box width="100%">
        <Text bold color="cyan">UNIFLEX / ADMIN</Text>
        <Text>  </Text>
        <Text color={health === 'online' ? 'green' : health === 'offline' ? 'red' : 'yellow'}>
          {health === 'online' ? 'ONLINE' : health === 'offline' ? 'OFFLINE' : 'CHECKING'}
        </Text>
      </Box>
      <Text dimColor>
        {client.endpoint} · App <Text color="green" bold>{appId}</Text> · {activeTabLabel}
      </Text>
      <Box marginTop={1} width="100%">
        {TABS.map(tab => {
          const active = tab.key === activeTab;
          return (
            <Box key={tab.key} marginRight={1}>
              <Text bold={active} color={active ? 'cyan' : 'gray'}>
                {active ? `[${tab.shortcut} ${tab.label}]` : `${tab.shortcut} ${tab.label}`}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1} width="100%">
        {notice && <Text color={noticeColor[notice.kind]}>{notice.message}</Text>}
        {appsError && <Text color="red">Apps: {appsError}</Text>}
        {!client.adminKey && <Text color="yellow">Admin key missing — protected operations will be rejected.</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1} width="100%">
        {paletteMode && (
          <CommandPalette
            isOpen
            title={paletteTitle}
            items={paletteItems}
            onClose={() => setPaletteMode(null)}
            onSelect={id => {
              if (paletteMode === 'apps') {
                setAppId(id);
                setPaletteMode(null);
                notify('success', `Switched to ${id}.`);
              } else {
                runAction(id);
              }
            }}
          />
        )}
        {form && (
          <FormDialog
            key={form.id}
            title={form.title}
            description={form.description}
            fields={form.fields}
            submitLabel={form.submitLabel}
            onSubmit={form.onSubmit}
            onComplete={() => setForm(null)}
            onCancel={() => setForm(null)}
          />
        )}
        {confirmation && (
          <ConfirmDialog
            key={confirmation.id}
            title={confirmation.title}
            detail={confirmation.detail}
            confirmation={confirmation.confirmation}
            confirmLabel={confirmation.confirmLabel}
            onConfirm={confirmation.onConfirm}
            onComplete={() => setConfirmation(null)}
            onCancel={() => setConfirmation(null)}
          />
        )}
        {!overlayOpen && activeTab === 'apps' && (
          <AppsPanel
            activeAppId={appId}
            apps={apps}
            error={appsError}
            loading={appsLoading}
            inputActive
            onAction={runAction}
            onSelectApp={setAppId}
          />
        )}
        {!overlayOpen && activeTab === 'data' && (
          <DataPanel
            appId={appId}
            collection={dataCollection}
            query={dataSearch}
            refresh={refresh}
            inputActive
            onAction={runAction}
            onSelectionChange={setSelectedDocument}
          />
        )}
        {!overlayOpen && activeTab === 'users' && (
          <UsersPanel
            appId={appId}
            refresh={refresh}
            inputActive
            onAction={runAction}
            onSelectionChange={setSelectedUser}
          />
        )}
        {!overlayOpen && activeTab === 'storage' && (
          <StoragePanel
            appId={appId}
            refresh={refresh}
            inputActive
            onAction={runAction}
            onSelectionChange={setSelectedFile}
          />
        )}
        {!overlayOpen && activeTab === 'rules' && <RulesPanel appId={appId} refresh={refresh} inputActive onAction={runAction} />}
        {!overlayOpen && activeTab === 'webhooks' && (
          <WebhooksPanel
            appId={appId}
            refresh={refresh}
            inputActive
            onAction={runAction}
            onSelectionChange={setSelectedWebhook}
          />
        )}
        {!overlayOpen && activeTab === 'realtime' && (
          <RealtimePanel
            appId={appId}
            collection={realtimeCollection}
            reset={realtimeReset}
            inputActive
            onAction={runAction}
          />
        )}
      </Box>

      <Box marginTop={1} width="100%">
        <Text dimColor>[Ctrl+P] Commands · [Tab/←→] Tabs · [r] Refresh · [q] Quit</Text>
      </Box>
    </Box>
  );
}

export function App({ client, initialAppId, onExit }: AppProps) {
  return (
    <UniflexProvider client={client}>
      <MainDashboard client={client} initialAppId={initialAppId} onExit={onExit} />
    </UniflexProvider>
  );
}
