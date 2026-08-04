import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createApp } from '../src/app';
import { createClient } from 'uniflex-sdk';

describe('Uniflex TypeScript SDK Integration Suite', () => {
  let baseUrl: string;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const memoryDb = new Database(':memory:');
    const { app } = createApp(
      {
        server: { port: 0, host: 'localhost', secret: 'sdk-test-jwt-secret', adminKey: 'sdk-admin-key' },
        storage: { dir: './data/test-storage' },
        database: { path: ':memory:' },
      },
      memoryDb
    );

    const server = Bun.serve({
      port: 0,
      hostname: 'localhost',
      fetch: app.fetch,
    });

    baseUrl = `http://${server.hostname}:${server.port}`;

    client = createClient({
      endpoint: baseUrl,
      appId: 'sdk-app',
      adminKey: 'sdk-admin-key',
    });
  });

  test('1. Admin: register app tenant', async () => {
    const appRes = await client.admin.apps.create({
      name: 'SDK Test App',
      id: 'sdk-app',
    });
    expect(appRes.app.id).toBe('sdk-app');

    const listRes = await client.admin.apps.list();
    expect(listRes.count).toBeGreaterThanOrEqual(1);
    expect(listRes.apps.some((a) => a.id === 'sdk-app')).toBe(true);
  });

  test('2. Auth: signup and login', async () => {
    const signupRes = await client.auth.signup({
      email: 'sdk-user@example.com',
      password: 'password123',
    });
    expect(signupRes.token).toBeDefined();
    expect(signupRes.user.email).toBe('sdk-user@example.com');

    const meRes = await client.auth.me();
    expect(meRes.user.email).toBe('sdk-user@example.com');

    const loginRes = await client.auth.login({
      email: 'sdk-user@example.com',
      password: 'password123',
    });
    expect(loginRes.token).toBeDefined();
  });

  test('3. Data: CRUD & Search & Pagination', async () => {
    const doc1 = await client.data.create('products', {
      title: 'Gaming Keyboard',
      price: 89.99,
    });
    expect(doc1.id).toBeDefined();
    expect((doc1.data as any).title).toBe('Gaming Keyboard');

    const doc2 = await client.data.create('products', {
      title: 'Ergonomic Mouse',
      price: 49.99,
    });
    expect(doc2.id).toBeDefined();

    // Paginated list
    const page1 = await client.data.list('products', { limit: 1, offset: 0 });
    expect(page1.count).toBe(1);
    expect(page1.data[0].id).toBe(doc1.id);

    const page2 = await client.data.list('products', { limit: 1, offset: 1 });
    expect(page2.count).toBe(1);
    expect(page2.data[0].id).toBe(doc2.id);

    // Get single
    const single = await client.data.get('products', doc1.id);
    expect(single.title).toBe('Gaming Keyboard');

    // Update
    const updated = await client.data.update('products', doc1.id, {
      title: 'Gaming Keyboard',
      price: 79.99,
    });
    expect((updated.data as any).price).toBe(79.99);

    // Search
    const searchRes = await client.data.search('products', 'Keyboard');
    expect(searchRes.count).toBeGreaterThanOrEqual(1);

    // Delete
    const delRes = await client.data.delete('products', doc2.id);
    expect(delRes.id).toBe(doc2.id);
  });

  test('4. Storage: file list & URL helper', async () => {
    const filesRes = await client.storage.listFiles();
    expect(filesRes.count).toBe(0);

    const url = client.storage.getUrl('file_123', {
      width: 200,
      height: 200,
      format: 'webp',
    });
    expect(url).toContain('/v1/storage/raw/file_123?w=200&h=200&format=webp');
  });

  test('5. Admin: rules & webhooks', async () => {
    const rulesUpdate = await client.admin.rules.update({
      products: { read: 'true', create: 'user != null' },
    });
    expect(rulesUpdate.message).toBe('Rules updated successfully');

    const rulesGet = await client.admin.rules.get();
    expect(rulesGet.rules['sdk-app']).toBeDefined();

    const webhook = await client.admin.webhooks.create({
      url: 'https://example.com/hook',
      events: ['data.create'],
    });
    expect(webhook.id).toBeDefined();

    const webhooksList = await client.admin.webhooks.list();
    expect(webhooksList.count).toBe(1);

    const delWebhook = await client.admin.webhooks.delete(webhook.id);
    expect(delWebhook.id).toBe(webhook.id);
  });
});
