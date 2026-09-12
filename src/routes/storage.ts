import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { appContext } from '../lib/tenant';

export function registerStorageRoutes(app: Hono, db: Database, config: UniflexConfig, bus: EventBus) {
  app.use('/v1/storage/*', appContext(db));

  app.use(
    '/v1/storage/upload',
    bodyLimit({
      maxSize: 50 * 1024 * 1024,
      onError: (c) => err(c, 413, 'File too large'),
    })
  );

  // POST /v1/storage/upload
  app.post('/v1/storage/upload', async (c) => {
    const appId = c.get('appId');

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return err(c, 400, 'Invalid form data');
    }

    const file = body['file'];
    if (!file || !(file instanceof File)) {
      return err(c, 400, 'File field "file" is required');
    }

    const fileId = `file_${crypto.randomUUID().replace(/-/g, '')}`;
    const filename = file.name || 'unnamed_file';
    const mimeType = file.type || 'application/octet-stream';
    const size = file.size;

    const storageDir = path.resolve(config.storage.dir);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const ext = path.extname(filename);
    const diskFilename = `${fileId}${ext}`;
    const diskPath = path.join(storageDir, diskFilename);

    const buffer = await file.arrayBuffer();
    fs.writeFileSync(diskPath, Buffer.from(buffer));

    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO files (id, app_id, filename, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      fileId,
      appId,
      filename,
      mimeType,
      size,
      createdAt
    );

    const fileObj = {
      id: fileId,
      filename,
      mimeType,
      size,
      url: `/v1/storage/raw/${fileId}`,
      createdAt,
    };

    bus.emit({
      event: 'storage.upload',
      appId,
      timestamp: createdAt,
      data: fileObj,
    });

    return c.json(fileObj, 201);
  });

  // GET /v1/storage/raw/:id
  app.get('/v1/storage/raw/:id', async (c) => {
    const appId = c.get('appId');
    const id = c.req.param('id');

    const row = db.prepare('SELECT id, mime_type, filename FROM files WHERE app_id = ? AND id = ?').get(appId, id) as {
      id: string;
      mime_type: string;
      filename: string;
    } | undefined;

    if (!row) {
      return err(c, 404, 'File not found');
    }

    const storageDir = path.resolve(config.storage.dir);
    const ext = path.extname(row.filename);
    const filePath = path.join(storageDir, `${row.id}${ext}`);

    if (!fs.existsSync(filePath)) {
      return err(c, 404, 'File payload not found on disk');
    }

    const widthStr = c.req.query('w');
    const heightStr = c.req.query('h');
    const fit = c.req.query('fit');
    const format = c.req.query('format');

    const width = widthStr ? parseInt(widthStr, 10) : undefined;
    const height = heightStr ? parseInt(heightStr, 10) : undefined;

    if ((widthStr && (isNaN(width!) || width! <= 0)) || (heightStr && (isNaN(height!) || height! <= 0))) {
      return err(c, 400, 'Invalid width or height transform parameters');
    }

    const isImage = row.mime_type.startsWith('image/');
    const needsTransform = isImage && (width || height || format);

    if (needsTransform) {
      const validFormats = ['jpeg', 'jpg', 'png', 'webp', 'avif'];
      let outFormat = format ? format.toLowerCase() : '';
      if (outFormat === 'jpg') outFormat = 'jpeg';

      if (format && !validFormats.includes(outFormat)) {
        return err(c, 400, 'Unsupported output format transform');
      }

      if (!outFormat) {
        if (row.mime_type.includes('png')) outFormat = 'png';
        else if (row.mime_type.includes('webp')) outFormat = 'webp';
        else if (row.mime_type.includes('avif')) outFormat = 'avif';
        else outFormat = 'jpeg';
      }

      const fitMode = fit === 'contain' ? 'contain' : 'cover';
      const cacheKey = `${row.id}_w${width || ''}_h${height || ''}_fit${fitMode}_fmt${outFormat}`;
      const cacheDir = path.join(storageDir, '.cache');
      const cachePath = path.join(cacheDir, `${cacheKey}.${outFormat}`);

      if (!fs.existsSync(cacheDir)) {
        try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
      }

      if (fs.existsSync(cachePath)) {
        return c.newResponse(fs.readFileSync(cachePath), 200, {
          'Content-Type': `image/${outFormat}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      }

      try {
        const fileBuffer = fs.readFileSync(filePath);
        // Exception: dynamic import for native sharp addon
        const sharp = (await import('sharp')).default;
        let pipeline = sharp(fileBuffer);

        if (width || height) {
          pipeline = pipeline.resize(width, height, { fit: fitMode, position: 'centre' });
        }

        if (outFormat === 'webp') pipeline = pipeline.webp();
        else if (outFormat === 'png') pipeline = pipeline.png();
        else if (outFormat === 'jpeg') pipeline = pipeline.jpeg();
        else if (outFormat === 'avif') pipeline = pipeline.avif();

        const transformedBuffer = await pipeline.toBuffer();
        try { fs.writeFileSync(cachePath, transformedBuffer); } catch {}

        return c.newResponse(new Uint8Array(transformedBuffer), 200, {
          'Content-Type': `image/${outFormat}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      } catch (err) {
        return c.newResponse(fs.readFileSync(filePath), 200, {
          'Content-Type': row.mime_type,
          'Content-Disposition': `inline; filename="${row.filename}"`,
        });
      }
    }

    const fileStream = fs.readFileSync(filePath);
    return c.newResponse(fileStream, 200, {
      'Content-Type': row.mime_type,
      'Content-Disposition': `inline; filename="${row.filename}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  // GET /v1/storage/files
  app.get('/v1/storage/files', (c) => {
    const appId = c.get('appId');

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    let rows: Array<{ id: string; filename: string; mime_type: string; size: number; created_at: string }>;

    if (limitParam || offsetParam) {
      const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 500);
      const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
      rows = db
        .prepare('SELECT id, filename, mime_type, size, created_at FROM files WHERE app_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
        .all(appId, limit, offset) as typeof rows;
    } else {
      rows = db
        .prepare('SELECT id, filename, mime_type, size, created_at FROM files WHERE app_id = ? ORDER BY created_at ASC')
        .all(appId) as typeof rows;
    }

    const files = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mime_type,
      size: r.size,
      url: `/v1/storage/raw/${r.id}`,
      createdAt: r.created_at,
    }));

    return c.json({ count: files.length, files });
  });

  // GET /v1/storage/files/:id
  app.get('/v1/storage/files/:id', (c) => {
    const appId = c.get('appId');
    const id = c.req.param('id');

    const row = db.prepare('SELECT id, filename, mime_type, size, created_at FROM files WHERE app_id = ? AND id = ?').get(appId, id) as {
      id: string;
      filename: string;
      mime_type: string;
      size: number;
      created_at: string;
    } | undefined;

    if (!row) {
      return err(c, 404, 'File not found');
    }

    return c.json({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size,
      url: `/v1/storage/raw/${row.id}`,
      createdAt: row.created_at,
    });
  });

  // DELETE /v1/storage/files/:id
  app.delete('/v1/storage/files/:id', (c) => {
    const appId = c.get('appId');
    const id = c.req.param('id');

    const row = db.prepare('SELECT id, filename FROM files WHERE app_id = ? AND id = ?').get(appId, id) as {
      id: string;
      filename: string;
    } | undefined;

    if (!row) {
      return err(c, 404, 'File not found');
    }

    const storageDir = path.resolve(config.storage.dir);
    const ext = path.extname(row.filename);
    const diskPath = path.join(storageDir, `${row.id}${ext}`);

    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch {}
    }

    db.prepare('DELETE FROM files WHERE app_id = ? AND id = ?').run(appId, id);

    return c.json({
      message: 'File deleted successfully',
      id,
    });
  });
}
