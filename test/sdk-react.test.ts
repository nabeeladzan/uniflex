import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createApp } from '../src/app';
import { createClient } from 'uniflex-sdk';
import { useCollection, useRealtime } from 'uniflex-sdk/react';

describe('Uniflex React Hooks Suite (uniflex-sdk/react)', () => {
  let baseUrl: string;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const memoryDb = new Database(':memory:');
    const { app } = createApp(
      {
        server: { port: 0, host: 'localhost', secret: 'react-sdk-secret', adminKey: 'react-admin-key' },
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
      appId: 'react-app',
      adminKey: 'react-admin-key',
    });

    await client.admin.apps.create({
      name: 'React App',
      id: 'react-app',
    });
  });

  test('1. Verify useRealtime and useCollection hook exports', () => {
    expect(typeof useRealtime).toBe('function');
    expect(typeof useCollection).toBe('function');
  });
});
