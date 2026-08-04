import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useCollection } from '@uniflex/sdk/react';

export interface PanelProps {
  appId: string;
  refresh?: number;
  onSelectApp?: (appId: string) => void;
  onAppsLoaded?: (apps: any[]) => void;
}

const PAGE_SIZE = 25;

export function DataPanel({ appId }: PanelProps) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [appId]);

  const offset = (page - 1) * PAGE_SIZE;
  const { data, loading, error } = useCollection('products', { limit: PAGE_SIZE, offset });

  useInput((input) => {
    if (input === 'n') {
      if (data.length === PAGE_SIZE) {
        setPage(p => p + 1);
      }
    } else if (input === 'p') {
      setPage(p => Math.max(1, p - 1));
    }
  });

  if (loading && data.length === 0) {
    return <Text color="yellow">Loading collection "products"...</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error.message}</Text>}
      <Box width="100%" justifyContent="space-between">
        <Text bold color="cyan">
          COLLECTION "products" (Page {page} · {data.length} items on page)
        </Text>
        <Text dimColor>[n] Next Page | [p] Prev Page</Text>
      </Box>
      {data.length === 0 ? (
        <Text dimColor>Collection "products" has no records on page {page}.</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          {data.map((item, idx) => (
            <Box key={item.id ?? String(idx)} flexDirection="column" width="100%">
              <Text bold color="green">
                [{item.id}] <Text dimColor>{JSON.stringify(item)}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
