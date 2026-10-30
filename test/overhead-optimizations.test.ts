import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { websocket } from 'hono/bun';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../src/app';
import type { UniflexConfig } from '../src/config';

describe('Overhead & Unused Functionality Optimizations Suite', () => {
  const ADMIN_AUTH = { 'X-Uniflex-Admin-Key': 'opt-admin-key' };
  let tmpStorageDir: string;
  let server: { port: number; stop: (close?: boolean) => void };
  let baseUrl: string;
  let wsUrl: string;
  let db: Database;

  beforeAll(async () => {
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniflex-opt-'));
    const config: UniflexConfig = {
      server: { port: 0, host: '127.0.0.1', secret: 'opt-secret-key-12345', adminKey: 'opt-admin-key' },
      storage: { dir: tmpStorageDir, imageTransforms: false },
      database: {
        path: ':memory:',
        fts: ['mail_messages'],
        ephemeralCollections: ['collab_voice_signals'],
      },
    };

    db = new Database(':memory:');
    const { app } = createApp(config, db);

    const bunServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: app.fetch,
      websocket,
    });

    server = bunServer as unknown as typeof server;
    baseUrl = `http://127.0.0.1:${server.port}`;
    wsUrl = `ws://127.0.0.1:${server.port}`;

    await fetch(`${baseUrl}/v1/admin/apps`, {
      method: 'POST',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ name: 'Supercomfy Test', id: 'supercomfy' }),
    });
  });

  afterAll(() => {
    server.stop(true);
    try {
      fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    } catch {}
  });

  test('1. Ephemeral collections broadcast & serve from RAM without writing to SQLite or FTS5', async () => {
    const { promise: wsPromise, resolve: resolveWs } = Promise.withResolvers<Record<string, unknown>>();
    const ws = new WebSocket(`${wsUrl}/v1/realtime?appId=supercomfy`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'collab_voice_signals' }));
      fetch(`${baseUrl}/v1/data/collab_voice_signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Uniflex-App-ID': 'supercomfy' },
        body: JSON.stringify({ type: 'candidate', channelId: 'lounge', payload: 'candidate:12345' }),
      });
    };
    ws.onmessage = (evt) => {
      const parsed = JSON.parse(String(evt.data));
      if (parsed.type === 'event' && parsed.collection === 'collab_voice_signals') {
        ws.close();
        resolveWs(parsed);
      }
    };

    const wsEvent = await wsPromise;
    expect((wsEvent.data as any).channelId).toBe('lounge');

    // Verify ZERO rows persisted to SQLite documents & documents_fts
    const dbCount = (db.query("SELECT count(*) as c FROM documents WHERE collection = 'collab_voice_signals'").get() as { c: number }).c;
    const ftsCount = (db.query("SELECT count(*) as c FROM documents_fts WHERE collection = 'collab_voice_signals'").get() as { c: number }).c;
    expect(dbCount).toBe(0);
    expect(ftsCount).toBe(0);

    // Still readable from bounded RAM TTL bucket for late joiners
    const listRes = await fetch(`${baseUrl}/v1/data/collab_voice_signals`, {
      headers: { 'X-Uniflex-App-ID': 'supercomfy' },
    });
    const listJson = (await listRes.json()) as { count: number };
    expect(listJson.count).toBe(1);
  });

  test('2. Opt-in FTS5 indexes only allowlisted collections while skipping non-searchable blobs', async () => {
    await fetch(`${baseUrl}/v1/data/mail_messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Uniflex-App-ID': 'supercomfy' },
      body: JSON.stringify({ subject: 'Deployment Architecture', body: 'Arcadia homelab report' }),
    });

    await fetch(`${baseUrl}/v1/data/user_profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Uniflex-App-ID': 'supercomfy' },
      body: JSON.stringify({ id: 'prof_1', userId: 'u_1', username: 'xaiwnl', email: 'xaiwnl@gmail.com' }),
    });

    const ftsMail = (db.query("SELECT count(*) as c FROM documents_fts WHERE collection = 'mail_messages'").get() as { c: number }).c;
    const ftsProfile = (db.query("SELECT count(*) as c FROM documents_fts WHERE collection = 'user_profiles'").get() as { c: number }).c;
    expect(ftsMail).toBe(1);
    expect(ftsProfile).toBe(0);

    // Both FTS search and LIKE fallback search still work
    const searchMail = await fetch(`${baseUrl}/v1/data/mail_messages/search?q=Arcadia`, {
      headers: { 'X-Uniflex-App-ID': 'supercomfy' },
    });
    expect(((await searchMail.json()) as { count: number }).count).toBe(1);

    const searchProfile = await fetch(`${baseUrl}/v1/data/user_profiles/search?q=xaiwnl`, {
      headers: { 'X-Uniflex-App-ID': 'supercomfy' },
    });
    expect(((await searchProfile.json()) as { count: number }).count).toBe(1);
  });

  test('3. Recursive .data envelope nesting is stripped automatically on PUT round-trips', async () => {
    // Simulate client spreading PUT response `{ collection, data: { ... } }` onto existing doc and re-PUTting
    const current = {
      userId: 'u_1',
      username: 'xaiwnl',
      email: 'xaiwnl@gmail.com',
      role: 'member',
    };

    const put1 = await fetch(`${baseUrl}/v1/data/user_profiles/prof_1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Uniflex-App-ID': 'supercomfy' },
      body: JSON.stringify({
        ...current,
        collection: 'user_profiles',
        data: { ...current, data: { ...current } },
      }),
    });
    expect(put1.status).toBe(200);
    const put1Json = (await put1.json()) as { data: Record<string, unknown> };
    expect('data' in put1Json.data).toBe(false);
    expect('collection' in put1Json.data).toBe(false);
    expect(put1Json.data.username).toBe('xaiwnl');
  });

  test('4. Disabled storage.imageTransforms skips sharp and streams raw file directly', async () => {
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(base64Png, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'raw-only.png');

    const resUp = await fetch(`${baseUrl}/v1/storage/upload`, {
      method: 'POST',
      headers: { 'X-Uniflex-App-ID': 'supercomfy' },
      body: formData,
    });
    const { id } = (await resUp.json()) as { id: string };

    const resRaw = await fetch(`${baseUrl}/v1/storage/raw/${id}?w=50&format=webp`, {
      headers: { 'X-Uniflex-App-ID': 'supercomfy' },
    });
    expect(resRaw.status).toBe(200);
    // Returns original image/png without spawning sharp or creating .cache
    expect(resRaw.headers.get('Content-Type')).toBe('image/png');
    expect(fs.existsSync(path.join(tmpStorageDir, '.cache'))).toBe(false);
  });
});
