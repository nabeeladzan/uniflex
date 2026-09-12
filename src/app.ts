import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from './config';
import { initDb } from './db';
import { createEventBus, type EventBus } from './lib/events';
import { registerSystemRoutes } from './routes/system';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerDataRoutes } from './routes/data';
import { registerRealtimeRoutes } from './routes/realtime';
import { registerStorageRoutes } from './routes/storage';

export function createApp(config: UniflexConfig, dbOverride?: Database): { app: Hono; db: Database; bus: EventBus } {
  const app = new Hono();
  const db = initDb(dbOverride ?? config.database.path);
  const bus = createEventBus(db);

  app.use('*', cors());

  registerSystemRoutes(app, config);
  registerAdminRoutes(app, db, config, bus);
  registerAuthRoutes(app, db, config, bus);
  registerDataRoutes(app, db, config, bus);
  registerRealtimeRoutes(app, db, config, bus);
  registerStorageRoutes(app, db, config, bus);

  return { app, db, bus };
}
