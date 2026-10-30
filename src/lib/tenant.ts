import type { Context, Next } from 'hono';
import type { Database } from 'bun:sqlite';
import { err } from './errors';
import { getTenantCache } from './cache';

declare module 'hono' {
  interface ContextVariableMap {
    appId: string;
  }
}

export function appContext(db: Database) {
  const cache = getTenantCache(db);

  return async (c: Context, next: Next) => {
    const appIdHeader = c.req.header('X-Uniflex-App-ID') || c.req.query('appId');
    const apiKeyHeader = c.req.header('X-Uniflex-API-Key') || c.req.query('apiKey');

    let resolvedAppId: string | null = null;

    if (appIdHeader) {
      const app = cache.getAppById(appIdHeader);
      if (app) {
        resolvedAppId = app.id;
      }
    } else if (apiKeyHeader) {
      const appId = cache.getAppIdByApiKey(apiKeyHeader);
      if (appId) {
        resolvedAppId = appId;
      }
    }

    if (!resolvedAppId) {
      return err(c, 401, 'Invalid or missing app context');
    }

    c.set('appId', resolvedAppId);
    await next();
  };
}
