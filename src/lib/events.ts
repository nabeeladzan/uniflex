import type { Database } from 'bun:sqlite';

export type UniflexEventType = 'user.signup' | 'data.create' | 'data.update' | 'data.delete' | 'storage.upload';

export interface UniflexEvent {
  event: UniflexEventType;
  appId: string;
  timestamp: string;
  data: unknown;
}

export interface EventBus {
  emit(evt: UniflexEvent): void;
  onRealtime(fn: (evt: UniflexEvent) => void): void;
}

export function createEventBus(db: Database): EventBus {
  const realtimeListeners: Array<(evt: UniflexEvent) => void> = [];

  function dispatchWebhooks(evt: UniflexEvent) {
    try {
      const stmt = db.prepare('SELECT url, events FROM webhooks WHERE app_id = ?');
      const rows = stmt.all(evt.appId) as Array<{ url: string; events: string }>;
      for (const row of rows) {
        let eventsList: string[] = [];
        try {
          eventsList = JSON.parse(row.events);
        } catch {
          continue;
        }
        if (!Array.isArray(eventsList) || !eventsList.includes(evt.event)) {
          continue;
        }
        
        // Fire-and-forget delivery with retries
        const payload = JSON.stringify(evt);
        const delays = [1000, 5000, 25000];
        
        async function attemptDelivery(attempt: number) {
          try {
            const res = await fetch(row.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Uniflex-Webhook/0.1.0',
              },
              body: payload,
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok && attempt < delays.length) {
              setTimeout(() => attemptDelivery(attempt + 1), delays[attempt]);
            }
          } catch (err) {
            if (attempt < delays.length) {
              setTimeout(() => attemptDelivery(attempt + 1), delays[attempt]);
            } else {
              console.error('Webhook delivery failed:', row.url, err);
            }
          }
        }
        
        attemptDelivery(0);
      }
    } catch (err) {
      console.error('Webhook query error:', err);
    }
  }

  return {
    emit(evt: UniflexEvent) {
      // (a) Synchronous broadcast to realtime listeners
      for (const listener of realtimeListeners) {
        try {
          listener(evt);
        } catch (err) {
          console.error('Realtime listener error:', err);
        }
      }
      // (b) Fire-and-forget webhook dispatch
      dispatchWebhooks(evt);
    },
    onRealtime(fn: (evt: UniflexEvent) => void) {
      realtimeListeners.push(fn);
    },
  };
}
