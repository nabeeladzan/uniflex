import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { UniflexClient } from './client';
import type { DocumentItem, RealtimeEvent, ListOptions } from './types';

// React Context for UniflexClient
const UniflexContext = createContext<UniflexClient | null>(null);

export interface UniflexProviderProps {
  client: UniflexClient;
  children: React.ReactNode;
}

export function UniflexProvider({ client, children }: UniflexProviderProps) {
  return <UniflexContext.Provider value={client}>{children}</UniflexContext.Provider>;
}

export function useUniflexClient(): UniflexClient {
  const client = useContext(UniflexContext);
  if (!client) {
    throw new Error('useUniflexClient must be used within a <UniflexProvider>');
  }
  return client;
}

/**
 * Hook to subscribe to real-time events on a collection
 */
export function useRealtime(
  collectionName: string,
  clientOverride?: UniflexClient
): RealtimeEvent | null {
  const contextClient = useContext(UniflexContext);
  const client = clientOverride || contextClient;

  if (!client) {
    throw new Error('useRealtime requires a UniflexClient via UniflexProvider or client parameter');
  }

  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  useEffect(() => {
    const unsubscribe = client.data.subscribe(collectionName, (event) => {
      setLastEvent(event);
    });

    return () => {
      unsubscribe();
    };
  }, [client, collectionName]);

  return lastEvent;
}

/**
 * Hook to fetch a collection and keep it in sync with real-time updates (with 50ms event batching)
 */
export function useCollection<T = Record<string, unknown>>(
  collectionName: string,
  options?: ListOptions,
  clientOverride?: UniflexClient
) {
  const contextClient = useContext(UniflexContext);
  const client = clientOverride || contextClient;

  if (!client) {
    throw new Error('useCollection requires a UniflexClient via UniflexProvider or client parameter');
  }

  const [data, setData] = useState<DocumentItem<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCollection = useCallback(() => {
    client.data
      .list<T>(collectionName, options)
      .then((res) => {
        setData(res.data);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [client, collectionName, options?.limit, options?.offset]);

  const pendingEvents = useRef<RealtimeEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchCollection();

    const processBatch = () => {
      if (pendingEvents.current.length === 0) return;
      const batch = [...pendingEvents.current];
      pendingEvents.current = [];

      let needsRefetch = false;
      const updatesMap = new Map<string, Record<string, unknown>>();
      const deletesSet = new Set<string>();

      for (const evt of batch) {
        if (evt.action === 'create') {
          needsRefetch = true;
        } else if (evt.action === 'update') {
          updatesMap.set(evt.data.id, evt.data.data || {});
        } else if (evt.action === 'delete') {
          deletesSet.add(evt.data.id);
        }
      }

      if (needsRefetch) {
        fetchCollection();
      } else {
        setData((prev) =>
          prev
            .filter((doc) => !deletesSet.has(doc.id))
            .map((doc) => {
              const updatedFields = updatesMap.get(doc.id);
              return updatedFields ? { ...doc, ...(updatedFields as T) } : doc;
            })
        );
      }
    };

    const unsubscribe = client.data.subscribe(collectionName, (evt) => {
      pendingEvents.current.push(evt);
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          processBatch();
        }, 50);
      }
    });

    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      unsubscribe();
    };
  }, [client, collectionName, fetchCollection]);

  return { data, loading, error, refetch: fetchCollection };
}
