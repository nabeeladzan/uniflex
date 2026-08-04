# `uniflex-sdk`

Official TypeScript / JavaScript client SDK and React hooks for the **Uniflex BaaS** engine.

## Installation

```bash
npm install uniflex-sdk
# or
bun add uniflex-sdk
```

---

## Client Setup

```typescript
import { createClient } from 'uniflex-sdk';

export const uniflex = createClient({
  endpoint: 'http://localhost:8080',
  appId: 'my-app',
});
```

---

## Data CRUD & Search

```typescript
// Paginated collection listing
const { data, count, nextCursor } = await uniflex.data.list('products', { limit: 25 });

// FTS5 Full-Text Search
const searchResults = await uniflex.data.search('products', 'keyboard');

// Mutations
const doc = await uniflex.data.create('products', { title: 'Headphones', price: 99.99 });
await uniflex.data.update('products', doc.id, { price: 89.99 });
await uniflex.data.delete('products', doc.id);
```

---

## React Hooks (`uniflex-sdk/react`)

```tsx
import { UniflexProvider, useCollection } from 'uniflex-sdk/react';
import { uniflex } from './uniflex';

export function App() {
  return (
    <UniflexProvider client={uniflex}>
      <ProductList />
    </UniflexProvider>
  );
}

function ProductList() {
  // Automatically syncs React UI state in real-time when documents change on the server!
  const { data: products, loading } = useCollection<{ title: string; price: number }>('products');

  if (loading) return <p>Loading...</p>;

  return (
    <ul>
      {products.map(p => (
        <li key={p.id}>{p.title} - ${p.price}</li>
      ))}
    </ul>
  );
}
```

---

## License

[MIT License](LICENSE) © 2026 Muhammad Nabeel Adzan
