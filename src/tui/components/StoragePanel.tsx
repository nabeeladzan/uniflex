import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FileMeta } from 'uniflex-sdk';
import { useUniflexClient } from 'uniflex-sdk/react';
import { formatBytes, formatDate, truncate } from './format';

interface StoragePanelProps {
  appId: string;
  refresh: number;
  inputActive: boolean;
  onAction: (action: string) => void;
  onSelectionChange: (file: FileMeta | undefined) => void;
}

const PAGE_SIZE = 20;

export function StoragePanel({ appId, refresh, inputActive, onAction, onSelectionChange }: StoragePanelProps) {
  const client = useUniflexClient();
  const [files, setFiles] = useState<FileMeta[]>([]);
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
    client.storage
      .listFiles({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(result => {
        if (cancelled) return;
        setFiles(result.files);
        setHasNextPage(result.files.length === PAGE_SIZE);
        setSelectedIndex(0);
      })
      .catch(reason => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setFiles([]);
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
    onSelectionChange(files[selectedIndex]);
  }, [files, onSelectionChange, selectedIndex]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex(current => Math.min(current + 1, Math.max(0, files.length - 1)));
      } else if (key.upArrow) {
        setSelectedIndex(current => Math.max(0, current - 1));
      } else if (input === 'n' && hasNextPage) {
        setPage(current => current + 1);
      } else if (input === 'p' && page > 0) {
        setPage(current => current - 1);
      } else if (input === 'a') {
        onAction('storage.upload');
      } else if (input === 'o') {
        onAction('storage.download');
      } else if (input === 'd') {
        onAction('storage.delete');
      }
    },
    { isActive: inputActive }
  );

  const selected = files[selectedIndex];

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">STORAGE / {appId}</Text>
        <Text dimColor>page {page + 1} · {files.length} files</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      {loading && files.length === 0 ? (
        <Text color="yellow">Loading files…</Text>
      ) : files.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>No files stored for this application.</Text>
          <Text dimColor>Press a to upload a local file.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {files.map((file, index) => {
            const selectedRow = index === selectedIndex;
            return (
              <Box flexDirection="column" key={file.id} marginBottom={1}>
                <Text bold={selectedRow} color={selectedRow ? 'cyan' : undefined}>
                  {selectedRow ? '> ' : '  '}
                  {truncate(file.filename, 72)}
                </Text>
                <Text dimColor>
                  {file.id} · {file.mimeType} · {formatBytes(file.size)} · {formatDate(file.createdAt)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {selected && (
        <Box borderStyle="single" borderColor="gray" flexDirection="column" marginTop={1} paddingX={1} width="100%">
          <Text bold>Selected file</Text>
          <Text>{selected.filename} · {formatBytes(selected.size)}</Text>
          <Text dimColor>{client.storage.getUrl(selected.id)}</Text>
        </Box>
      )}
      <Text dimColor>[↑↓] Select · [a] Upload · [o] Download · [d] Delete · [n/p] Pages</Text>
    </Box>
  );
}
