import type { Database } from 'bun:sqlite';
import crypto from 'node:crypto';
import { getTenantCache } from './cache';

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
  const cache = getTenantCache(db);

  function dispatchWebhooks(evt: UniflexEvent) {
    const hooks = cache.getWebhooks(evt.appId);
    if (hooks.length === 0) return;

    const matching = hooks.filter((h) => h.events.has(evt.event));
    if (matching.length === 0) return;

    const payload = JSON.stringify(evt);
    const delays = [1000, 5000, 25000];
    const secretKey = cache.getAppById(evt.appId)?.apiKey || 'uniflex';
    const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');

    for (const hook of matching) {
      const attemptDelivery = async (attempt: number) => {
        try {
          const res = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Uniflex-Webhook/0.1.0',
              'X-Uniflex-Event': evt.event,
              'X-Uniflex-Signature': `sha256=${signature}`,
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
            console.error('Webhook delivery failed:', hook.url, err);
          }
        }
      };

      attemptDelivery(0);
    }
  }

  return {
    emit(evt: UniflexEvent) {
      for (const listener of realtimeListeners) {
        try {
          listener(evt);
        } catch (err) {
          console.error('Realtime listener error:', err);
        }
      }
      dispatchWebhooks(evt);
    },
    onRealtime(fn: (evt: UniflexEvent) => void) {
      realtimeListeners.push(fn);
    },
  };
}
