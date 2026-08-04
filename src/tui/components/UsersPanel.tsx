import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { User } from 'uniflex-sdk';
import { useUniflexClient } from 'uniflex-sdk/react';
import { formatDate, truncate } from './format';

interface UsersPanelProps {
  appId: string;
  refresh: number;
  inputActive: boolean;
  onAction: (action: string) => void;
  onSelectionChange: (user: User | undefined) => void;
}

const PAGE_SIZE = 20;

export function UsersPanel({ appId, refresh, inputActive, onAction, onSelectionChange }: UsersPanelProps) {
  const client = useUniflexClient();
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setSelectedIndex(0);
    onSelectionChange(undefined);
  }, [appId, onSelectionChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client.admin.users
      .list(appId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(result => {
        if (cancelled) return;
        setUsers(result.users);
        setHasNextPage(result.users.length === PAGE_SIZE);
        setSelectedIndex(0);
      })
      .catch(reason => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setUsers([]);
          setHasNextPage(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, client, page, refresh]);

  useEffect(() => {
    onSelectionChange(users[selectedIndex]);
  }, [onSelectionChange, selectedIndex, users]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex(current => Math.min(current + 1, Math.max(0, users.length - 1)));
      } else if (key.upArrow) {
        setSelectedIndex(current => Math.max(0, current - 1));
      } else if (input === 'n' && hasNextPage) {
        setPage(current => current + 1);
      } else if (input === 'p' && page > 0) {
        setPage(current => current - 1);
      } else if (input === 'a') {
        onAction('user.create');
      } else if (input === 'e') {
        onAction('user.role');
      } else if (input === 'b') {
        onAction('user.ban');
      } else if (input === 'w') {
        onAction('user.password');
      }
    },
    { isActive: inputActive }
  );

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">USERS / {appId}</Text>
        <Text dimColor>page {page + 1} · {users.length} users</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      {loading && users.length === 0 ? (
        <Text color="yellow">Loading users…</Text>
      ) : users.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>No users registered for this application.</Text>
          <Text dimColor>Press a to create one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {users.map((user, index) => {
            const selected = index === selectedIndex;
            return (
              <Box flexDirection="column" key={user.id} marginBottom={1}>
                <Box width="100%">
                  <Text bold={selected} color={selected ? 'cyan' : undefined}>
                    {selected ? '> ' : '  '}
                    {truncate(user.email, 64)}
                  </Text>
                  <Text color={user.banned ? 'red' : 'green'}>{user.banned ? '  BANNED' : '  ACTIVE'}</Text>
                  <Text dimColor> · {user.role}</Text>
                </Box>
                <Text dimColor>{user.id} · created {formatDate(user.createdAt)}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Text dimColor>[↑↓] Select · [a] Add · [e] Role · [b] Ban/Unban · [w] Password · [n/p] Pages</Text>
    </Box>
  );
}
