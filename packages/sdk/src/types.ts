export interface UniflexClientOptions {
  endpoint: string;
  appId: string;
  apiKey?: string;
  token?: string;
  adminKey?: string;
}

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
  banned?: boolean;
  createdAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface DocumentMeta {
  id: string;
  collection: string;
  _createdAt: string;
  _updatedAt: string;
}

export type DocumentItem<T = Record<string, unknown>> = T & DocumentMeta;

export interface ListOptions {
  limit?: number;
  offset?: number;
  starting_after?: string;
}

export interface FileMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain';
  format?: 'jpeg' | 'jpg' | 'png' | 'webp' | 'avif';
}

export interface RealtimeEvent {
  type: 'event';
  collection: string;
  action: 'create' | 'update' | 'delete' | string;
  data: {
    id: string;
    collection: string;
    data?: Record<string, unknown>;
    _createdAt?: string;
    _updatedAt?: string;
  };
}

export interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}
