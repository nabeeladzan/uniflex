import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { appContext } from '../lib/tenant';

const APP_ID_RE = /^[a-z0-9_-]{1,64}$/;

export function registerAdminRoutes(app: Hono, db: Database, config: UniflexConfig, _bus: EventBus) {
  // All admin routes require admin authorization
  app.use('/v1/admin/*', async (c, next) => {
    const provided = c.req.header('X-Uniflex-Admin-Key');
    if (config.server.adminKey && provided === config.server.adminKey) {
      await next();
      return;
    }
    return err(c, 401, 'Admin authorization required');
  });

  // App-scoped admin routes require app context header
  app.use('/v1/admin/webhooks*', appContext(db));
  app.use('/v1/admin/rules', async (c, next) => {
    if (c.req.method === 'PUT') {
      return appContext(db)(c, next);
    }
    return next();
  });

  // POST /v1/admin/apps
  app.post('/v1/admin/apps', async (c) => {
    let body: { name?: string; id?: string };
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      return err(c, 400, 'Field "name" is required and must be a non-empty string');
    }

    let appId: string;
    if (body.id !== undefined) {
      if (typeof body.id !== 'string' || !APP_ID_RE.test(body.id)) {
        return err(c, 400, 'Field "id" must be a lowercase slug (letters, numbers, hyphens, underscores)');
      }
      appId = body.id;
    } else {
      appId = crypto.randomUUID();
    }

    const existing = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
    if (existing) {
      return err(c, 409, 'Application id already exists');
    }

    const apiKey = `uniflex_key_${crypto.randomUUID().replace(/-/g, '')}`;
    const createdAt = new Date().toISOString();

    db.prepare('INSERT INTO apps (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
      appId,
      body.name.trim(),
      apiKey,
      createdAt
    );

    return c.json(
      {
        message: 'Application registered successfully',
        app: {
          id: appId,
          name: body.name.trim(),
          apiKey,
          createdAt,
        },
      },
      201
    );
  });

  // GET /v1/admin/apps
  app.get('/v1/admin/apps', (c) => {
    const rows = db.prepare('SELECT id, name, api_key, created_at FROM apps ORDER BY created_at ASC').all() as Array<{
      id: string;
      name: string;
      api_key: string;
      created_at: string;
    }>;

    const apps = rows.map((r) => ({
      id: r.id,
      name: r.name,
      apiKey: r.api_key,
      createdAt: r.created_at,
    }));

    return c.json({ count: apps.length, apps });
  });

  // GET /v1/admin/rules
  app.get('/v1/admin/rules', (c) => {
    const rows = db.prepare('SELECT app_id, rules FROM rules').all() as Array<{ app_id: string; rules: string }>;
    const rulesMap: Record<string, Record<string, Record<string, string>>> = {};

    for (const r of rows) {
      try {
        rulesMap[r.app_id] = JSON.parse(r.rules);
      } catch {}
    }

    return c.json({ rules: rulesMap });
  });

  // PUT /v1/admin/rules
  app.put('/v1/admin/rules', async (c) => {
    const appId = c.get('appId') || c.req.header('X-Uniflex-App-ID');
    if (!appId) {
      return err(c, 401, 'Invalid or missing app context');
    }

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return err(c, 400, 'Body must be a JSON object mapping collection names to rule definitions');
    }

    const rulesPayload =
      rawBody.rules && typeof rawBody.rules === 'object' && !Array.isArray(rawBody.rules)
        ? (rawBody.rules as Record<string, unknown>)
        : rawBody;

    for (const [col, colRules] of Object.entries(rulesPayload)) {
      if (!APP_ID_RE.test(col)) {
        return err(c, 400, `Invalid collection name in rules: "${col}"`);
      }
      if (typeof colRules !== 'object' || colRules === null || Array.isArray(colRules)) {
        return err(c, 400, `Rules for collection "${col}" must be an object`);
      }

      for (const [op, expr] of Object.entries(colRules as Record<string, unknown>)) {
        if (!['read', 'create', 'update', 'delete', 'write'].includes(op)) {
          return err(c, 400, `Invalid operation "${op}" in rules for collection "${col}"`);
        }
        if (typeof expr !== 'string') {
          return err(c, 400, `Rule expression for "${col}.${op}" must be a string`);
        }
      }
    }

    const jsonStr = JSON.stringify(rulesPayload);
    const existing = db.prepare('SELECT app_id FROM rules WHERE app_id = ?').get(appId);

    if (existing) {
      db.prepare('UPDATE rules SET rules = ? WHERE app_id = ?').run(jsonStr, appId);
    } else {
      db.prepare('INSERT INTO rules (app_id, rules) VALUES (?, ?)').run(appId, jsonStr);
    }

    return c.json({
      message: 'Rules updated successfully',
      rules: rulesPayload,
    });
  });

  // POST /v1/admin/webhooks
  app.post('/v1/admin/webhooks', async (c) => {
    const appId = c.get('appId') || c.req.header('X-Uniflex-App-ID');
    if (!appId) {
      return err(c, 401, 'Invalid or missing app context');
    }

    let body: { url?: string; events?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (!body || typeof body.url !== 'string' || !body.url.trim()) {
      return err(c, 400, 'Field "url" is required');
    }

    try {
      const parsedUrl = new URL(body.url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return err(c, 400, 'Webhook URL must use http or https protocol');
      }
    } catch {
      return err(c, 400, 'Invalid webhook URL format');
    }

    if (!Array.isArray(body.events) || body.events.length === 0) {
      return err(c, 400, 'Field "events" must be a non-empty array of event names');
    }

    for (const evt of body.events) {
      if (typeof evt !== 'string' || !evt.trim()) {
        return err(c, 400, 'All items in "events" array must be non-empty strings');
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const eventsStr = JSON.stringify(body.events);

    db.prepare('INSERT INTO webhooks (id, app_id, url, events, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      appId,
      body.url.trim(),
      eventsStr,
      createdAt
    );

    return c.json(
      {
        id,
        url: body.url.trim(),
        events: body.events,
        createdAt,
      },
      201
    );
  });

  // GET /v1/admin/webhooks
  app.get('/v1/admin/webhooks', (c) => {
    const appIdHeader = c.get('appId') || c.req.header('X-Uniflex-App-ID');
    if (!appIdHeader) {
      return err(c, 401, 'Invalid or missing app context');
    }

    const rows = db
      .prepare('SELECT id, url, events, created_at FROM webhooks WHERE app_id = ? ORDER BY created_at ASC')
      .all(appIdHeader) as Array<{ id: string; url: string; events: string; created_at: string }>;

    const webhooks = rows.map((r) => {
      let events: string[] = [];
      try {
        events = JSON.parse(r.events);
      } catch {}
      return {
        id: r.id,
        url: r.url,
        events,
        createdAt: r.created_at,
      };
    });

    return c.json({ count: webhooks.length, webhooks });
  });

  // DELETE /v1/admin/webhooks/:id
  app.delete('/v1/admin/webhooks/:id', (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id);
    if (!existing) {
      return err(c, 404, 'Webhook not found');
    }

    db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);

    return c.json({
      message: 'Webhook deleted successfully',
      id,
    });
  });

  // GET /v1/admin/apps/:appId/users
  app.get('/v1/admin/apps/:appId/users', (c) => {
    const appIdParam = c.req.param('appId');
    const appRow = db.prepare('SELECT id FROM apps WHERE id = ?').get(appIdParam);
    if (!appRow) {
      return err(c, 404, 'Application not found');
    }

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    let rows: Array<{ id: string; email: string; role: string; app_id: string; banned: number; created_at: string }>;

    if (limitParam || offsetParam) {
      const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
      const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
      rows = db
        .prepare(
          'SELECT id, email, role, app_id, banned, created_at FROM users WHERE app_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
        )
        .all(appIdParam, limit, offset) as typeof rows;
    } else {
      rows = db
        .prepare('SELECT id, email, role, app_id, banned, created_at FROM users WHERE app_id = ? ORDER BY created_at ASC')
        .all(appIdParam) as typeof rows;
    }

    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      appId: r.app_id,
      banned: !!r.banned,
      createdAt: r.created_at,
    }));

    return c.json({ count: users.length, users });
  });

  // PATCH /v1/admin/users/:id
  app.patch('/v1/admin/users/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id, email, role, app_id, banned, created_at FROM users WHERE id = ?').get(id) as
      | { id: string; email: string; role: string; app_id: string; banned: number; created_at: string }
      | undefined;

    if (!existing) {
      return err(c, 404, 'User not found');
    }

    let body: { role?: string; banned?: boolean; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (!body || typeof body !== 'object') {
      return err(c, 400, 'Invalid JSON body');
    }

    let newRole = existing.role;
    let newBanned = existing.banned;

    if (body.role !== undefined) {
      if (typeof body.role !== 'string' || !['user', 'admin'].includes(body.role)) {
        return err(c, 400, 'Role must be "user" or "admin"');
      }
      newRole = body.role;
    }

    if (body.banned !== undefined) {
      if (typeof body.banned !== 'boolean') {
        return err(c, 400, 'Field "banned" must be a boolean');
      }
      newBanned = body.banned ? 1 : 0;
    }

    if (body.password !== undefined) {
      if (typeof body.password !== 'string' || body.password.length < 6) {
        return err(c, 400, 'Password must be at least 6 characters');
      }
      const newHash = await Bun.password.hash(body.password, { algorithm: 'bcrypt', cost: 10 });
      db.prepare('UPDATE users SET role = ?, banned = ?, password_hash = ? WHERE id = ?').run(
        newRole,
        newBanned,
        newHash,
        id
      );
    } else {
      db.prepare('UPDATE users SET role = ?, banned = ? WHERE id = ?').run(newRole, newBanned, id);
    }

    return c.json({
      message: 'User updated',
      user: {
        id: existing.id,
        email: existing.email,
        role: newRole,
        appId: existing.app_id,
        banned: !!newBanned,
        createdAt: existing.created_at,
      },
    });
  });
}
