import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { assertRule } from '../lib/rules';
import { appContext } from '../lib/tenant';
import { resolveAuthUser } from '../lib/authz';

const COLLECTION_RE = /^[a-z0-9_-]{1,64}$/;
const EPHEMERAL_TTL_MS = 60_000;
const EPHEMERAL_MAX_PER_BUCKET = 200;

interface EphemeralEntry {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

/**
 * Prevents recursive `.data.data...` bloat when clients round-trip POST/PUT response envelopes
 * (`{ ...doc, ...putResponse }`) back into POST/PUT.
 */
export function sanitizeIncomingDocPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  const nested = out.data;

  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedObj = nested as Record<string, unknown>;
    const nestedKeys = Object.keys(nestedObj).filter((k) => k !== 'data');

    const isEnvelopeWithCollection =
      typeof out.collection === 'string' &&
      Object.keys(out).every((k) => k === 'id' || k === 'collection' || k === 'data');

    const isSpreadSelfCopy =
      nestedKeys.length >= 2 && nestedKeys.every((k) => k in out);

    if (isEnvelopeWithCollection) {
      const unwrapped = sanitizeIncomingDocPayload(nestedObj);
      if ('id' in out) {
        return { id: out.id, ...unwrapped };
      }
      return unwrapped;
    }

    if (isSpreadSelfCopy) {
      delete out.data;
      if (typeof out.collection === 'string' && !('collection' in nestedObj)) {
        delete out.collection;
      }
    }
  }

  return out;
}

export function registerDataRoutes(app: Hono, db: Database, config: UniflexConfig, bus: EventBus) {
  const ephemeralSet = new Set(config.database.ephemeralCollections ?? []);
  const ephemeralBuckets = new Map<string, Map<string, EphemeralEntry>>();

  function getEphemeralBucket(appId: string, collection: string): Map<string, EphemeralEntry> {
    const key = `${appId}:${collection}`;
    let bucket = ephemeralBuckets.get(key);
    if (!bucket) {
      bucket = new Map();
      ephemeralBuckets.set(key, bucket);
    }
    const now = Date.now();
    for (const [id, entry] of bucket.entries()) {
      if (entry.expiresAt <= now) {
        bucket.delete(id);
      }
    }
    return bucket;
  }

  function isFtsEnabledFor(collection: string): boolean {
    const fts = config.database.fts ?? true;
    if (fts === false) return false;
    if (fts === true) return true;
    return fts.includes(collection);
  }

  app.use('/v1/data/*', appContext(db));
  app.use(
    '/v1/data/*',
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (c) => err(c, 413, 'Payload too large'),
    })
  );

  // POST /v1/data/:collection
  app.post('/v1/data/:collection', async (c) => {
    const appId = c.get('appId');
    const collection = c.req.param('collection');

    if (!COLLECTION_RE.test(collection)) {
      return err(c, 400, 'Invalid collection name');
    }

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
      if ('_createdAt' in rawBody) return err(c, 400, 'Reserved field: _createdAt');
      if ('_updatedAt' in rawBody) return err(c, 400, 'Reserved field: _updatedAt');
    } else {
      return err(c, 400, 'Invalid JSON body');
    }

    const body = sanitizeIncomingDocPayload(rawBody);
    const isEphemeral = ephemeralSet.has(collection);

    let docId: string;
    const dataPayload = { ...body };

    if ('id' in body) {
      if (typeof body.id !== 'string' || !body.id || body.id.length > 128) {
        return err(c, 400, 'Invalid id field');
      }
      docId = body.id;
      delete dataPayload.id;

      if (isEphemeral) {
        if (getEphemeralBucket(appId, collection).has(docId)) {
          return err(c, 409, 'Document with this id already exists');
        }
      } else {
        const existing = db
          .query('SELECT id FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
          .get(appId, collection, docId);
        if (existing) {
          return err(c, 409, 'Document with this id already exists');
        }
      }
    } else {
      docId = crypto.randomUUID();
    }

    const ctx = { user, doc: dataPayload, request: dataPayload };
    if (!assertRule(db, appId, collection, 'create', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const now = new Date().toISOString();

    if (isEphemeral) {
      const bucket = getEphemeralBucket(appId, collection);
      if (bucket.size >= EPHEMERAL_MAX_PER_BUCKET) {
        const oldestKey = bucket.keys().next().value;
        if (oldestKey) bucket.delete(oldestKey);
      }
      bucket.set(docId, {
        id: docId,
        collection,
        data: dataPayload,
        createdAt: now,
        updatedAt: now,
        expiresAt: Date.now() + EPHEMERAL_TTL_MS,
      });
    } else {
      db.query(
        'INSERT INTO documents (id, app_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(docId, appId, collection, JSON.stringify(dataPayload), now, now);
    }

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

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    const ctx = { user, doc: null, request: null };
    if (!assertRule(db, appId, collection, 'read', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    if (ephemeralSet.has(collection)) {
      const term = q.trim().toLowerCase();
      const bucket = getEphemeralBucket(appId, collection);
      const matches = Array.from(bucket.values())
        .filter((e) => JSON.stringify(e.data).toLowerCase().includes(term))
        .map((e) => ({
          id: e.id,
          ...e.data,
          _createdAt: e.createdAt,
          _updatedAt: e.updatedAt,
        }));
      return c.json({ collection, query: q, count: matches.length, data: matches });
    }

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    let rows: Array<{ id: string; collection: string; data: string; created_at: string; updated_at: string }> = [];

    const runLikeSearch = () => {
      const likeTerm = `%${q.trim()}%`;
      if (limitParam || offsetParam) {
        const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
        const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
        return db
          .query('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND data LIKE ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
          .all(appId, collection, likeTerm, limit, offset) as typeof rows;
      }
      return db
        .query('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND data LIKE ? ORDER BY created_at ASC')
        .all(appId, collection, likeTerm) as typeof rows;
    };

    if (isFtsEnabledFor(collection)) {
      const cleaned = q.replace(/[^\w\s]/g, ' ').trim();
      if (!cleaned) {
        return c.json({ collection, query: q, count: 0, data: [] });
      }
      const ftsQuery = cleaned.split(/\s+/).map((w) => `"${w}"*`).join(' AND ');

      try {
        if (limitParam || offsetParam) {
          const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
          const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
          rows = db
            .query(`
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
            .query(`
              SELECT d.id, d.collection, d.data, d.created_at, d.updated_at
              FROM documents_fts fts
              JOIN documents d ON d.id = fts.id AND d.app_id = fts.app_id AND d.collection = fts.collection
              WHERE fts.app_id = ? AND fts.collection = ? AND documents_fts MATCH ?
              ORDER BY d.created_at ASC
            `)
            .all(appId, collection, ftsQuery) as typeof rows;
        }
      } catch {
        rows = runLikeSearch();
      }
    } else {
      rows = runLikeSearch();
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

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    const ctx = { user, doc: null, request: null };
    if (!assertRule(db, appId, collection, 'read', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const startingAfter = c.req.query('starting_after');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);

    if (ephemeralSet.has(collection)) {
      const all = Array.from(getEphemeralBucket(appId, collection).values());
      const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
      const sliced = limitParam || offsetParam ? all.slice(offset, offset + limit) : all;
      const data = sliced.map((e) => ({
        id: e.id,
        ...e.data,
        _createdAt: e.createdAt,
        _updatedAt: e.updatedAt,
      }));
      return c.json({ collection, count: data.length, data, nextCursor: null });
    }

    let rows: Array<{ id: string; collection: string; data: string; created_at: string; updated_at: string }>;

    if (startingAfter) {
      const cursorRow = db
        .query('SELECT created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
        .get(appId, collection, startingAfter) as { created_at: string } | null;

      if (cursorRow) {
        rows = db
          .query(
            'SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT ?'
          )
          .all(appId, collection, cursorRow.created_at, cursorRow.created_at, startingAfter, limit) as typeof rows;
      } else {
        rows = [];
      }
    } else if (limitParam || offsetParam) {
      const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
      rows = db
        .query('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
        .all(appId, collection, limit, offset) as typeof rows;
    } else {
      rows = db
        .query('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? ORDER BY created_at ASC')
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

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    if (ephemeralSet.has(collection)) {
      const entry = getEphemeralBucket(appId, collection).get(id);
      if (!entry) return err(c, 404, 'Document not found');
      const docObj = { id: entry.id, ...entry.data, _createdAt: entry.createdAt, _updatedAt: entry.updatedAt };
      if (!assertRule(db, appId, collection, 'read', { user, doc: docObj, request: null })) {
        return err(c, 403, 'Access denied by security rules');
      }
      return c.json(docObj);
    }

    const row = db
      .query('SELECT id, collection, data, created_at, updated_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; collection: string; data: string; created_at: string; updated_at: string } | null;

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

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
      if ('id' in rawBody) return err(c, 400, 'Reserved field: id');
      if ('_createdAt' in rawBody) return err(c, 400, 'Reserved field: _createdAt');
      if ('_updatedAt' in rawBody) return err(c, 400, 'Reserved field: _updatedAt');
    } else {
      return err(c, 400, 'Invalid JSON body');
    }

    const body = sanitizeIncomingDocPayload(rawBody);

    if (ephemeralSet.has(collection)) {
      const bucket = getEphemeralBucket(appId, collection);
      const entry = bucket.get(id);
      if (!entry) return err(c, 404, 'Document not found');
      const ctx = { user, doc: { id: entry.id, ...entry.data, _createdAt: entry.createdAt }, request: body };
      if (!assertRule(db, appId, collection, 'update', ctx)) {
        return err(c, 403, 'Access denied by security rules');
      }
      const now = new Date().toISOString();
      const mergedData = { ...entry.data, ...body };
      entry.data = mergedData;
      entry.updatedAt = now;
      entry.expiresAt = Date.now() + EPHEMERAL_TTL_MS;
      const docObj = { id, collection, data: mergedData, _updatedAt: now };
      bus.emit({ event: 'data.update', appId, timestamp: now, data: docObj });
      return c.json(docObj);
    }

    const existing = db
      .query('SELECT id, data, created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; data: string; created_at: string } | null;

    if (!existing) {
      return err(c, 404, 'Document not found');
    }

    let existingDoc: Record<string, unknown> = {};
    try {
      existingDoc = JSON.parse(existing.data);
    } catch {}

    const ctx = { user, doc: { id: existing.id, ...existingDoc, _createdAt: existing.created_at }, request: body };
    if (!assertRule(db, appId, collection, 'update', ctx)) {
      return err(c, 403, 'Access denied by security rules');
    }

    const now = new Date().toISOString();
    const mergedData = sanitizeIncomingDocPayload({ ...existingDoc, ...body });
    db.query(
      'UPDATE documents SET data = ?, updated_at = ? WHERE app_id = ? AND collection = ? AND id = ?'
    ).run(JSON.stringify(mergedData), now, appId, collection, id);

    const docObj = {
      id,
      collection,
      data: mergedData,
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

    const { user, response } = await resolveAuthUser(c, config, db);
    if (response) return response;

    if (ephemeralSet.has(collection)) {
      const bucket = getEphemeralBucket(appId, collection);
      const entry = bucket.get(id);
      if (!entry) return err(c, 404, 'Document not found');
      const ctx = { user, doc: { id: entry.id, ...entry.data, _createdAt: entry.createdAt }, request: null };
      if (!assertRule(db, appId, collection, 'delete', ctx)) {
        return err(c, 403, 'Access denied by security rules');
      }
      bucket.delete(id);
      const now = new Date().toISOString();
      bus.emit({ event: 'data.delete', appId, timestamp: now, data: { id, collection } });
      return c.json({ message: 'Document deleted successfully', id });
    }

    const existing = db
      .query('SELECT id, data, created_at FROM documents WHERE app_id = ? AND collection = ? AND id = ?')
      .get(appId, collection, id) as { id: string; data: string; created_at: string } | null;

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

    db.query('DELETE FROM documents WHERE app_id = ? AND collection = ? AND id = ?').run(appId, collection, id);

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
