export interface App {
  id: string;
  name: string;
  apiKey: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  role: string;
  appId: string;
  banned: boolean;
  createdAt: string;
}

export interface FileMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface DocItem {
  id: string;
  [key: string]: unknown;
}

export interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

export class UniflexClient {
  constructor(public readonly endpoint: string) {}

  private async req<T>(path: string, headers: Record<string, string> = {}, init?: RequestInit): Promise<T> {
    const url = `${this.endpoint.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...init?.headers,
      },
    });

    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return parsed as T;
  }

  async listApps(): Promise<{ count: number; apps: App[] }> {
    return this.req<{ count: number; apps: App[] }>('/v1/admin/apps');
  }

  async listUsers(appId: string, limit?: number, offset?: number): Promise<{ count: number; users: User[] }> {
    const q = new URLSearchParams();
    if (limit !== undefined) q.set('limit', String(limit));
    if (offset !== undefined) q.set('offset', String(offset));
    const qs = q.toString() ? `?${q}` : '';
    return this.req<{ count: number; users: User[] }>(`/v1/admin/apps/${encodeURIComponent(appId)}/users${qs}`);
  }

  async listCollection(appId: string, c: string, limit?: number, offset?: number): Promise<{ collection: string; count: number; data: DocItem[] }> {
    const q = new URLSearchParams();
    if (limit !== undefined) q.set('limit', String(limit));
    if (offset !== undefined) q.set('offset', String(offset));
    const qs = q.toString() ? `?${q}` : '';
    return this.req<{ collection: string; count: number; data: DocItem[] }>(
      `/v1/data/${encodeURIComponent(c)}${qs}`,
      { 'X-Uniflex-App-ID': appId }
    );
  }

  async searchCollection(appId: string, c: string, qStr: string, limit?: number, offset?: number): Promise<{ collection: string; query: string; count: number; data: DocItem[] }> {
    const q = new URLSearchParams({ q: qStr });
    if (limit !== undefined) q.set('limit', String(limit));
    if (offset !== undefined) q.set('offset', String(offset));
    return this.req<{ collection: string; query: string; count: number; data: DocItem[] }>(
      `/v1/data/${encodeURIComponent(c)}/search?${q}`,
      { 'X-Uniflex-App-ID': appId }
    );
  }

  async listFiles(appId: string, limit?: number, offset?: number): Promise<{ count: number; files: FileMeta[] }> {
    const q = new URLSearchParams();
    if (limit !== undefined) q.set('limit', String(limit));
    if (offset !== undefined) q.set('offset', String(offset));
    const qs = q.toString() ? `?${q}` : '';
    return this.req<{ count: number; files: FileMeta[] }>(
      `/v1/storage/files${qs}`,
      { 'X-Uniflex-App-ID': appId }
    );
  }

  async listRules(): Promise<{ rules: Record<string, Record<string, Record<string, string>>> }> {
    return this.req<{ rules: Record<string, Record<string, Record<string, string>>> }>('/v1/admin/rules');
  }

  async listWebhooks(appId: string): Promise<{ count: number; webhooks: WebhookItem[] }> {
    return this.req<{ count: number; webhooks: WebhookItem[] }>(
      '/v1/admin/webhooks',
      { 'X-Uniflex-App-ID': appId }
    );
  }
}
