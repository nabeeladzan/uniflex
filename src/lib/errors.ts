import type { Context } from 'hono';

export function err(c: Context, status: number, message: string) {
  return c.json({ error: message }, status as unknown as 200);
}
