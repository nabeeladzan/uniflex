import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useUniflexClient } from 'uniflex-sdk/react';
import type { FileMeta } from 'uniflex-sdk';
import type { PanelProps } from './DataPanel';

const PAGE_SIZE = 25;

export function StoragePanel({ appId, refresh }: PanelProps) {
  const client = useUniflexClient();
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    const offset = (page - 1) * PAGE_SIZE;
    client.storage
      .listFiles({ limit: PAGE_SIZE, offset })
      .then(res => {
        if (!cancelled) {
          setFiles(res.files);
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
      if (files.length === PAGE_SIZE) {
        setPage(p => p + 1);
      }
    } else if (input === 'p') {
      setPage(p => Math.max(1, p - 1));
    }
  });

  if (loading && files.length === 0) {
    return <Text color="yellow">Loading storage files for tenant "{appId}"...</Text>;
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
  };

  return (
    <Box flexDirection="column" width="100%">
      {error && <Text color="red">Error: {error}</Text>}
      <Box width="100%" justifyContent="space-between">
        <Text bold color="cyan">
          STORAGE FILES (Page {page} · {files.length} items on page)
        </Text>
        <Text dimColor>[n] Next Page | [p] Prev Page</Text>
      </Box>
      {files.length === 0 ? (
        <Text dimColor>No files stored for tenant "{appId}" on page {page}.</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          <Box width="100%">
            <Box width={20}><Text bold color="yellow">ID</Text></Box>
            <Box width={24}><Text bold color="yellow">FILENAME</Text></Box>
            <Box width={18}><Text bold color="yellow">MIME TYPE</Text></Box>
            <Box width={12}><Text bold color="yellow">SIZE</Text></Box>
            <Box width={24}><Text bold color="yellow">CREATED AT</Text></Box>
          </Box>
          {files.map(f => (
            <Box key={f.id} width="100%">
              <Box width={20}><Text>{f.id}</Text></Box>
              <Box width={24}><Text>{f.filename}</Text></Box>
              <Box width={18}><Text>{f.mimeType}</Text></Box>
              <Box width={12}><Text>{formatSize(f.size)}</Text></Box>
              <Box width={24}><Text>{new Date(f.createdAt).toLocaleString()}</Text></Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
