import type { Database } from 'bun:sqlite';
import { compileRule, type CompiledRuleFn } from './rule-compiler';

export interface CachedApp {
  id: string;
  apiKey: string;
}

export interface CachedCollectionRules {
  raw: Record<string, string>;
  compiled: Record<string, CompiledRuleFn>;
}

export interface CachedWebhook {
  id: string;
  url: string;
  events: Set<string>;
}

export class TenantCache {
  private db: Database;

  private appsLoaded = false;
  private appsById = new Map<string, CachedApp>();
  private appIdByKey = new Map<string, string>();

  private rulesLoaded = false;
  private rulesByApp = new Map<string, Map<string, CachedCollectionRules>>();

  private webhooksLoaded = false;
  private webhooksByApp = new Map<string, CachedWebhook[]>();

  constructor(db: Database) {
    this.db = db;
  }

  private ensureApps() {
    if (this.appsLoaded) return;
    const rows = this.db.query('SELECT id, api_key FROM apps').all() as Array<{ id: string; api_key: string }>;
    this.appsById.clear();
    this.appIdByKey.clear();
    for (const r of rows) {
      this.appsById.set(r.id, { id: r.id, apiKey: r.api_key });
      this.appIdByKey.set(r.api_key, r.id);
    }
    this.appsLoaded = true;
  }

  getAppById(id: string): CachedApp | undefined {
    this.ensureApps();
    return this.appsById.get(id);
  }

  getAppIdByApiKey(apiKey: string): string | undefined {
    this.ensureApps();
    return this.appIdByKey.get(apiKey);
  }

  invalidateApps() {
    this.appsLoaded = false;
  }

  private ensureRules() {
    if (this.rulesLoaded) return;
    const rows = this.db.query('SELECT app_id, rules FROM rules').all() as Array<{ app_id: string; rules: string }>;
    this.rulesByApp.clear();
    for (const r of rows) {
      this.setAppRulesFromJson(r.app_id, r.rules);
    }
    this.rulesLoaded = true;
  }

  private setAppRulesFromJson(appId: string, jsonStr: string) {
    const colMap = new Map<string, CachedCollectionRules>();
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, Record<string, string>>;
      for (const [col, ops] of Object.entries(parsed)) {
        if (!ops || typeof ops !== 'object') continue;
        const raw: Record<string, string> = {};
        const compiled: Record<string, CompiledRuleFn> = {};
        for (const [op, expr] of Object.entries(ops)) {
          if (typeof expr === 'string') {
            raw[op] = expr;
            compiled[op] = compileRule(expr);
          }
        }
        colMap.set(col, { raw, compiled });
      }
      this.rulesByApp.set(appId, colMap);
    } catch {
      // Malformed JSON: mark with wildcard deny sentinel
      const denyMap = new Map<string, CachedCollectionRules>();
      denyMap.set('__PARSE_ERROR__', {
        raw: { read: 'false', write: 'false' },
        compiled: { read: () => false, write: () => false },
      });
      this.rulesByApp.set(appId, denyMap);
    }
  }

  getAppRules(appId: string): Map<string, CachedCollectionRules> | undefined {
    this.ensureRules();
    return this.rulesByApp.get(appId);
  }

  invalidateRules() {
    this.rulesLoaded = false;
  }

  private ensureWebhooks() {
    if (this.webhooksLoaded) return;
    const rows = this.db.query('SELECT id, app_id, url, events FROM webhooks').all() as Array<{
      id: string;
      app_id: string;
      url: string;
      events: string;
    }>;
    this.webhooksByApp.clear();
    for (const r of rows) {
      let eventsList: string[] = [];
      try {
        const parsed = JSON.parse(r.events);
        if (Array.isArray(parsed)) eventsList = parsed;
      } catch {
        continue;
      }
      if (eventsList.length === 0) continue;
      let list = this.webhooksByApp.get(r.app_id);
      if (!list) {
        list = [];
        this.webhooksByApp.set(r.app_id, list);
      }
      list.push({
        id: r.id,
        url: r.url,
        events: new Set(eventsList),
      });
    }
    this.webhooksLoaded = true;
  }

  getWebhooks(appId: string): CachedWebhook[] {
    this.ensureWebhooks();
    return this.webhooksByApp.get(appId) ?? [];
  }

  invalidateWebhooks() {
    this.webhooksLoaded = false;
  }
}

const cacheRegistry = new WeakMap<Database, TenantCache>();

export function getTenantCache(db: Database): TenantCache {
  let cache = cacheRegistry.get(db);
  if (!cache) {
    cache = new TenantCache(db);
    cacheRegistry.set(db, cache);
  }
  return cache;
}
