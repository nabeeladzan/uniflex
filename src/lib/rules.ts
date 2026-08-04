import type { Database } from 'bun:sqlite';

export interface RuleUserContext {
  id: string | null;
  email: string | null;
  role: string | null;
}

export interface RuleContext {
  user: RuleUserContext;
  doc: unknown;
  request: unknown;
}

type TokenType = 'IDENT' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'NULL' | 'OP' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (input.startsWith('==', i)) {
      tokens.push({ type: 'OP', value: '==' });
      i += 2;
      continue;
    }

    if (input.startsWith('!=', i)) {
      tokens.push({ type: 'OP', value: '!=' });
      i += 2;
      continue;
    }

    if (input.startsWith('&&', i)) {
      tokens.push({ type: 'OP', value: '&&' });
      i += 2;
      continue;
    }

    if (input.startsWith('||', i)) {
      tokens.push({ type: 'OP', value: '||' });
      i += 2;
      continue;
    }

    if (ch === '!') {
      tokens.push({ type: 'OP', value: '!' });
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = '';
      i++;
      while (i < input.length && input[i] !== quote) {
        str += input[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: ident });
      } else if (ident === 'null') {
        tokens.push({ type: 'NULL', value: ident });
      } else {
        tokens.push({ type: 'IDENT', value: ident });
      }
      continue;
    }

    // Invalid character
    tokens.push({ type: 'EOF', value: '' });
    break;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '' };
  }

  private next(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  parse(): (ctx: RuleContext) => unknown {
    const expr = this.parseOr();
    return expr;
  }

  private parseOr(): (ctx: RuleContext) => unknown {
    let left = this.parseAnd();
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.next(); // consume ||
      const right = this.parseAnd();
      const prevLeft = left;
      left = (ctx) => Boolean(prevLeft(ctx)) || Boolean(right(ctx));
    }
    return left;
  }

  private parseAnd(): (ctx: RuleContext) => unknown {
    let left = this.parseNot();
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.next(); // consume &&
      const right = this.parseNot();
      const prevLeft = left;
      left = (ctx) => Boolean(prevLeft(ctx)) && Boolean(right(ctx));
    }
    return left;
  }

  private parseNot(): (ctx: RuleContext) => unknown {
    if (this.peek().type === 'OP' && this.peek().value === '!') {
      this.next(); // consume !
      const sub = this.parseNot();
      return (ctx) => !Boolean(sub(ctx));
    }
    return this.parseComparison();
  }

  private parseComparison(): (ctx: RuleContext) => unknown {
    const left = this.parsePrimary();
    const opToken = this.peek();
    if (opToken.type === 'OP' && (opToken.value === '==' || opToken.value === '!=')) {
      this.next();
      const right = this.parsePrimary();
      if (opToken.value === '==') {
        return (ctx) => left(ctx) === right(ctx);
      } else {
        return (ctx) => left(ctx) !== right(ctx);
      }
    }
    return left;
  }

  private parsePrimary(): (ctx: RuleContext) => unknown {
    const tok = this.peek();

    if (tok.type === 'LPAREN') {
      this.next(); // consume (
      const expr = this.parseOr();
      if (this.peek().type === 'RPAREN') {
        this.next(); // consume )
      }
      return expr;
    }

    if (tok.type === 'STRING') {
      this.next();
      return () => tok.value;
    }

    if (tok.type === 'NUMBER') {
      this.next();
      const val = Number(tok.value);
      return () => val;
    }

    if (tok.type === 'BOOLEAN') {
      this.next();
      const val = tok.value === 'true';
      return () => val;
    }

    if (tok.type === 'NULL') {
      this.next();
      return () => null;
    }

    if (tok.type === 'IDENT') {
      this.next();
      const path = tok.value.split('.');
      return (ctx) => {
        let curr: unknown = ctx;
        for (const key of path) {
          if (curr && typeof curr === 'object' && key in (curr as Record<string, unknown>)) {
            curr = (curr as Record<string, unknown>)[key];
          } else {
            return undefined;
          }
        }
        return curr;
      };
    }

    // Default fallback
    this.next();
    return () => undefined;
  }
}

export function evaluateRule(expr: string, ctx: RuleContext): boolean {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const fn = parser.parse();
    return Boolean(fn(ctx));
  } catch (err) {
    console.error('Rule evaluation failed', expr, err);
    return false;
  }
}

export function getRule(
  db: Database,
  appId: string,
  collection: string,
  action: 'read' | 'create' | 'update' | 'delete'
): string | null {
  const row = db.prepare('SELECT rules FROM rules WHERE app_id = ?').get(appId) as { rules: string } | undefined;
  if (!row) return null;

  try {
    const rulesObj = JSON.parse(row.rules) as Record<string, Record<string, string>>;
    const colRules = rulesObj[collection];
    if (!colRules) return null;

    if (colRules[action]) {
      return colRules[action];
    }

    if (action === 'read') {
      return colRules.read ?? null;
    } else {
      return colRules[action] ?? colRules.write ?? null;
    }
  } catch {
    return 'false'; // Parse failure treats rule as deny
  }
}

export function assertRule(
  db: Database,
  appId: string,
  collection: string,
  action: 'read' | 'create' | 'update' | 'delete',
  ctx: RuleContext
): boolean {
  const expr = getRule(db, appId, collection, action);
  if (!expr) {
    return true; // Open by default when no rule is defined
  }
  return evaluateRule(expr, ctx);
}
