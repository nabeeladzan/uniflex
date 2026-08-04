import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DocumentItem } from 'uniflex-sdk';
import { useUniflexClient } from 'uniflex-sdk/react';
import { documentPayload, formatDate, truncate } from './format';

type RecordDocument = DocumentItem<Record<string, unknown>>;

interface DataPanelProps {
  appId: string;
  collection: string;
  query: string;
  refresh: number;
  inputActive: boolean;
  onAction: (action: string) => void;
  onSelectionChange: (document: RecordDocument | undefined) => void;
}

const PAGE_SIZE = 20;

export function DataPanel({
  appId,
  collection,
  query,
  refresh,
  inputActive,
  onAction,
  onSelectionChange,
}: DataPanelProps) {
  const client = useUniflexClient();
  const [documents, setDocuments] = useState<RecordDocument[]>([]);
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setCursors([undefined]);
    setNextCursor(undefined);
    setSelectedIndex(0);
    onSelectionChange(undefined);
  }, [appId, collection, query, onSelectionChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (query) {
          const result = await client.data.search<Record<string, unknown>>(collection, query, {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          });
          if (cancelled) return;
          setDocuments(result.data);
          setNextCursor(undefined);
          setHasNextPage(result.data.length === PAGE_SIZE);
        } else {
          const result = await client.data.list<Record<string, unknown>>(collection, {
            limit: PAGE_SIZE,
            starting_after: cursors[page],
          });
          if (cancelled) return;
          setDocuments(result.data);
          setNextCursor(result.nextCursor ?? undefined);
          setHasNextPage(Boolean(result.nextCursor));
        }
        setSelectedIndex(0);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setDocuments([]);
          setNextCursor(undefined);
          setHasNextPage(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, collection, cursors, page, query, refresh]);

  useEffect(() => {
    onSelectionChange(documents[selectedIndex]);
  }, [documents, onSelectionChange, selectedIndex]);

  const goNext = () => {
    if (!hasNextPage) return;
    if (query) {
      setPage(current => current + 1);
      return;
    }
    if (!nextCursor) return;
    setCursors(current => [...current.slice(0, page + 1), nextCursor]);
    setPage(current => current + 1);
  };

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex(current => Math.min(current + 1, Math.max(0, documents.length - 1)));
      } else if (key.upArrow) {
        setSelectedIndex(current => Math.max(0, current - 1));
      } else if (input === 'n') {
        goNext();
      } else if (input === 'p' && page > 0) {
        setPage(current => current - 1);
      } else if (input === 'a') {
        onAction('data.create');
      } else if (input === 'e') {
        onAction('data.edit');
      } else if (input === 'd') {
        onAction('data.delete');
      } else if (input === '/') {
        onAction('data.search');
      } else if (input === 'x' && query) {
        onAction('data.clear-search');
      } else if (input === 'c') {
        onAction('data.collection');
      }
    },
    { isActive: inputActive }
  );

  const selected = documents[selectedIndex];
  const pageLabel = query ? `search page ${page + 1}` : `cursor page ${page + 1}`;

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="cyan">DATA / {collection}</Text>
        <Text dimColor>{pageLabel} · {documents.length} records</Text>
      </Box>
      {query && <Text color="yellow">Search: {query}</Text>}
      {error && <Text color="red">{error}</Text>}
      {loading && documents.length === 0 ? (
        <Text color="yellow">Loading {collection}…</Text>
      ) : documents.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{query ? 'No documents match this search.' : `No documents in ${collection}.`}</Text>
          <Text dimColor>Press a to create one, or c to switch collections.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} width="100%">
          {documents.map((document, index) => {
            const selectedRow = index === selectedIndex;
            const title = typeof document.title === 'string' ? document.title : document.id;
            const preview = truncate(JSON.stringify(documentPayload(document)), 110);
            return (
              <Box flexDirection="column" key={document.id} marginBottom={1}>
                <Text bold={selectedRow} color={selectedRow ? 'cyan' : undefined}>
                  {selectedRow ? '> ' : '  '}
                  {truncate(String(title), 72)}
                </Text>
                <Text dimColor>
                  {document.id} · {formatDate(document._updatedAt)} · {preview}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {selected && (
        <Box borderStyle="single" borderColor="gray" flexDirection="column" marginTop={1} paddingX={1} width="100%">
          <Text bold>Selected document</Text>
          <Text>{JSON.stringify(selected, null, 2)}</Text>
        </Box>
      )}
      <Text dimColor>
        [↑↓] Select · [a] Add · [e] Edit · [d] Delete · [/] Search · [x] Clear · [c] Collection · [n/p] Pages
      </Text>
    </Box>
  );
}
