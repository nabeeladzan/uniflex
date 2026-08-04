import type { ZodSchema } from 'zod';

export function parseJson<T>(schema: ZodSchema<T>, body: unknown): { ok: true; data: T } | { ok: false; message: string } {
  const res = schema.safeParse(body);
  if (res.success) {
    return { ok: true, data: res.data };
  }
  const firstIssue = res.error.issues[0];
  const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
  return { ok: false, message: `Invalid body: ${path}${firstIssue.message}` };
}
