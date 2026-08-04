# Quickstart

> Status: this guide walks the full product flow against a running server.

This guide walks through setting up a Uniflex server, registering an application tenant, creating users, reading and writing JSON data, uploading files, subscribing to instant real-time updates, searching collections, transforming images, configuring webhooks and security rules, and using the TUI admin dashboard.

## Prerequisites

- **Bun**: version 1.0 or higher.
- Verify installation with `bun --version`.

## Step 0 — Start the Server

Install dependencies and launch the development server:

```bash
bun install
bun run dev
```

In a second terminal, verify the server status:

```bash
curl http://localhost:8080/
```

Expected output:

```json
{"name": "Uniflex BaaS Server", "version": "0.1.0", "status": "online", "documentation": "/v1/admin/apps"}
```

---

## Step 1 — Register an Application

Uniflex is multi-tenant. Every client request is isolated by an application tenant. Register an app using the admin endpoint (requires `X-Uniflex-Admin-Key` header):

```bash
curl -X POST http://localhost:8080/v1/admin/apps \
  -H "X-Uniflex-Admin-Key: uniflex-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "id": "my-app"}'
```

Expected response (`201 Created`):

```json
{"message": "Application registered successfully", "app": {"id": "my-app", "name": "My App", "apiKey": "uniflex_key_<32 hex chars>", "createdAt": "<ISO timestamp>"}}
```

Save the `id` (`my-app`) for application client requests.

---

## Step 2 — Create a User

Create a user under the application tenant by supplying the `X-Uniflex-App-ID` header:

```bash
curl -X POST http://localhost:8080/v1/auth/signup \
  -H "X-Uniflex-App-ID: my-app" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "password123"}'
```

Expected response (`201 Created`):

```json
{
  "token": "<jwt>",
  "user": {
    "id": "<uuid>",
    "email": "you@example.com",
    "role": "user",
    "appId": "my-app"
  }
}
```

---

## Step 3 — Sign In

Authenticate existing users to obtain a new JWT session token:

```bash
curl -X POST http://localhost:8080/v1/auth/login \
  -H "X-Uniflex-App-ID: my-app" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "password123"}'
```

---

## Step 4 — Store and Retrieve Data (with Pagination & Cursors)

Insert a document into a JSON collection (e.g. `products`):

```bash
curl -X POST http://localhost:8080/v1/data/products \
  -H "X-Uniflex-App-ID: my-app" \
  -H "Content-Type: application/json" \
  -d '{"title": "Custom Hoodie", "price": 59.99}'
```

Retrieve documents with optional pagination parameters (`?limit=50&offset=0` or `?starting_after=<docId>`):

```bash
curl "http://localhost:8080/v1/data/products?limit=50&offset=0" \
  -H "X-Uniflex-App-ID: my-app"
```

Expected response (`200 OK`):

```json
{
  "collection": "products",
  "count": 1,
  "data": [
    {
      "id": "<uuid>",
      "title": "Custom Hoodie",
      "price": 59.99,
      "_createdAt": "<iso>",
      "_updatedAt": "<iso>"
    }
  ],
  "nextCursor": null
}
```

---

## Step 5 — Upload a File

Upload a media or asset file for your application:

```bash
curl -F "file=@photo.png" http://localhost:8080/v1/storage/upload \
  -H "X-Uniflex-App-ID: my-app"
```

---

## Step 6 — Subscribe to Real-Time Updates

Subscribe to live data mutations across your application using raw WebSockets:

Connect to `ws://localhost:8080/v1/realtime?appId=my-app` and send a subscription frame:

```json
{
  "type": "subscribe",
  "collection": "*"
}
```

When any client updates a product (e.g. via `PUT /v1/data/products/<id>`), all subscribed connections instantly receive a push event:

```json
{
  "type": "event",
  "collection": "products",
  "action": "update",
  "data": {
    "id": "<uuid>",
    "collection": "products",
    "data": {
      "title": "Custom Hoodie",
      "price": 49.99
    },
    "_createdAt": "<iso>",
    "_updatedAt": "<iso>"
  }
}
```

---

## Step 7 — Launch the TUI Admin Dashboard

Uniflex includes an interactive terminal admin dashboard packaged into the executable:

```bash
bun run tui
# or from compiled binary:
./uniflex tui
```

- Press **`Ctrl+P`** to open the VS Code-style Command Palette to search commands or switch application tenant.
- Press **`1` – `7`** to jump across tabs (`Apps`, `Data`, `Users`, `Storage`, `Rules`, `Webhooks`, `Realtime`).
- Press **`n` / `p`** to navigate pages on large collections.
- Press **`q`** to exit.
