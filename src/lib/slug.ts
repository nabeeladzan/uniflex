export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export const COLLECTION_RE = /^[a-z0-9][a-z0-9-]*$/;
