import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createApp } from '../src/app';
import type { UniflexConfig } from '../src/config';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Uniflex Hardening & Concurrency Test Suite', () => {
  let tmpStorageDir: string;
  let server: { port: number; stop: () => void };
  let baseUrl: string;
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
    });

    server = bunServer as unknown as typeof server;
    baseUrl = `http://127.0.0.1:${server.port}`;
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
});
