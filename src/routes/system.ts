import { Hono } from 'hono';
import type { UniflexConfig } from '../config';

export function registerSystemRoutes(app: Hono, _config: UniflexConfig) {
  // GET /
  app.get('/', (c) => {
    return c.json({
      name: 'Uniflex BaaS Server',
      version: '0.1.0',
      status: 'online',
      documentation: '/v1/admin/apps',
    });
  });

  // GET /health
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });
}
