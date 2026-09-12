import type { Context, Next } from 'hono';
import type { Database } from 'bun:sqlite';
import { err } from './errors';

declare module 'hono' {
  interface ContextVariableMap {
    appId: string;
  }
}

export function appContext(db: Database) {
  return async (c: Context, next: Next) => {
    const appIdHeader = c.req.header('X-Uniflex-App-ID') || c.req.query('appId');
    const apiKeyHeader = c.req.header('X-Uniflex-API-Key') || c.req.query('apiKey');

    let resolvedAppId: string | null = null;

    if (appIdHeader) {
      const appRow = db.prepare('SELECT id FROM apps WHERE id = ?').get(appIdHeader) as { id: string } | undefined;
      if (appRow) {
        resolvedAppId = appRow.id;
      }
    } else if (apiKeyHeader) {
      const appRow = db.prepare('SELECT id FROM apps WHERE api_key = ?').get(apiKeyHeader) as { id: string } | undefined;
      if (appRow) {
        resolvedAppId = appRow.id;
      }
    }

    if (!resolvedAppId) {
      return err(c, 401, 'Invalid or missing app context');
    }

    c.set('appId', resolvedAppId);
    await next();
  };
}
