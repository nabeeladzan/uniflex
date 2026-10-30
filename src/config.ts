export interface UniflexConfig {
  server: {
    port: number;
    host: string;
    secret: string;
    adminKey: string;
    udpPort?: number;
    allowLocalWebhooks?: boolean;
  };
  storage: {
    dir: string;
    imageTransforms?: boolean;
  };
  database: {
    path: string;
    /** true = all collections (default), false = disabled, string[] = opt-in collection allowlist */
    fts?: boolean | string[];
    /** Collections kept purely in bounded RAM with 60s TTL + WebSocket broadcast (zero SQLite disk writes) */
    ephemeralCollections?: string[];
  };
}

export async function loadConfig(path = 'uniflex.config.json'): Promise<UniflexConfig> {
  const file = Bun.file(path);
  let parsed: Record<string, unknown> = {};
  if (await file.exists()) {
    try {
      parsed = (await file.json()) as Record<string, unknown>;
    } catch {}
  }

  const serverObj = (parsed.server && typeof parsed.server === 'object' ? parsed.server : {}) as Record<string, unknown>;
  const storageObj = (parsed.storage && typeof parsed.storage === 'object' ? parsed.storage : {}) as Record<string, unknown>;
  const databaseObj = (parsed.database && typeof parsed.database === 'object' ? parsed.database : {}) as Record<string, unknown>;

  let fts: boolean | string[] = true;
  if (typeof databaseObj.fts === 'boolean') {
    fts = databaseObj.fts;
  } else if (Array.isArray(databaseObj.fts)) {
    fts = databaseObj.fts.filter((c): c is string => typeof c === 'string' && /^[a-z0-9_-]{1,64}$/.test(c));
  }

  const ephemeralCollections = Array.isArray(databaseObj.ephemeralCollections)
    ? databaseObj.ephemeralCollections.filter((c): c is string => typeof c === 'string' && /^[a-z0-9_-]{1,64}$/.test(c))
    : [];

  const config: UniflexConfig = {
    server: {
      port: Number(process.env.PORT ?? serverObj.port ?? 8080),
      host: String(process.env.HOST ?? serverObj.host ?? '0.0.0.0'),
      secret: String(process.env.UNIFLEX_SECRET ?? serverObj.secret ?? ''),
      adminKey: String(process.env.UNIFLEX_ADMIN_KEY ?? serverObj.adminKey ?? ''),
      udpPort: serverObj.udpPort !== undefined ? Number(serverObj.udpPort) : Number(process.env.UNIFLEX_UDP_PORT ?? 40000),
      allowLocalWebhooks: Boolean(
        serverObj.allowLocalWebhooks ?? (process.env.UNIFLEX_ALLOW_LOCAL_WEBHOOKS === 'true' || process.env.NODE_ENV === 'test')
      ),
    },
    storage: {
      dir: String(process.env.UNIFLEX_STORAGE_DIR ?? storageObj.dir ?? './data/storage'),
      imageTransforms: storageObj.imageTransforms !== undefined ? Boolean(storageObj.imageTransforms) : true,
    },
    database: {
      path: String(process.env.UNIFLEX_DB_PATH ?? databaseObj.path ?? './data/uniflex.db'),
      fts,
      ephemeralCollections,
    },
  };

  if (!config.server.secret) {
    throw new Error('server.secret is required in uniflex.config.json or UNIFLEX_SECRET env var');
  }

  if (!config.server.adminKey) {
    throw new Error('server.adminKey is required in uniflex.config.json or UNIFLEX_ADMIN_KEY env var');
  }

  return config;
}
