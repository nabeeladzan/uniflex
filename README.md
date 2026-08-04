# Uniflex

A centralized, multi-tenant backend server designed to host authentication, data persistence, file storage, real-time WebSocket sync, full-text search, and event webhooks for multiple web applications from a single instance.

> Status: core modules implemented (admin, auth, data, search, realtime, storage, rules, webhooks) plus the `@uniflex/sdk` client and Ink-based TUI admin dashboard. Offline buffering/optimistic UI is app-side and out of the V1 server scope (see § Offline & Sync).

## Capabilities

| Capability | What it does | Read more |
|---|---|---|
| Auth | App-scoped signup, login, and JWT sessions per application | `docs/api.md` § Auth |
| Data & Search | JSON collections, document CRUD, keyset cursor pagination, and FTS5 full-text search | `docs/api.md` § Data |
| Realtime | Multiplexed WebSocket subscriptions for instant updates | `docs/api.md` § Realtime |
| Offline & Sync | The server + SDK expose real-time deltas and REST CRUD; offline buffering/optimistic UI is baked client-side per app for V2 | `docs/concepts.md` § Offline & Sync |
| Storage & Media | Binary file uploads, raw streaming, and on-the-fly image resizing | `docs/api.md` § Storage |
| Security Rules | Declarative row-level access control rules per collection | `docs/concepts.md` § Security Rules |
| Webhooks | Event-driven HTTP triggers for third-party service integration | `docs/api.md` § Webhooks |
| Multi-tenancy | One server, many frontend apps; row-level `app_id` isolation | `docs/concepts.md` |

## Try it in 60 seconds

```bash
bun install
bun run dev
curl http://localhost:8080/
```

Expected output:

```json
{"name": "Uniflex BaaS Server", "version": "0.1.0", "status": "online", "documentation": "/v1/admin/apps"}
```

Want the full flow? Follow the [Quickstart](docs/quickstart.md).

## Executable Single-Binary & TUI Admin

Uniflex packages into a single compiled executable (`uniflex` or `uniflex.exe`):

```bash
# Build single binary executable
bun run build

# Start HTTP & WebSocket BaaS Server
./uniflex serve

# Open interactive TUI Admin Dashboard (Ctrl+P Command Palette)
./uniflex tui
```

## Configuration

Uniflex reads `uniflex.config.json` at startup:

```json
{
  "server": {
    "port": 8080,
    "host": "0.0.0.0",
    "secret": "uniflex-super-secret-jwt-key",
    "adminKey": "uniflex-admin-key"
  },
  "storage": {
    "dir": "./data/storage"
  },
  "database": {
    "path": "./data/uniflex.db"
  }
}
```

Loaded at startup; secrets must be overridden before any public deployment.

## Documentation

| Doc | What it's for |
|---|---|
| [`docs/quickstart.md`](docs/quickstart.md) | Guided walkthrough: app → auth → data → storage → realtime → search → webhooks |
| [`docs/concepts.md`](docs/concepts.md) | Tenants, tokens, realtime architecture, security rules, and errors |
| [`docs/sdk.md`](docs/sdk.md) | `@uniflex/sdk` & `@uniflex/sdk/react` client reference |
| [`docs/api.md`](docs/api.md) | Full HTTP & WebSocket API contract |

## License

MIT License. See [LICENSE](LICENSE) for details.
