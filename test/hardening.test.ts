import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { websocket } from 'hono/bun';
import { createApp } from '../src/app';
import type { UniflexConfig } from '../src/config';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Uniflex Hardening & Concurrency Test Suite', () => {
  let tmpStorageDir: string;
  let server: { port: number; stop: () => void };
  let baseUrl: string;
  let wsUrl: string;
  let db: Database;
  const ADMIN_AUTH = { 'X-Uniflex-Admin-Key': 'hardening-admin-key' };

  beforeAll(() => {
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniflex-hardening-'));
    const config: UniflexConfig = {
      server: { port: 0, host: '127.0.0.1', secret: 'hardening-secret-key-12345', adminKey: 'hardening-admin-key' },
      storage: { dir: tmpStorageDir },
      database: { path: ':memory:' },
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
  });

  afterAll(() => {
    server.stop();
    try {
      fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    } catch {}
  });

  test('1. PRAGMA busy_timeout is configured to 5000ms', () => {
    const row = db.prepare('PRAGMA busy_timeout;').get() as { timeout: number };
    expect(row.timeout).toBe(5000);
  });

  test('2. FTS5 documents_fts table exists and synchronizes with documents triggers', async () => {
    // Setup app
    await fetch(`${baseUrl}/v1/admin/apps`, {
      method: 'POST',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ name: 'FTS App', id: 'fts-app' }),
    });

    // Create document in documents
    const resDoc = await fetch(`${baseUrl}/v1/data/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({ title: 'Quantum Computing', body: 'Superconducting qubits and coherence time' }),
    });
    expect(resDoc.status).toBe(201);
    const docJson = await resDoc.json() as { id: string };

    // Query FTS5 directly
    const ftsRow = db.prepare('SELECT id, data FROM documents_fts WHERE id = ?').get(docJson.id) as { id: string; data: string } | undefined;
    expect(ftsRow).toBeDefined();
    expect(ftsRow?.data).toContain('Superconducting');

    // Search via /search endpoint
    const resSearch = await fetch(`${baseUrl}/v1/data/notes/search?q=Superconducting`, {
      headers: { 'X-Uniflex-App-ID': 'fts-app' },
    });
    expect(resSearch.status).toBe(200);
    const searchJson = await resSearch.json() as { count: number };
    expect(searchJson.count).toBe(1);

    // Delete document and verify trigger removed it from FTS5
    await fetch(`${baseUrl}/v1/data/notes/${docJson.id}`, {
      method: 'DELETE',
      headers: { 'X-Uniflex-App-ID': 'fts-app' },
    });
    const ftsDeletedRow = db.prepare('SELECT id FROM documents_fts WHERE id = ?').get(docJson.id);
    expect(ftsDeletedRow).toBeNull();
  });

  test('3. Banned user is immediately rejected on data access even with valid JWT', async () => {
    // Signup user
    const resSignup = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({ email: 'baduser@example.com', password: 'password123' }),
    });
    expect(resSignup.status).toBe(201);
    const signupJson = await resSignup.json() as { token: string; user: { id: string } };
    const userToken = signupJson.token;
    const userId = signupJson.user.id;

    // Set rule requiring user != null
    await fetch(`${baseUrl}/v1/admin/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({
        rules: {
          secure_notes: { read: 'user.id != null', write: 'user.id != null' },
        },
      }),
    });

    // Access works before ban
    const resBeforeBan = await fetch(`${baseUrl}/v1/data/secure_notes`, {
      headers: {
        'X-Uniflex-App-ID': 'fts-app',
        Authorization: `Bearer ${userToken}`,
      },
    });
    expect(resBeforeBan.status).toBe(200);

    // Ban the user in the database
    db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(userId);

    // Access is immediately rejected with 403 Forbidden
    const resAfterBan = await fetch(`${baseUrl}/v1/data/secure_notes`, {
      headers: {
        'X-Uniflex-App-ID': 'fts-app',
        Authorization: `Bearer ${userToken}`,
      },
    });
    expect(resAfterBan.status).toBe(403);
    const errorJson = await resAfterBan.json() as { error: string };
    expect(errorJson.error).toBe('User account is banned');
  });

  test('4. Large payload exceeding bodyLimit is rejected with 413 Payload too large', async () => {
    // Generate 12MB payload
    const bigPayload = JSON.stringify({ data: 'x'.repeat(12 * 1024 * 1024) });

    const resBig = await fetch(`${baseUrl}/v1/data/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: bigPayload,
    });
    expect(resBig.status).toBe(413);
  });

  test('5. Signup role privilege escalation is prevented', async () => {
    // Attempt signup with role: "admin"
    const res = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({
        email: 'attacker@example.com',
        password: 'password123',
        role: 'admin',
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { user: { role: string; email: string } };
    expect(json.user.role).toBe('user'); // Enforced to 'user'

    // Verify in database directly
    const row = db.prepare('SELECT role FROM users WHERE email = ?').get('attacker@example.com') as { role: string };
    expect(row.role).toBe('user');
  });

  test('6. Admin key timing-safe comparison rejects invalid keys', async () => {
    // Incorrect length
    const resShort = await fetch(`${baseUrl}/v1/admin/apps`, {
      headers: { 'X-Uniflex-Admin-Key': 'short' },
    });
    expect(resShort.status).toBe(401);

    // Matching length but wrong content
    const resSameLen = await fetch(`${baseUrl}/v1/admin/apps`, {
      headers: { 'X-Uniflex-Admin-Key': 'hardening-admin-kek' },
    });
    expect(resSameLen.status).toBe(401);

    // Correct key
    const resCorrect = await fetch(`${baseUrl}/v1/admin/apps`, {
      headers: ADMIN_AUTH,
    });
    expect(resCorrect.status).toBe(200);
  });

  test('7. Webhook SSRF protection blocks cloud metadata', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({
        url: 'http://169.254.169.254/latest/meta-data',
        events: ['data.create'],
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('SSRF');
  });

  test('8. Storage delete cleans up cached thumbnail files', async () => {
    // 1x1 PNG base64 fixture
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(base64Png, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'thumbnail-test.png');

    const resUpload = await fetch(`${baseUrl}/v1/storage/upload`, {
      method: 'POST',
      headers: { 'X-Uniflex-App-ID': 'fts-app' },
      body: formData,
    });
    expect(resUpload.status).toBe(201);
    const jsonUpload = (await resUpload.json()) as { id: string };
    const fileId = jsonUpload.id;

    // Generate a transformed cached thumbnail
    const resTransform = await fetch(`${baseUrl}/v1/storage/raw/${fileId}?w=10&h=10&format=webp`, {
      headers: { 'X-Uniflex-App-ID': 'fts-app' },
    });
    expect(resTransform.status).toBe(200);

    // Verify cache directory has the thumbnail
    const cacheDir = path.join(tmpStorageDir, '.cache');
    const cacheFilesBefore = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
    expect(cacheFilesBefore.some((f) => f.startsWith(`${fileId}_`))).toBe(true);

    // Delete file via API
    const resDel = await fetch(`${baseUrl}/v1/storage/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'X-Uniflex-App-ID': 'fts-app' },
    });
    expect(resDel.status).toBe(200);

    // Verify cached thumbnail was cleaned up
    const cacheFilesAfter = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
    expect(cacheFilesAfter.some((f) => f.startsWith(`${fileId}_`))).toBe(false);
  });

  test('9. WebSocket subscription enforces security rules', async () => {
    // Set restricted rule on private_docs
    await fetch(`${baseUrl}/v1/admin/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({
        rules: {
          private_docs: { read: 'user.id != null', write: 'true' },
        },
      }),
    });

    // Create user to obtain valid JWT
    const resSignup = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'fts-app',
      },
      body: JSON.stringify({ email: 'ws-user@example.com', password: 'password123' }),
    });
    const signupJson = (await resSignup.json()) as { token: string };
    const validToken = signupJson.token;

    // A. Anonymous subscriber to private_docs should be rejected with an error frame
    const { promise: anonSubDeniedPromise, resolve: resolveAnonDenied } = Promise.withResolvers<string>();
    const anonWs = new WebSocket(`${wsUrl}/v1/realtime?appId=fts-app`);
    anonWs.onopen = () => {
      anonWs.send(JSON.stringify({ type: 'subscribe', collection: 'private_docs' }));
    };
    anonWs.onmessage = (evt) => {
      try {
        const frame = JSON.parse(String(evt.data));
        if (frame.type === 'error') {
          anonWs.close();
          resolveAnonDenied(frame.error);
        }
      } catch {}
    };

    const anonError = await anonSubDeniedPromise;
    expect(anonError).toContain('Subscription denied by security rules');

    // B. Authenticated subscriber with valid token receives broadcasts
    const { promise: authEventPromise, resolve: resolveAuthEvent } = Promise.withResolvers<Record<string, unknown>>();
    const authWs = new WebSocket(`${wsUrl}/v1/realtime?appId=fts-app&token=${validToken}`);
    authWs.onopen = () => {
      authWs.send(JSON.stringify({ type: 'subscribe', collection: 'private_docs' }));
      // Trigger document creation
      fetch(`${baseUrl}/v1/data/private_docs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Uniflex-App-ID': 'fts-app',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ secret: 'classified data' }),
      });
    };
    authWs.onmessage = (evt) => {
      try {
        const frame = JSON.parse(String(evt.data));
        if (frame.type === 'event' && frame.collection === 'private_docs') {
          authWs.close();
          resolveAuthEvent(frame as Record<string, unknown>);
        }
      } catch {}
    };

    const authEvent = await authEventPromise;
    expect(authEvent.type).toBe('event');
    expect(authEvent.collection).toBe('private_docs');
  });
});
