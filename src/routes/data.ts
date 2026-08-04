import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { assertRule } from '../lib/rules';
import { appContext } from '../lib/tenant';
import { resolveAuthUser } from '../lib/authz';

const COLLECTION_RE = /^[a-z0-9_-]{1,64}$/;

export function registerDataRoutes(app: Hono, db: Database, config: UniflexConfig, bus: EventBus) {
  app.use('/v1/data/*', appContext(db));

  // POST /v1/data/:collection
  app.post('/v1/data/:collection', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (body && typeof body === 'object') {
      if ('_createdAt' in body) return err(c, 400, 'Reserved field: _createdAt');
      if ('_updatedAt' in body) return err(c, 400, 'Reserved field: _updatedAt');
    } else {
      return err(c, 400, 'Invalid JSON body');
    }

    let docId: string;
    let dataPayload = { ...body };

    if ('id' in body) {
      if (typeof body.id !== 'string' || !body.id || body.id.length > 128) {
        return err(c, 400, 'Invalid id field');
      }
      docId = body.id;
      delete dataPayload.id;

      const existing = db
        .prepare('SELECT id FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
        .get(appId, collection, docId);
      if (existing) {
        return err(c, 409, 'Document with this id already exists');
      }
    } else {
      docId = crypto.randomUUID();
    }

    const ctx = { user, doc: dataPayload, request: dataPayload };
    if (!assertRule(db, appId, collection, 'create', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO documents (id, app_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(docId, appId, collection, JSON.stringify(dataPayload), now, now);

    const docObj = {
      id: docId,
      collection,
      data: dataPayload,
      _createdAt: now,
      _updatedAt: now,
    };

    bus.emit({
      event: 'data.create',
      appId,
      timestamp: now,
      data: docObj,
    });

    return c.json(docObj, 201);
  });

  // GET /v1/data/:collection/search
  app.get('/v1/data/:collection/search', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');
    const q = c.req.query('q');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }
    if (!q || !q.trim()) {
      return err(c, 400, 'Query parameter q is required');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    const ctx = { user, doc: null, request: null };
    if (!assertRule(db, appId, collection, 'read', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const sanitizeFtsQuery = (term: string) => {
      const cleaned = term.replace(/[^\w\s]/g, ' ').trim();
      if (!cleaned) return '';
      return cleaned.split(/\s+/).map((w) => `"${w}"*`).join(' AND ');
    };

    const ftsQuery = sanitizeFtsQuery(q);
    if (!ftsQuery) {
      return c.json({ collection, query: q, count: 0, data: [] });
    }

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    let rows: Array<{ id: string; collection: string; data: string; created_at: string; updated_at: string }> = [];

    try {
      if (limitParam || offsetParam) {
        const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
        const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
        rows = db
          .prepare(`
            SELECT d.id, d.collection, d.data, d.created_at, d.updated_at
            FROM documents_fts fts
            JOIN documents d ON d.id = fts.id AND d.app_id = fts.app_id AND d.collection = fts.collection
            WHERE fts.app_id = ? AND fts.collection = ? AND documents_fts MATCH ?
            ORDER BY d.created_at ASC
            LIMIT ? OFFSET ?
          `)
          .all(appId, collection, ftsQuery, limit, offset) as typeof rows;
      } else {
        rows = db
          .prepare(`
            SELECT d.id, d.collection, d.data, d.created_at, d.updated_at
            FROM documents_fts fts
            JOIN documents d ON d.id = fts.id AND d.app_id = fts.app_id AND d.collection = fts.collection
            WHERE fts.app_id = ? AND fts.collection = ? AND documents_fts MATCH ?
            ORDER BY d.created_at ASC
          `)
          .all(appId, collection, ftsQuery) as typeof rows;
      }
    } catch {
      // Fallback if FTS5 virtual table is not present
      const likeTerm = `%${q.trim()}%`;
      if (limitParam || offsetParam) {
        const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
        const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
        rows = db
          .prepare('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND data LIKE ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
          .all(appId, collection, likeTerm, limit, offset) as typeof rows;
      } else {
        rows = db
          .prepare('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND data LIKE ? ORDER BY created_at ASC')
          .all(appId, collection, likeTerm) as typeof rows;
      }
    }

    const resultData = rows.map((r) => {
      let parsed = {};
      try {
        parsed = JSON.parse(r.data);
      } catch {}
      return {
        id: r.id,
        ...parsed,
        _createdAt: r.created_at,
        _updatedAt: r.updated_at,
      };
    });

    return c.json({
      collection,
      query: q,
      count: resultData.length,
      data: resultData,
    });
  });

  // GET /v1/data/:collection
  app.get('/v1/data/:collection', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    const ctx = { user, doc: null, request: null };
    if (!assertRule(db, appId, collection, 'read', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const startingAfter = c.req.query('starting_after');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);

    let rows: Array<{ id: string; collection: string; data: string; created_at: string; updated_at: string }>;

    if (startingAfter) {
      const cursorRow = db
        .prepare('SELECT created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
        .get(appId, collection, startingAfter) as { created_at: string } | undefined;

      if (cursorRow) {
        rows = db
          .prepare(
            'SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT ?'
          )
          .all(appId, collection, cursorRow.created_at, cursorRow.created_at, startingAfter, limit) as typeof rows;
      } else {
        rows = [];
      }
    } else if (limitParam || offsetParam) {
      const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
      rows = db
        .prepare('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
        .all(appId, collection, limit, offset) as typeof rows;
    } else {
      rows = db
        .prepare('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? ORDER BY created_at ASC')
        .all(appId, collection) as typeof rows;
    }

    const resultData = rows.map((r) => {
      let parsed = {};
      try {
        parsed = JSON.parse(r.data);
      } catch {}
      return {
        id: r.id,
        ...parsed,
        _createdAt: r.created_at,
        _updatedAt: r.updated_at,
      };
    });

    const nextCursor = (startingAfter || limitParam) && resultData.length === limit && resultData.length > 0 ? resultData[resultData.length - 1].id : null;

    return c.json({
      collection,
      count: resultData.length,
      data: resultData,
      nextCursor,
    });
  });

  // GET /v1/data/:collection/:id
  app.get('/v1/data/:collection/:id', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');
    const id = c.req.param('id');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    const row = db
      .prepare('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; collection: string; data: string; created_at: string; updated_at: string } | undefined;

    if (!row) {
      return err(c, 404, 'Document not found');
    }

    let parsed = {};
    try {
      parsed = JSON.parse(row.data);
    } catch {}

    const docObj = {
      id: row.id,
      ...parsed,
      _createdAt: row.created_at,
      _updatedAt: row.updated_at,
    };

    const ctx = { user, doc: docObj, request: null };
    if (!assertRule(db, appId, collection, 'read', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    return c.json(docObj);
  });

  // PUT /v1/data/:collection/:id
  app.put('/v1/data/:collection/:id', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');
    const id = c.req.param('id');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (body && typeof body === 'object') {
      if ('id' in body) return err(c, 400, 'Reserved field: id');
      if ('_createdAt' in body) return err(c, 400, 'Reserved field: _createdAt');
      if ('_updatedAt' in body) return err(c, 400, 'Reserved field: _updatedAt');
    } else {
      return err(c, 400, 'Invalid JSON body');
    }

    const existing = db
      .prepare('SELECT id, data, created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; data: string; created_at: string } | undefined;

    if (!existing) {
      return err(c, 404, 'Document not found');
    }

    let existingDoc = {};
    try {
      existingDoc = JSON.parse(existing.data);
    } catch {}

    const ctx = { user, doc: { id: existing.id, ...existingDoc, _createdAt: existing.created_at }, request: body };
    if (!assertRule(db, appId, collection, 'update', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE documents SET data = ?, updated_at = ? WHERE app_id = ? AND collection = ? AND id = ?'
    ).run(JSON.stringify(body), now, appId, collection, id);

    const docObj = {
      id,
      collection,
      data: body,
      _updatedAt: now,
    };

    bus.emit({
      event: 'data.update',
      appId,
      timestamp: now,
      data: docObj,
    });

    return c.json(docObj);
  });

  // DELETE /v1/data/:collection/:id
  app.delete('/v1/data/:collection/:id', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');
    const id = c.req.param('id');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config);
    if (response) return response;

    const existing = db
      .prepare('SELECT id, data, created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; data: string; created_at: string } | undefined;

    if (!existing) {
      return err(c, 404, 'Document not found');
    }

    let existingDoc = {};
    try {
      existingDoc = JSON.parse(existing.data);
    } catch {}

    const ctx = { user, doc: { id: existing.id, ...existingDoc, _createdAt: existing.created_at }, request: null };
    if (!assertRule(db, appId, collection, 'delete', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    db.prepare('DELETE FROM documents WHERE app_id = ? AND collection = ? AND id = ?').run(appId, collection, id);

    const now = new Date().toISOString();
    bus.emit({
      event: 'data.delete',
      appId,
      timestamp: now,
      data: { id, collection },
    });

    return c.json({
      message: 'Document deleted successfully',
      id,
    });
  });
}
