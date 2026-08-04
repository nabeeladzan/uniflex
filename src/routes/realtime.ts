import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import type { Database } from 'bun:sqlite';
import type { EventBus, UniflexEvent } from '../lib/events';
import { err } from '../lib/errors';

interface ClientSocket {
  ws: WSContext;
  topics: Set<string>;
}

const connectionRegistry = new Map<string, Set<ClientSocket>>();

export function registerRealtimeRoutes(app: Hono, db: Database, bus: EventBus) {
  bus.onRealtime((evt: UniflexEvent) => {
    if (evt.event !== 'data.create' && evt.event !== 'data.update' && evt.event !== 'data.delete') {
      return;
    }

    const sockets = connectionRegistry.get(evt.appId);
    if (!sockets || sockets.size === 0) return;

    const action = evt.event === 'data.create' ? 'create' : evt.event === 'data.update' ? 'update' : 'delete';
    const evtData = evt.data as { collection: string; id: string; data?: Record<string, unknown> };
    if (!evtData || !evtData.collection || !evtData.id) return;

    const collection = evtData.collection;
    const docId = evtData.id;
    const topicCol = collection;
    const topicDoc = `${collection}:${docId}`;

    let payloadData: Record<string, unknown>;
    if (action === 'delete') {
      payloadData = { id: docId };
    } else {
      payloadData = {
        id: docId,
        ...(evtData.data || {}),
        _createdAt: evt.timestamp,
        _updatedAt: evt.timestamp,
      };
    }

    const frameStr = JSON.stringify({
      type: 'event',
      collection,
      action,
      data: payloadData,
    });

    for (const client of sockets) {
      if (client.topics.has(topicCol) || client.topics.has(topicDoc) || client.topics.has('*')) {
        try {
          client.ws.send(frameStr);
        } catch (err) {
          console.error('WebSocket send error:', err);
        }
      }
    }
  });

  // Validate appId in route middleware before upgradeWebSocket
  app.get('/v1/realtime', async (c, next) => {
    const appId = c.req.query('appId');
    if (!appId) {
      return err(c, 400, 'Query parameter appId is required');
    }

    const appRow = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
    if (!appRow) {
      return err(c, 401, 'Invalid or missing app context');
    }

    await next();
  });

  app.get(
    '/v1/realtime',
    upgradeWebSocket((c) => {
      const appId = c.req.query('appId')!;
      let clientRef: ClientSocket | null = null;

      return {
        onOpen(_event, ws) {
          clientRef = {
            ws,
            topics: new Set<string>(),
          };
          let sockets = connectionRegistry.get(appId);
          if (!sockets) {
            sockets = new Set();
            connectionRegistry.set(appId, sockets);
          }
          sockets.add(clientRef);
        },

        onMessage(event, ws) {
          if (!clientRef) return;
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(String(event.data));
          } catch {
            ws.send(JSON.stringify({ type: 'error', error: 'Malformed frame' }));
            return;
          }

          if (typeof frame !== 'object' || !frame || typeof frame.type !== 'string') {
            ws.send(JSON.stringify({ type: 'error', error: 'Malformed frame' }));
            return;
          }

          if (frame.type === 'subscribe') {
            if (typeof frame.collection === 'string') {
              const topicKey = typeof frame.id === 'string' && frame.id ? `${frame.collection}:${frame.id}` : frame.collection;
              clientRef.topics.add(topicKey);
            }
          } else if (frame.type === 'unsubscribe') {
            if (typeof frame.collection === 'string') {
              const topicKey = typeof frame.id === 'string' && frame.id ? `${frame.collection}:${frame.id}` : frame.collection;
              clientRef.topics.delete(topicKey);
            }
          } else {
            ws.send(JSON.stringify({ type: 'error', error: 'Unknown frame type' }));
          }
        },

        onClose() {
          if (clientRef) {
            const sockets = connectionRegistry.get(appId);
            if (sockets) {
              sockets.delete(clientRef);
            }
          }
        },

        onError() {
          if (clientRef) {
            const sockets = connectionRegistry.get(appId);
            if (sockets) {
              sockets.delete(clientRef);
            }
          }
        },
      };
    })
  );
}
