import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useUniflexClient } from 'uniflex-sdk/react';
import type { User } from 'uniflex-sdk';
import type { PanelProps } from './DataPanel';

const PAGE_SIZE = 25;

export function UsersPanel({ appId, refresh }: PanelProps) {
  const client = useUniflexClient();
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    const offset = (page - 1) * PAGE_SIZE;
    client.admin.users
      .list(appId, { limit: PAGE_SIZE, offset })
      .then(res => {
        if (!cancelled) {
          setUsers(res.users);
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
  }, [client, appId, refresh, page]);

  useInput((input) => {
    if (input === 'n') {
      if (users.length === PAGE_SIZE) {
        setPage(p => p + 1);
      }
    } else if (input === 'p') {
      setPage(p => Math.max(1, p - 1));
    }
  });

  if (loading && users.length === 0) {
    return <Text color="yellow">Loading users for tenant "{appId}"...</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error}</Text>}
      <Box width="100%" justifyContent="space-between">
        <Text bold color="cyan">
          USERS (Page {page} · {users.length} items on page)
        </Text>
        <Text dimColor>[n] Next Page | [p] Prev Page</Text>
      </Box>
      {users.length === 0 ? (
        <Text dimColor>No registered users found for tenant "{appId}" on page {page}.</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          <Box width="100%">
            <Box width={36}><Text bold color="yellow">ID</Text></Box>
            <Box width={24}><Text bold color="yellow">EMAIL</Text></Box>
            <Box width={12}><Text bold color="yellow">ROLE</Text></Box>
            <Box width={10}><Text bold color="yellow">STATUS</Text></Box>
            <Box width={24}><Text bold color="yellow">CREATED AT</Text></Box>
          </Box>
          {users.map(u => (
            <Box key={u.id} width="100%">
              <Box width={36}><Text>{u.id}</Text></Box>
              <Box width={24}><Text>{u.email}</Text></Box>
              <Box width={12}><Text>{u.role}</Text></Box>
              <Box width={10}>
                {u.banned ? (
                  <Text color="red" bold>Banned</Text>
                ) : (
                  <Text color="green">Active</Text>
                )}
              </Box>
              <Box width={24}><Text>{u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}</Text></Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
