# Uniflex HTTP API Reference

This document is the authoritative HTTP API contract for the Uniflex server.

## Overview and Conventions

- **Base URL**: `http://localhost:8080` by default (configured in `uniflex.config.json`).
- **Body Format**: JSON (`Content-Type: application/json`) unless specified otherwise (such as multipart file uploads).
- **IDs**: Server-generated UUIDv4 strings unless client-supplied.
- **Collection Names**: URL-safe lowercase slugs (e.g. `products`, `orders`).
- **App Context Header**: App-scoped HTTP endpoints require either `X-Uniflex-App-ID: <appId>` or `X-Uniflex-API-Key: <apiKey>`. WebSocket connections require `?appId=<appId>` in the connection URL.
- **Admin Authorization Header**: Admin management endpoints (`/v1/admin/*`) require `X-Uniflex-Admin-Key: <adminKey>` (configured via `server.adminKey` in `uniflex.config.json`).
- **Pagination & Cursors**: List endpoints (`GET /v1/data/:collection`, `GET /v1/admin/apps/:appId/users`, `GET /v1/storage/files`, `GET /v1/data/:collection/search`) support optional `?limit=<n>` (1–500, default 50), `?offset=<n>` (default 0), and keyset pagination `?starting_after=<docId>` (returning `nextCursor`).
- **Single-Binary CLI & TUI**: Uniflex packages into a single compiled binary (`uniflex` / `uniflex.exe`). Running `./uniflex` boots the HTTP/WS server engine; running `./uniflex tui` opens the interactive Ink/React terminal dashboard with VS Code-style Command Palette (`Ctrl+P`).
- **Error Response**: Every error returns JSON `{"error": "<message>"}` with standard HTTP status codes (see [`docs/concepts.md`](concepts.md) § Errors).

---

## Endpoint Summary Matrix

| Method | Path | Auth / Headers | Request Body | Success Response | Common Errors |
|---|---|---|---|---|---|
| GET | `/` | None | – | 200 `{"name": "Uniflex BaaS Server", "version": "0.1.0", "status": "online", "documentation": "/v1/admin/apps"}` | – |
| GET | `/health` | None | – | 200 `{"status": "ok", "timestamp": "<iso>"}` | – |
| POST | `/v1/admin/apps` | Admin Key | `{"name": string, "id"?: string}` | 201 `{"message": "Application registered successfully", "app": {"id", "name", "apiKey", "createdAt"}}` | 400, 401, 409 |
| GET | `/v1/admin/apps` | Admin Key | – | 200 `{"count": n, "apps": [...]}` | 401 |
| GET | `/v1/admin/apps/:appId/users` | Admin Key | Optional Query `?limit=&offset=` | 200 `{"count": n, "users": [...]}` | 401, 404 |
| PATCH | `/v1/admin/users/:id` | Admin Key | `{"role"?, "banned"?, "password"?}` | 200 `{"message": "User updated", "user": {...}}` | 400, 401, 404 |
| GET | `/v1/admin/rules` | Admin Key | – | 200 `{"rules": {...}}` | 401 |
| PUT | `/v1/admin/rules` | Admin Key + App Context | JSON object (rules) | 200 `{"message": "Rules updated successfully", "rules": {...}}` | 400, 401 |
| POST | `/v1/admin/webhooks` | Admin Key + App Context | `{"url": string, "events": string[]}` | 201 `{"id", "url", "events", "createdAt"}` | 400, 401 |
| GET | `/v1/admin/webhooks` | Admin Key + App Context | – | 200 `{"count": n, "webhooks": [...]}` | 401 |
| DELETE | `/v1/admin/webhooks/:id` | Admin Key | – | 200 `{"message": "Webhook deleted successfully", "id"}` | 401, 404 |
| POST | `/v1/auth/signup` | App Context | `{"email": string, "password": string, "role"?: string}` | 201 `{"token": string, "user": {"id", "email", "role", "appId"}}` | 400, 409 |
| POST | `/v1/auth/login` | App Context | `{"email": string, "password": string}` | 200 `{"token": string, "user": {"id", "email", "role", "appId"}}` | 400, 401, 403 |
| GET | `/v1/auth/me` | App Context + Bearer | – | 200 `{"user": {"id", "email", "role", "appId"}}` | 401, 403 |
| GET | `/v1/data/:collection` | App Context | Query `?limit=&offset=&starting_after=` | 200 `{"collection": string, "count": number, "data": [...], "nextCursor": string \| null}` | 400, 403 |
| GET | `/v1/data/:collection/search` | App Context | Query `?q=<term>&limit=&offset=` | 200 `{"collection": string, "query": string, "count": number, "data": [...]}` | 400, 403 |
| POST | `/v1/data/:collection` | App Context | JSON object (`id` optional) | 201 `{"id", "collection", "data", "_createdAt", "_updatedAt"}` | 400, 403, 409 |
| GET | `/v1/data/:collection/:id` | App Context | – | 200 `{"id", "collection", "data", "_createdAt", "_updatedAt"}` | 400, 403, 404 |
| PUT | `/v1/data/:collection/:id` | App Context | JSON object | 200 `{"id", "collection", "data", "_updatedAt"}` | 400, 403, 404 |
| DELETE | `/v1/data/:collection/:id` | App Context | – | 200 `{"message": "Document deleted successfully", "id": string}` | 400, 403, 404 |
| GET | `/v1/realtime` | Query `?appId=<slug>` | WebSocket Upgrade | 101 Switching Protocols (WS Frame Stream) | 400, 401 |
| POST | `/v1/storage/upload` | App Context | `multipart/form-data` (`file`) | 201 `{"id", "filename", "mimeType", "size", "url", "createdAt"}` | 400, 413 |
| GET | `/v1/storage/raw/:id` | App Context | Optional Query `?w=&h=&fit=&format=` | 200 binary stream (`Content-Type`, `Content-Disposition: inline`) | 400, 404 |
| GET | `/v1/storage/files` | App Context | Optional Query `?limit=&offset=` | 200 `{"count": n, "files": [...]}` | 401 |
| GET | `/v1/storage/files/:id` | App Context | – | 200 `{"id", "filename", "mimeType", "size", "url", "createdAt"}` | 404 |
| DELETE | `/v1/storage/files/:id` | App Context | – | 200 `{"message": "File deleted successfully", "id"}` | 404 |

---

## 1. System Endpoints

### GET `/`
Returns server metadata and status.

### GET `/health`
Returns system health check status.

---

## 2. Admin Module

Endpoints for managing multi-tenant applications, security rules, users, and webhooks. All `/v1/admin/*` endpoints require the `X-Uniflex-Admin-Key: <adminKey>` header.

### POST `/v1/admin/apps`
Register a new application tenant.

- **Request Example**:
  ```bash
  curl -X POST http://localhost:8080/v1/admin/apps \
    -H "X-Uniflex-Admin-Key: uniflex-admin-key" \
    -H "Content-Type: application/json" \
    -d '{"name": "My App", "id": "my-app"}'
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "message": "Application registered successfully",
    "app": {
      "id": "my-app",
      "name": "My App",
      "apiKey": "uniflex_key_a1b2c3d4e5f67890a1b2c3d4e5f67890",
      "createdAt": "2026-08-01T12:00:00.000Z"
    }
  }
  ```

### GET `/v1/admin/apps`
List registered applications. Requires `X-Uniflex-Admin-Key`.

### GET `/v1/admin/apps/:appId/users`
List registered users for an application tenant. Requires `X-Uniflex-Admin-Key`. Supports `?limit=<n>` and `?offset=<n>`.

### PATCH `/v1/admin/users/:id`
Update user role, ban status, or password. Requires `X-Uniflex-Admin-Key`.

---

## 3. Auth Module

Endpoints for app-scoped user registration and authentication. Sign-up returns a token (auto-login).

### POST `/v1/auth/signup`
Register a user under an application tenant (`X-Uniflex-App-ID` required).

### POST `/v1/auth/login`
Authenticate a user and return a JWT session token (`X-Uniflex-App-ID` required).

### GET `/v1/auth/me`
Retrieve profile of currently authenticated user (`X-Uniflex-App-ID` + `Authorization: Bearer <token>`).

---

## 4. Data Module

Endpoints for schemaless JSON document collections and full-text search. Rejects payloads containing reserved fields (`_createdAt`, `_updatedAt`, or `id` on PUT).

### GET `/v1/data/:collection`
List documents in a collection. Supports optional query parameters `?limit=<n>` (default 50), `?offset=<n>` (default 0), and keyset cursor `?starting_after=<docId>`. Returns `nextCursor`.

### GET `/v1/data/:collection/search`
Perform FTS5 full-text search across documents in a collection (`?q=term&limit=50&offset=0`).

### POST `/v1/data/:collection`
Create a document in a collection (`id` optional; duplicate client-supplied id returns 409).

### GET `/v1/data/:collection/:id`
Get a single document by ID.

### PUT `/v1/data/:collection/:id`
Replace a document by ID.

### DELETE `/v1/data/:collection/:id`
Delete a document by ID.

---

## 5. Realtime Module

Persistent WebSocket endpoint for subscribing to live document changes.

### GET `/v1/realtime`
Upgrade HTTP connection to a WebSocket real-time frame stream (`ws://localhost:8080/v1/realtime?appId=my-app`). Subscribing with topic `*` streams live mutations across all tenant collections.

---

## 6. Storage Module

Endpoints for app-scoped binary file storage, metadata, and dynamic image transformations.

### POST `/v1/storage/upload`
Upload a file using `multipart/form-data`. Maximum file size 50 MB.

### GET `/v1/storage/raw/:id`
Stream raw binary file payload or dynamically transformed image (`?w=&h=&fit=&format=`).

### GET `/v1/storage/files`
List stored files metadata for an application tenant. Supports optional query parameters `?limit=<n>` and `?offset=<n>`.

---

## 7. Command Line Interface & TUI

The Uniflex executable (`uniflex` or `uniflex.exe`) supports two execution modes:

- **Server Mode**: `./uniflex` or `./uniflex serve` starts the HTTP and WebSocket BaaS engine.
- **TUI Dashboard Mode**: `./uniflex tui` opens a keyboard-driven, full-terminal administrative control plane. Supply an admin key to use protected operations:

  ```bash
  UNIFLEX_ADMIN_KEY='…' ./uniflex tui --endpoint http://server.example:2024
  # Equivalent: ./uniflex tui --adminKey '…'
  ```

### TUI Keybindings & Command Palette

- **`Ctrl+P`**: Search every command, including tenant switching and all management operations.
- **`1` – `7`**, **`Tab`**, **`←` / `→`**: Navigate `Apps`, `Data`, `Users`, `Storage`, `Rules`, `Webhooks`, and `Realtime`.
- **`↑` / `↓`**: Select a row in Apps, Data, Users, Storage, and Webhooks. **`n` / `p`** change pages where available.
- **Apps**: **`a`** create; **`s`** switch; **`Enter`** activates the selected application.
- **Data**: **`a`** create, **`e`** replace the selected document, **`d`** delete it, **`/`** search, **`x`** clear search, **`c`** change collection.
- **Users**: **`a`** create, **`e`** change role, **`b`** ban/unban, **`w`** reset password.
- **Storage**: **`a`** upload from the TUI machine, **`o`** download the selected file, **`d`** delete it.
- **Rules**: **`e`** edit the active tenant’s rule JSON. **Webhooks**: **`a`** create, **`d`** delete. **Realtime**: **`c`** change its collection filter, **`x`** clear its feed.
- **Forms**: `Tab`/arrows move between fields; `Enter` advances or submits; typing replaces a prefilled value; `Ctrl+A` clears a field; `Esc` cancels. Destructive operations require typing their displayed confirmation word.
- **`r`** refreshes server data; **`q`** exits the dashboard.
