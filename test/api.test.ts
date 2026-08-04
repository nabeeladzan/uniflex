import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { websocket } from 'hono/bun';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../src/app';
import type { UniflexConfig } from '../src/config';

interface TestServer {
  port: number;
  stop: (closeActive?: boolean) => void;
}

describe('Uniflex Integration API Suite', () => {
  const ADMIN_AUTH = { 'X-Uniflex-Admin-Key': 'test-admin-key' };
  let tmpStorageDir: string;
  let server: TestServer;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(() => {
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniflex-test-storage-'));
    const testConfig: UniflexConfig = {
      server: { port: 0, host: '127.0.0.1', secret: 'test-jwt-secret-key-12345', adminKey: 'test-admin-key' },
      storage: { dir: tmpStorageDir },
      database: { path: ':memory:' },
    };

    const db = new Database(':memory:');
    const { app } = createApp(testConfig, db);

    const bunServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: app.fetch,
      websocket,
    });

    server = bunServer as unknown as TestServer;
    baseUrl = `http://127.0.0.1:${server.port}`;
    wsUrl = `ws://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    try {
      fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    } catch {}
  });

  test('Admin routes reject without a valid admin key', async () => {
    const resNoKey = await fetch(`${baseUrl}/v1/admin/apps`);
    expect(resNoKey.status).toBe(401);
    const jsonNoKey = (await resNoKey.json()) as { error: string };
    expect(jsonNoKey.error).toBe('Admin authorization required');

    const resBadKey = await fetch(`${baseUrl}/v1/admin/apps`, {
      headers: { 'X-Uniflex-Admin-Key': 'wrong-key' },
    });
    expect(resBadKey.status).toBe(401);
  });

  test('System endpoints GET / and GET /health', async () => {    const resRoot = await fetch(`${baseUrl}/`);
    expect(resRoot.status).toBe(200);
    const jsonRoot = (await resRoot.json()) as { name: string; status: string };
    expect(jsonRoot.name).toBe('Uniflex BaaS Server');
    expect(jsonRoot.status).toBe('online');

    const resHealth = await fetch(`${baseUrl}/health`);
    expect(resHealth.status).toBe(200);
    const jsonHealth = (await resHealth.json()) as { status: string; timestamp: string };
    expect(jsonHealth.status).toBe('ok');
    expect(typeof jsonHealth.timestamp).toBe('string');
  });

  test('Full tenant lifecycle: Admin -> Auth -> Data -> Search -> Rules -> Storage -> Webhooks -> Realtime', async () => {
    // 1. Create Apps
    const resApp = await fetch(`${baseUrl}/v1/admin/apps`, {
      method: 'POST',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ name: 'Integration Store', id: 'store-app' }),
    });
    expect(resApp.status).toBe(201);
    const jsonApp = (await resApp.json()) as { app: { id: string; apiKey: string } };
    expect(jsonApp.app.id).toBe('store-app');
    expect(jsonApp.app.apiKey).toStartWith('uniflex_key_');

    const resOtherApp = await fetch(`${baseUrl}/v1/admin/apps`, {
      method: 'POST',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ name: 'Other App', id: 'other-app' }),
    });
    expect(resOtherApp.status).toBe(201);

    // Duplicate App ID -> 409
    const resDupApp = await fetch(`${baseUrl}/v1/admin/apps`, {
      method: 'POST',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ name: 'Integration Store', id: 'store-app' }),
    });
    expect(resDupApp.status).toBe(409);

    // List Apps
    const resAppsList = await fetch(`${baseUrl}/v1/admin/apps`, { headers: ADMIN_AUTH });
    expect(resAppsList.status).toBe(200);
    const jsonAppsList = (await resAppsList.json()) as { count: number };
    expect(jsonAppsList.count).toBeGreaterThanOrEqual(2);

    // 2. Signup User
    const resSignup = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });
    expect(resSignup.status).toBe(201);
    const jsonSignup = (await resSignup.json()) as { token: string; user: { id: string; email: string } };
    expect(typeof jsonSignup.token).toBe('string');
    expect(jsonSignup.user.email).toBe('user@example.com');
    const userToken = jsonSignup.token;
    const userId = jsonSignup.user.id;

    // Login User
    const resLogin = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });
    expect(resLogin.status).toBe(200);
    const jsonLogin = (await resLogin.json()) as { user: { id: string } };
    expect(jsonLogin.user.id).toBe(userId);

    // Auth Me
    const resMe = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: {
        'X-Uniflex-App-ID': 'store-app',
        Authorization: `Bearer ${userToken}`,
      },
    });
    expect(resMe.status).toBe(200);
    const jsonMe = (await resMe.json()) as { user: { email: string } };
    expect(jsonMe.user.email).toBe('user@example.com');

    // Auth Me with wrong appId -> 403
    const resMeWrongApp = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: {
        'X-Uniflex-App-ID': 'other-app',
        Authorization: `Bearer ${userToken}`,
      },
    });
    expect(resMeWrongApp.status).toBe(403);
    const jsonMeWrongApp = (await resMeWrongApp.json()) as { error: string };
    expect(jsonMeWrongApp.error).toBe('Token appId does not match request appId');

    // 3. Create Document in Data collection
    const resCreateDoc = await fetch(`${baseUrl}/v1/data/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ title: 'Custom Blue Hoodie', price: 59.99 }),
    });
    expect(resCreateDoc.status).toBe(201);
    const jsonCreateDoc = (await resCreateDoc.json()) as { id: string; collection: string; data: { title: string } };
    expect(jsonCreateDoc.collection).toBe('products');
    expect(jsonCreateDoc.data.title).toBe('Custom Blue Hoodie');
    const docId = jsonCreateDoc.id;

    // Create Document with reserved field _createdAt -> 400
    const resReserved = await fetch(`${baseUrl}/v1/data/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ title: 'Hoodie', _createdAt: 'fake' }),
    });
    expect(resReserved.status).toBe(400);

    // List Documents (flattened shape)
    const resListDocs = await fetch(`${baseUrl}/v1/data/products`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resListDocs.status).toBe(200);
    const jsonListDocs = (await resListDocs.json()) as { count: number; data: Array<{ id: string; title: string }> };
    expect(jsonListDocs.count).toBe(1);
    expect(jsonListDocs.data[0].id).toBe(docId);
    expect(jsonListDocs.data[0].title).toBe('Custom Blue Hoodie');

    // Search Documents (FTS5)
    const resSearch = await fetch(`${baseUrl}/v1/data/products/search?q=Hoodie`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resSearch.status).toBe(200);
    const jsonSearch = (await resSearch.json()) as { count: number; data: Array<{ title: string }> };
    expect(jsonSearch.count).toBe(1);
    expect(jsonSearch.data[0].title).toBe('Custom Blue Hoodie');

    // 4. Test Security Rules Deny
    const resPutRules = await fetch(`${baseUrl}/v1/admin/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({
        rules: {
          products: { read: 'true', write: 'false' },
        },
      }),
    });
    expect(resPutRules.status).toBe(200);

    const resDeniedCreate = await fetch(`${baseUrl}/v1/data/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ title: 'Second Hoodie', price: 29.99 }),
    });
    expect(resDeniedCreate.status).toBe(403);
    const jsonDenied = (await resDeniedCreate.json()) as { error: string };
    expect(jsonDenied.error).toBe('Access denied by security rules');

    // Reset rules to open
    await fetch(`${baseUrl}/v1/admin/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ rules: {} }),
    });

    // 5. Realtime WebSockets Event Stream using Promise.withResolvers()
    const { promise: realtimePayloadPromise, resolve: resolveRealtime } = Promise.withResolvers<Record<string, unknown>>();

    const ws = new WebSocket(`${wsUrl}/v1/realtime?appId=store-app`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'products' }));
      // Trigger mutation after subscription confirmed
      fetch(`${baseUrl}/v1/data/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Uniflex-App-ID': 'store-app',
        },
        body: JSON.stringify({ title: 'Realtime Hoodie', price: 99.99 }),
      });
    };
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type === 'event' && payload.collection === 'products') {
          ws.close();
          resolveRealtime(payload as Record<string, unknown>);
        }
      } catch {}
    };

    const realtimePayload = (await realtimePayloadPromise) as { action: string; data: { title: string } };
    expect(realtimePayload.action).toBe('create');
    expect(realtimePayload.data.title).toBe('Realtime Hoodie');

    // 6. Storage & Image Transforms
    // 1x1 PNG base64 fixture
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(base64Png, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'test.png');

    const resUpload = await fetch(`${baseUrl}/v1/storage/upload`, {
      method: 'POST',
      headers: { 'X-Uniflex-App-ID': 'store-app' },
      body: formData,
    });
    expect(resUpload.status).toBe(201);
    const jsonUpload = (await resUpload.json()) as { id: string; filename: string };
    expect(jsonUpload.filename).toBe('test.png');
    const fileId = jsonUpload.id;

    // Stream raw file
    const resRaw = await fetch(`${baseUrl}/v1/storage/raw/${fileId}`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resRaw.status).toBe(200);
    expect(resRaw.headers.get('Content-Type')).toBe('image/png');

    // Image Transform ?w=5&h=5&fit=crop&format=webp
    const resTransform = await fetch(`${baseUrl}/v1/storage/raw/${fileId}?w=5&h=5&fit=crop&format=webp`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resTransform.status).toBe(200);
    expect(resTransform.headers.get('Content-Type')).toBe('image/webp');

    // List files
    const resFiles = await fetch(`${baseUrl}/v1/storage/files`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resFiles.status).toBe(200);
    const jsonFiles = (await resFiles.json()) as { count: number };
    expect(jsonFiles.count).toBe(1);

    // Delete file
    const resDelFile = await fetch(`${baseUrl}/v1/storage/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resDelFile.status).toBe(200);

    // 7. Webhook Delivery Listener using Promise.withResolvers()
    const { promise: webhookBodyPromise, resolve: resolveWebhook } = Promise.withResolvers<Record<string, unknown>>();

    const echoServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        echoServer.stop(true);
        resolveWebhook(body);
        return new Response('OK');
      },
    });

    const echoUrl = `http://127.0.0.1:${echoServer.port}/hook`;

    await fetch(`${baseUrl}/v1/admin/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...ADMIN_AUTH,
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ url: echoUrl, events: ['data.create'] }),
    });

    await fetch(`${baseUrl}/v1/data/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ title: 'Webhook Trigger Product', price: 10 }),
    });

    const webhookBody = (await webhookBodyPromise) as { event: string; appId: string };
    expect(webhookBody.event).toBe('data.create');
    expect(webhookBody.appId).toBe('store-app');

    // 8. Admin Users List and Patch (Ban user)
    const resAdminUsers = await fetch(`${baseUrl}/v1/admin/apps/store-app/users`, { headers: ADMIN_AUTH });
    expect(resAdminUsers.status).toBe(200);
    const jsonAdminUsers = (await resAdminUsers.json()) as { count: number };
    expect(jsonAdminUsers.count).toBe(1);

    // Ban user
    const resBan = await fetch(`${baseUrl}/v1/admin/users/${userId}`, {
      method: 'PATCH',
      headers: ADMIN_AUTH,
      body: JSON.stringify({ banned: true }),
    });
    expect(resBan.status).toBe(200);
    const jsonBan = (await resBan.json()) as { user: { banned: boolean } };
    expect(jsonBan.user.banned).toBe(true);

    // Try login as banned user -> 403
    const resBannedLogin = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });
    expect(resBannedLogin.status).toBe(403);
    const jsonBannedLogin = (await resBannedLogin.json()) as { error: string };
    expect(jsonBannedLogin.error).toBe('Account banned');

    // 9. Document Deletion, Cursor Pagination, and 404 Handling
    const docToDelete = await fetch(`${baseUrl}/v1/data/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uniflex-App-ID': 'store-app',
      },
      body: JSON.stringify({ title: 'Temporary Product', price: 5 }),
    });
    const jsonDocToDelete = (await docToDelete.json()) as { id: string };

    const resDeleteDoc = await fetch(`${baseUrl}/v1/data/products/${jsonDocToDelete.id}`, {
      method: 'DELETE',
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resDeleteDoc.status).toBe(200);

    const resGetDeleted = await fetch(`${baseUrl}/v1/data/products/${jsonDocToDelete.id}`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resGetDeleted.status).toBe(404);

    // Keyset cursor query
    const resCursor = await fetch(`${baseUrl}/v1/data/products?starting_after=${jsonDocToDelete.id}&limit=1`, {
      headers: { 'X-Uniflex-App-ID': 'store-app' },
    });
    expect(resCursor.status).toBe(200);
    const jsonCursor = (await resCursor.json()) as { data: any[]; nextCursor: string | null };
    expect(Array.isArray(jsonCursor.data)).toBe(true);
  });
});
