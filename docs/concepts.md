# Uniflex Architecture and Core Concepts

This document details the architectural design, security model, multi-tenancy rules, database layout, and execution model of the Uniflex BaaS engine.

## 1. Single-Binary Execution & Architecture

Uniflex is designed to compile into a single standalone binary executable (`uniflex` / `uniflex.exe`) using Bun's native compiler (`Bun.build({ compile: true })`).

```
+-------------------------------------------------------------+
|               Uniflex Standalone Binary (`uniflex`)         |
|                                                             |
|   +--------------------------+  +-----------------------+   |
|   |  HTTP & WebSocket Server |  |   Ink / React TUI     |   |
|   |   (Hono + bun:sqlite)    |  |  Admin Dashboard      |   |
|   |   `./uniflex`            |  |  `./uniflex tui`      |   |
|   +--------------------------+  +-----------------------+   |
+-------------------------------------------------------------+
```

- **Server Engine Mode** (`./uniflex` or `./uniflex serve`): Starts the high-performance Hono HTTP API and WebSocket real-time engine.
- **TUI Admin Dashboard Mode** (`./uniflex tui`): Starts an in-terminal admin control plane in an exclusive xterm alternate screen buffer (`\x1b[?1049h`). Its searchable command palette, contextual panel shortcuts, forms, and typed destructive confirmations cover tenant, document, user, storage, rules, webhook, and realtime operations against the same HTTP/WebSocket API.

---

## 2. Multi-Tenancy Isolation & Security

Every database table (`apps`, `users`, `documents`, `rules`, `webhooks`, `files`) contains an `app_id` column.

- **App Request Context**: App-scoped requests must supply `X-Uniflex-App-ID` or `X-Uniflex-API-Key`.
- **Admin Authorization**: All administrative routes (`/v1/admin/*`) require `X-Uniflex-Admin-Key` matching `server.adminKey` in `uniflex.config.json`.
- **Query Scoping**: Every SQL query is automatically scoped with `WHERE app_id = ?`.

---

## 3. Database & Pagination Performance

Uniflex utilizes SQLite with WAL (Write-Ahead Logging) and FTS5 full-text indexing.

- **Pagination & Keyset Cursors**: List endpoints (`/v1/data/:collection`, `/v1/admin/apps/:appId/users`, `/v1/storage/files`) execute indexed `LIMIT ? OFFSET ?` queries and keyset cursor queries (`?starting_after=<docId>`), keeping memory usage constant and response times under 1ms even when querying tables with millions of rows.
- **Viewport Windowing**: The TUI fetches one 20-record page at a time; document browsing uses the server’s keyset cursor while search, user, and storage lists use bounded offset pages.

---

## 4. Security Rules Model

Row-level security rules are evaluated dynamically per tenant using safe JavaScript expressions evaluated against request context:

```json
{
  "products": {
    "read": "true",
    "create": "user != null && user.role == 'admin'",
    "update": "user != null && doc.userId == user.id",
    "delete": "user != null && user.role == 'admin'"
  }
}
```

---

## 5. Offline & Sync Scope (V1 Boundary)

Uniflex's V1 mission is a **centralized, multi-tenant backend server** (plus `@uniflex/sdk` + TUI admin). Offline *buffering* — client-side IndexedDB read caching, optimistic UI, and an auto-sync mutation queue — is **not part of the V1 server or SDK surface**. It is a per-application client concern that depends on each app's UI framework, local storage, and conflict conventions, and is deferred to V2.

What V1 does provide as the foundation for any future offline strategy:

- **Real-time deltas**: `GET /v1/realtime` (WebSocket) streams `data.create` / `data.update` / `data.delete` frames as they happen (`docs/api.md` § Realtime).
- **Incremental reads**: collection `GET /v1/data/:collection` supports `?limit=`, `?offset=`, and `?starting_after=`, and `GET /v1/data/:collection/search` supports full-text queries — so a client can re-sync a window of changes on reconnect.
- **Deterministic IDs**: client-supplied `id` on `POST /v1/data/:collection` is honored (409 on duplicates), enabling a retry/replay queue without orphans.
