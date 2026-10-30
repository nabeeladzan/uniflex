import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';

const SAFE_COLLECTION_RE = /^[a-z0-9_-]{1,64}$/;

export interface DbInitOptions {
  fts?: boolean | string[];
}

export function initDb(pathOrDb: string | Database, options?: DbInitOptions): Database {
  let db: Database;
  if (typeof pathOrDb === 'string') {
    if (pathOrDb !== ':memory:') {
      const dir = path.dirname(pathOrDb);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    db = new Database(pathOrDb, { create: true });
  } else {
    db = pathOrDb;
  }

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (app_id, email)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id),
      collection TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_app_collection ON documents (app_id, collection);

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id UNINDEXED,
      app_id UNINDEXED,
      collection UNINDEXED,
      data
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      app_id TEXT PRIMARY KEY REFERENCES apps(id),
      rules TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id),
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const ftsOpt = options?.fts ?? true;

  if (ftsOpt === false || (Array.isArray(ftsOpt) && ftsOpt.length === 0)) {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_documents_ai;
      DROP TRIGGER IF EXISTS trg_documents_ad;
      DROP TRIGGER IF EXISTS trg_documents_au;
      DELETE FROM documents_fts;
    `);
  } else if (Array.isArray(ftsOpt)) {
    const allowed = ftsOpt.filter((c) => SAFE_COLLECTION_RE.test(c));
    if (allowed.length === 0) {
      db.exec(`
        DROP TRIGGER IF EXISTS trg_documents_ai;
        DROP TRIGGER IF EXISTS trg_documents_ad;
        DROP TRIGGER IF EXISTS trg_documents_au;
        DELETE FROM documents_fts;
      `);
    } else {
      const sqlList = allowed.map((c) => `'${c}'`).join(', ');
      db.exec(`
        DROP TRIGGER IF EXISTS trg_documents_ai;
        DROP TRIGGER IF EXISTS trg_documents_ad;
        DROP TRIGGER IF EXISTS trg_documents_au;

        CREATE TRIGGER trg_documents_ai AFTER INSERT ON documents
        WHEN new.collection IN (${sqlList}) BEGIN
          INSERT INTO documents_fts (id, app_id, collection, data)
          VALUES (new.id, new.app_id, new.collection, new.data);
        END;

        CREATE TRIGGER trg_documents_ad AFTER DELETE ON documents
        WHEN old.collection IN (${sqlList}) BEGIN
          DELETE FROM documents_fts WHERE id = old.id AND app_id = old.app_id AND collection = old.collection;
        END;

        CREATE TRIGGER trg_documents_au AFTER UPDATE ON documents
        WHEN new.collection IN (${sqlList}) BEGIN
          DELETE FROM documents_fts WHERE id = old.id AND app_id = old.app_id AND collection = old.collection;
          INSERT INTO documents_fts (id, app_id, collection, data)
          VALUES (new.id, new.app_id, new.collection, new.data);
        END;

        DELETE FROM documents_fts WHERE collection NOT IN (${sqlList});
      `);
    }
  } else {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts (id, app_id, collection, data)
        VALUES (new.id, new.app_id, new.collection, new.data);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_documents_ad AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE id = old.id AND app_id = old.app_id AND collection = old.collection;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_documents_au AFTER UPDATE ON documents BEGIN
        UPDATE documents_fts SET data = new.data
        WHERE id = new.id AND app_id = new.app_id AND collection = new.collection;
      END;
    `);
  }

  return db;
}
