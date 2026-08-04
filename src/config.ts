export interface UniflexConfig {
  server: {
    port: number;
    host: string;
    secret: string;
    adminKey: string;
  };
  storage: {
    dir: string;
  };
  database: {
    path: string;
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

  const config: UniflexConfig = {
    server: {
      port: Number(serverObj.port ?? 8080),
      host: String(serverObj.host ?? '0.0.0.0'),
      secret: String(serverObj.secret ?? ''),
      adminKey: String(serverObj.adminKey ?? ''),
    },
    storage: {
      dir: String(storageObj.dir ?? './data/storage'),
    },
    database: {
      path: String(databaseObj.path ?? './data/uniflex.db'),
    },
  };

  if (!config.server.secret) {
    throw new Error('server.secret is required in uniflex.config.json');
  }

  return config;
}
