import type { Database } from 'bun:sqlite';
import {
  compileRule,
  evaluateRule,
  type CompiledRuleFn,
  type RuleContext,
  type RuleUserContext,
} from './rule-compiler';
import { getTenantCache } from './cache';

export { compileRule, evaluateRule, type CompiledRuleFn, type RuleContext, type RuleUserContext };

export function getRule(
  db: Database,
  appId: string,
  collection: string,
  action: 'read' | 'create' | 'update' | 'delete'
): string | null {
  const appRules = getTenantCache(db).getAppRules(appId);
  if (!appRules) return null;
  if (appRules.has('__PARSE_ERROR__')) return 'false';

  const colRules = appRules.get(collection);
  if (!colRules) return null;

  if (colRules.raw[action]) return colRules.raw[action];
  if (action === 'read') return colRules.raw.read ?? null;
  return colRules.raw[action] ?? colRules.raw.write ?? null;
}

export function assertRule(
  db: Database,
  appId: string,
  collection: string,
  action: 'read' | 'create' | 'update' | 'delete',
  ctx: RuleContext
): boolean {
  const appRules = getTenantCache(db).getAppRules(appId);
  if (!appRules) return true; // Open by default when no rule row exists
  if (appRules.has('__PARSE_ERROR__')) return false;

  const colRules = appRules.get(collection);
  if (!colRules) return true;

  const fn =
    colRules.compiled[action] ??
    (action === 'read' ? colRules.compiled.read : colRules.compiled.write);

  if (!fn) return true;
  return fn(ctx);
}
