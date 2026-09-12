import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from '../config';
import type { EventBus, UniflexEvent } from '../lib/events';
import { verifyToken } from '../lib/authn';
import { assertRule, type RuleUserContext } from '../lib/rules';
import { err } from '../lib/errors';

interface ClientSocket {
  ws: WSContext;
  topics: Set<string>;
  user: RuleUserContext;
  isAdmin: boolean;
}

const connectionRegistry = new Map<string, Set<ClientSocket>>();

async function resolveSocketUser(
  config: UniflexConfig,
  db: Database,
  appId: string,
  token?: string,
  adminKey?: string
): Promise<{ user: RuleUserContext; isAdmin: boolean }> {
  if (config.server.adminKey && adminKey && adminKey === config.server.adminKey) {
    return {
      user: { id: 'admin', email: 'admin@uniflex.local', role: 'admin' },
      isAdmin: true,
    };
  }

  if (token) {
    const payload = await verifyToken(config.server.secret, token);
    if (payload && payload.appId === appId) {
      if (payload.sub) {
        const userRow = db
          .prepare('SELECT banned FROM users WHERE app_id = ? AND id = ?')
          .get(appId, payload.sub) as { banned: number } | undefined;
        if (!userRow || userRow.banned !== 1) {
          return {
            user: { id: payload.sub, email: payload.email, role: payload.role },
            isAdmin: payload.role === 'admin',
          };
        }
      }
    }
  }

  return {
    user: { id: null, email: null, role: null },
    isAdmin: false,
  };
}

export function registerRealtimeRoutes(app: Hono, db: Database, config: UniflexConfig, bus: EventBus) {
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
        // Enforce security rule on broadcast
        const ctx = { user: client.user, doc: payloadData, request: null };
        if (client.isAdmin || assertRule(db, evt.appId, collection, 'read', ctx)) {
          try {
            client.ws.send(frameStr);
          } catch (err) {
            console.error('WebSocket send error:', err);
          }
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
      const token = c.req.query('token');
      const adminKey = c.req.query('adminKey');
      let clientRef: ClientSocket | null = null;

      return {
        onOpen(_event, ws) {
          // Initialize clientRef immediately to prevent race conditions with fast message frames
          clientRef = {
            ws,
            topics: new Set<string>(),
            user: { id: null, email: null, role: null },
            isAdmin: false,
          };
          let sockets = connectionRegistry.get(appId);
          if (!sockets) {
            sockets = new Set();
            connectionRegistry.set(appId, sockets);
          }
          sockets.add(clientRef);

          if (token || adminKey) {
            resolveSocketUser(config, db, appId, token, adminKey).then((authResult) => {
              if (clientRef) {
                clientRef.user = authResult.user;
                clientRef.isAdmin = authResult.isAdmin;
              }
            });
          }
        },

        async onMessage(event, ws) {
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

          if (frame.type === 'auth') {
            const frameToken = typeof frame.token === 'string' ? frame.token : undefined;
            const frameAdminKey = typeof frame.adminKey === 'string' ? frame.adminKey : undefined;
            const authResult = await resolveSocketUser(config, db, appId, frameToken, frameAdminKey);
            clientRef.user = authResult.user;
            clientRef.isAdmin = authResult.isAdmin;
            ws.send(JSON.stringify({ type: 'authenticated', user: clientRef.user }));
            return;
          }

          if (frame.type === 'subscribe') {
            if (typeof frame.collection === 'string') {
              const col = frame.collection;
              if (col === '*') {
                if (!clientRef.isAdmin) {
                  ws.send(JSON.stringify({ type: 'error', error: 'Wildcard subscription requires admin authorization' }));
                  return;
                }
              } else {
                const ctx = { user: clientRef.user, doc: null, request: null };
                const allowed = clientRef.isAdmin || assertRule(db, appId, col, 'read', ctx);
                if (!allowed) {
                  ws.send(JSON.stringify({ type: 'error', error: `Subscription denied by security rules for collection "${col}"` }));
                  return;
                }
              }
              const topicKey = typeof frame.id === 'string' && frame.id ? `${col}:${frame.id}` : col;
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
              if (sockets.size === 0) {
                connectionRegistry.delete(appId);
              }
            }
          }
        },

        onError() {
          if (clientRef) {
            const sockets = connectionRegistry.get(appId);
            if (sockets) {
              sockets.delete(clientRef);
              if (sockets.size === 0) {
                connectionRegistry.delete(appId);
              }
            }
          }
        },
      };
    })
  );
}
