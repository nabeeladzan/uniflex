# Uniflex SDK Reference (`uniflex-sdk`)

This document is the reference guide for the official Uniflex TypeScript / JavaScript client library (`uniflex-sdk`) and React hooks (`uniflex-sdk/react`).

## Installation

```bash
npm install uniflex-sdk
# or
bun add uniflex-sdk
```

---

## Overview

The `uniflex-sdk` package provides a strongly-typed client for interacting with the Uniflex BaaS server:

- App-scoped data operations (`list`, `get`, `create`, `update`, `delete`, `search`).
- Paginated & keyset cursor listing methods accepting `{ limit?, offset?, starting_after? }` and returning `nextCursor`.
- Multi-tenant authentication (`signup`, `login`, `me`).
- File uploads and binary downloads (`upload`, `getFile`, `listFiles`, `deleteFile`).
- WebSocket real-time subscription stream (`subscribe`).
- Admin tenant management (`apps`, `users`, `rules`, `webhooks`).
- **React Integration**: `<UniflexProvider>`, `useCollection()`, and `useRealtime()` hooks.

---

## Client Initialization

```typescript
import { createClient } from 'uniflex-sdk';

export const uniflex = createClient({
  endpoint: 'http://localhost:8080',
  appId: 'my-app',
  adminKey: 'uniflex-admin-key', // Required for admin module management operations
});
```

---

## 1. Data Module (`uniflex.data`)

### Listing Documents (with Pagination & Keyset Cursors)

```typescript
// Offset-based or keyset cursor pagination
const { data, count, nextCursor } = await uniflex.data.list('products', {
  limit: 25,
  starting_after: 'doc_12345',
});
console.log(`Page contains ${count} items. Next cursor: ${nextCursor}`);
```

### Full-Text Search

```typescript
const searchResults = await uniflex.data.search('products', 'hoodie', { limit: 25 });
```

### Creating, Updating, and Deleting Documents

```typescript
// Create
const newDoc = await uniflex.data.create('products', { title: 'T-Shirt', price: 19.99 });

// Update
const updated = await uniflex.data.update('products', newDoc.id, { price: 17.99 });

// Delete
await uniflex.data.delete('products', newDoc.id);
```

---

## 2. Storage Module (`uniflex.storage`)

### Uploading and Listing Files

```typescript
// Upload
const file = await uniflex.storage.upload(fileBlob, 'avatar.png');

// List files with pagination
const files = await uniflex.storage.listFiles({ limit: 50, offset: 0 });
```

---

## 3. Realtime Subscription (`uniflex.data.subscribe`)

```typescript
// Subscribe to live events on collection 'products' (or '*' for all tenant collections)
const unsubscribe = uniflex.data.subscribe('products', (event) => {
  console.log(`Action ${event.action} on ${event.data.id}:`, event.data);
});

// Cleanup when finished
unsubscribe();
```

---

## 4. React Integration (`uniflex-sdk/react`)

### Provider Setup

Wrap your application in `<UniflexProvider client={uniflex}>`:

```tsx
import { UniflexProvider } from 'uniflex-sdk/react';
import { uniflex } from './uniflex';

export function App() {
  return (
    <UniflexProvider client={uniflex}>
      <ProductList />
    </UniflexProvider>
  );
}
```

### Automatic Realtime Sync Hook (`useCollection`)

`useCollection` fetches initial collection data and **automatically syncs UI state** in real time when documents are created, updated, or deleted on the server:

```tsx
import { useCollection } from 'uniflex-sdk/react';

export function ProductList() {
  const { data: products, loading, error } = useCollection<{ title: string; price: number }>('products');

  if (loading) return <div>Loading products...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>{p.title} - ${p.price}</li>
      ))}
    </ul>
  );
}
```

### Event Subscription Hook (`useRealtime`)

`useRealtime` subscribes to raw WebSocket events on a collection:

```tsx
import { useRealtime } from 'uniflex-sdk/react';

export function ActivityFeed() {
  const lastEvent = useRealtime('products');

  return (
    <div>
      {lastEvent && <p>Latest Action: {lastEvent.action} on document {lastEvent.data.id}</p>}
    </div>
  );
}
```
