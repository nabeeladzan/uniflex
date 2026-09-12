import type {
  UniflexClientOptions,
  App,
  User,
  AuthResponse,
  DocumentItem,
  ListOptions,
  FileMeta,
  ImageTransformOptions,
  RealtimeEvent,
  WebhookItem,
} from './types';

export class UniflexClient {
  public endpoint: string;
  public appId: string;
  public apiKey?: string;
  public token?: string;
  public adminKey?: string;
  public mediaEndpoint?: string;

  constructor(options: UniflexClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.appId = options.appId;
    this.apiKey = options.apiKey;
    this.token = options.token;
    this.adminKey = options.adminKey;
    this.mediaEndpoint = options.mediaEndpoint;
  }

  public setToken(token?: string) {
    this.token = token;
  }

  public setAppId(appId: string) {
    this.appId = appId;
  }

  public async request<T>(path: string, headers: Record<string, string> = {}, init?: RequestInit): Promise<T> {
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      'X-Uniflex-App-ID': this.appId,
      ...headers,
    };

    if (init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
      Object.assign(reqHeaders, init.headers);
    }

    if (this.apiKey) {
      reqHeaders['X-Uniflex-API-Key'] = this.apiKey;
    }

    if (this.adminKey) {
      reqHeaders['X-Uniflex-Admin-Key'] = this.adminKey;
    }

    if (this.token) {
      reqHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: reqHeaders,
    });

    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return parsed as T;
  }

  // Data Module
  public data = {
    list: async <T = Record<string, unknown>>(
      collection: string,
      options?: ListOptions
    ): Promise<{ collection: string; count: number; data: DocumentItem<T>[]; nextCursor?: string | null }> => {
      const q = new URLSearchParams();
      if (options?.limit !== undefined) q.set('limit', String(options.limit));
      if (options?.offset !== undefined) q.set('offset', String(options.offset));
      if (options?.starting_after !== undefined) q.set('starting_after', options.starting_after);
      const qs = q.toString() ? `?${q}` : '';
      return this.request<{ collection: string; count: number; data: DocumentItem<T>[]; nextCursor?: string | null }>(
        `/v1/data/${encodeURIComponent(collection)}${qs}`
      );
    },

    get: async <T = Record<string, unknown>>(collection: string, id: string): Promise<DocumentItem<T>> => {
      return this.request<DocumentItem<T>>(
        `/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`
      );
    },

    create: async <T = Record<string, unknown>>(
      collection: string,
      body: Record<string, unknown>
    ): Promise<DocumentItem<T>> => {
      return this.request<DocumentItem<T>>(`/v1/data/${encodeURIComponent(collection)}`, {}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },

    update: async <T = Record<string, unknown>>(
      collection: string,
      id: string,
      body: Record<string, unknown>
    ): Promise<DocumentItem<T>> => {
      return this.request<DocumentItem<T>>(
        `/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
        {},
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
    },

    'delete': async (collection: string, id: string): Promise<{ message: string; id: string }> => {
      return this.request<{ message: string; id: string }>(
        `/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
        {},
        { method: 'DELETE' }
      );
    },

    search: async <T = Record<string, unknown>>(
      collection: string,
      query: string,
      options?: ListOptions
    ): Promise<{ collection: string; query: string; count: number; data: DocumentItem<T>[] }> => {
      const q = new URLSearchParams({ q: query });
      if (options?.limit !== undefined) q.set('limit', String(options.limit));
      if (options?.offset !== undefined) q.set('offset', String(options.offset));
      return this.request<{ collection: string; query: string; count: number; data: DocumentItem<T>[] }>(
        `/v1/data/${encodeURIComponent(collection)}/search?${q}`
      );
    },

    subscribe: (collection: string, callback: (event: RealtimeEvent) => void): (() => void) => {
      const wsUrl = `${this.endpoint.replace(/^http/, 'ws')}/v1/realtime?appId=${encodeURIComponent(this.appId)}`;
      let ws: WebSocket | null = null;
      let isClosed = false;
      let attemptCount = 0;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

      const getBackoffDelay = (attempts: number) => {
        const base = 1000;
        const maxDelay = 30000;
        const exp = Math.min(maxDelay, base * Math.pow(2, attempts));
        return Math.floor(exp * (0.5 + Math.random() * 0.5));
      };

      const connect = () => {
        if (isClosed) return;
        try {
          ws = new WebSocket(wsUrl);
          ws.onopen = () => {
            attemptCount = 0;
            ws?.send(JSON.stringify({ type: 'subscribe', collection }));
          };
          ws.onmessage = (evt) => {
            try {
              const parsed = JSON.parse(evt.data);
              if (parsed && parsed.type === 'event' && (parsed.collection === collection || collection === '*')) {
                callback(parsed as RealtimeEvent);
              }
            } catch {}
          };
          ws.onclose = () => {
            if (!isClosed) {
              attemptCount += 1;
              const delay = getBackoffDelay(attemptCount);
              reconnectTimer = setTimeout(connect, delay);
            }
          };
        } catch {
          if (!isClosed) {
            attemptCount += 1;
            reconnectTimer = setTimeout(connect, getBackoffDelay(attemptCount));
          }
        }
      };

      connect();

      return () => {
        isClosed = true;
        clearTimeout(reconnectTimer as any);
        if (ws) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onclose = null;
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        }
      };
    },
  };

  // Auth Module
  public auth = {
    signup: async (payload: { email: string; password: string; role?: string }): Promise<AuthResponse> => {
      const res = await this.request<AuthResponse>('/v1/auth/signup', {}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.token) {
        this.setToken(res.token);
      }
      return res;
    },

    login: async (payload: { email: string; password: string }): Promise<AuthResponse> => {
      const res = await this.request<AuthResponse>('/v1/auth/login', {}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.token) {
        this.setToken(res.token);
      }
      return res;
    },

    me: async (): Promise<{ user: User }> => {
      return this.request<{ user: User }>('/v1/auth/me');
    },
  };

  // Storage Module
  public storage = {
    upload: async (fileBlob: Blob | File, filename?: string): Promise<FileMeta> => {
      const formData = new FormData();
      const name = filename || (fileBlob instanceof File ? fileBlob.name : 'upload');
      formData.append('file', fileBlob, name);

      return this.request<FileMeta>('/v1/storage/upload', {}, {
        method: 'POST',
        body: formData,
      });
    },

    getFile: async (id: string): Promise<FileMeta> => {
      return this.request<FileMeta>(`/v1/storage/files/${encodeURIComponent(id)}`);
    },

    listFiles: async (options?: ListOptions): Promise<{ count: number; files: FileMeta[] }> => {
      const q = new URLSearchParams();
      if (options?.limit !== undefined) q.set('limit', String(options.limit));
      if (options?.offset !== undefined) q.set('offset', String(options.offset));
      const qs = q.toString() ? `?${q}` : '';
      return this.request<{ count: number; files: FileMeta[] }>(`/v1/storage/files${qs}`);
    },

    deleteFile: async (id: string): Promise<{ message: string; id: string }> => {
      return this.request<{ message: string; id: string }>(
        `/v1/storage/files/${encodeURIComponent(id)}`,
        {},
        { method: 'DELETE' }
      );
    },

    getUrl: (id: string, transforms?: ImageTransformOptions): string => {
      const q = new URLSearchParams();
      if (this.appId) q.set('appId', this.appId);
      if (this.apiKey) q.set('apiKey', this.apiKey);
      if (transforms?.width) q.set('w', String(transforms.width));
      if (transforms?.height) q.set('h', String(transforms.height));
      if (transforms?.fit) q.set('fit', transforms.fit);
      if (transforms?.format) q.set('format', transforms.format);
      const qs = q.toString() ? `?${q}` : '';
      return `${this.endpoint}/v1/storage/raw/${encodeURIComponent(id)}${qs}`;
    },
  };

  // Admin Module
  public admin = {
    apps: {
      list: async (): Promise<{ count: number; apps: App[] }> => {
        return this.request<{ count: number; apps: App[] }>('/v1/admin/apps');
      },
      create: async (payload: { name: string; id?: string }): Promise<{ message: string; app: App }> => {
        return this.request<{ message: string; app: App }>('/v1/admin/apps', {}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      },
    },

    users: {
      list: async (targetAppId: string, options?: ListOptions): Promise<{ count: number; users: User[] }> => {
        const q = new URLSearchParams();
        if (options?.limit !== undefined) q.set('limit', String(options.limit));
        if (options?.offset !== undefined) q.set('offset', String(options.offset));
        const qs = q.toString() ? `?${q}` : '';
        return this.request<{ count: number; users: User[] }>(
          `/v1/admin/apps/${encodeURIComponent(targetAppId)}/users${qs}`
        );
      },
      update: async (id: string, payload: { role?: string; banned?: boolean; password?: string }): Promise<{ message: string; user: User }> => {
        return this.request<{ message: string; user: User }>(
          `/v1/admin/users/${encodeURIComponent(id)}`,
          {},
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
      },
    },

    rules: {
      get: async (): Promise<{ rules: Record<string, Record<string, Record<string, string>>> }> => {
        return this.request<{ rules: Record<string, Record<string, Record<string, string>>> }>('/v1/admin/rules');
      },
      update: async (rulesObj: Record<string, Record<string, string>>): Promise<{ message: string; rules: unknown }> => {
        return this.request<{ message: string; rules: unknown }>('/v1/admin/rules', {}, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rulesObj),
        });
      },
    },

    webhooks: {
      list: async (): Promise<{ count: number; webhooks: WebhookItem[] }> => {
        return this.request<{ count: number; webhooks: WebhookItem[] }>('/v1/admin/webhooks');
      },
      create: async (payload: { url: string; events: string[] }): Promise<WebhookItem> => {
        return this.request<WebhookItem>('/v1/admin/webhooks', {}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      },
      delete: async (id: string): Promise<{ message: string; id: string }> => {
        return this.request<{ message: string; id: string }>(
          `/v1/admin/webhooks/${encodeURIComponent(id)}`,
          {},
          { method: 'DELETE' }
        );
      },
    },
  };
}

export function createClient(options: UniflexClientOptions): UniflexClient {
  return new UniflexClient(options);
}
