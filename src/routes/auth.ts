import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { appContext } from '../lib/tenant';
import { signToken, verifyToken } from '../lib/authn';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseSignupBody(body: unknown): { ok: true; email: string; password: string } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Invalid request body' };
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec.email !== 'string' || !EMAIL_RE.test(rec.email)) {
    return { ok: false, message: 'Invalid email' };
  }
  if (typeof rec.password !== 'string' || rec.password.length < 6) {
    return { ok: false, message: 'String must contain at least 6 character(s)' };
  }
  if (rec.role !== undefined && typeof rec.role !== 'string') {
    return { ok: false, message: 'Invalid role' };
  }
  return { ok: true, email: rec.email, password: rec.password };
}

function parseLoginBody(body: unknown): { ok: true; email: string; password: string } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Invalid request body' };
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec.email !== 'string' || !EMAIL_RE.test(rec.email)) {
    return { ok: false, message: 'Invalid email' };
  }
  if (typeof rec.password !== 'string' || rec.password.length < 1) {
    return { ok: false, message: 'Password is required' };
  }
  return { ok: true, email: rec.email, password: rec.password };
}

export function registerAuthRoutes(app: Hono, db: Database, config: UniflexConfig, bus: EventBus) {
  app.use('/v1/auth/*', appContext(db));

  // POST /v1/auth/signup
  app.post('/v1/auth/signup', async (c) => {
    const appId = c.get('appId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    const parsed = parseSignupBody(body);
    if (!parsed.ok) {
      return err(c, 400, parsed.message);
    }

    const { email, password } = parsed;
    // Security: Public signups are strictly forced to role 'user'. Role changes must use admin endpoints.
    const role = 'user';
    const normalizedEmail = email.toLowerCase();

    const existing = db
      .query('SELECT id FROM users WHERE app_id = ? AND email = ?')
      .get(appId, normalizedEmail);

    if (existing) {
      return err(c, 409, 'User with this email already exists in application');
    }

    const userId = `u_${crypto.randomUUID()}`;
    const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
    const createdAt = new Date().toISOString();

    db.query(
      'INSERT INTO users (id, app_id, email, password_hash, role, banned, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(userId, appId, normalizedEmail, passwordHash, role, createdAt);

    const token = await signToken(config.server.secret, {
      sub: userId,
      email: normalizedEmail,
      appId,
      role,
    });

    const userObj = {
      id: userId,
      email: normalizedEmail,
      role,
      appId,
    };

    bus.emit({
      event: 'user.signup',
      appId,
      timestamp: createdAt,
      data: userObj,
    });

    return c.json(
      {
        token,
        user: userObj,
      },
      201
    );
  });

  // POST /v1/auth/login
  app.post('/v1/auth/login', async (c) => {
    const appId = c.get('appId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, 'Invalid JSON body');
    }

    const parsed = parseLoginBody(body);
    if (!parsed.ok) {
      return err(c, 400, parsed.message);
    }

    const { email, password } = parsed;

    const userRow = db
      .query('SELECT id, email, password_hash, role, banned FROM users WHERE app_id = ? AND email = ?')
      .get(appId, email.toLowerCase()) as
      | { id: string; email: string; password_hash: string; role: string; banned: number }
      | null;

    if (!userRow) {
      return err(c, 401, 'Invalid credentials');
    }

    if (userRow.banned) {
      return err(c, 403, 'Account banned');
    }

    const isValid = await Bun.password.verify(password, userRow.password_hash);
    if (!isValid) {
      return err(c, 401, 'Invalid credentials');
    }

    const token = await signToken(config.server.secret, {
      sub: userRow.id,
      email: userRow.email,
      appId,
      role: userRow.role,
    });

    return c.json({
      token,
      user: {
        id: userRow.id,
        email: userRow.email,
        role: userRow.role,
        appId,
      },
    });
  });

  // GET /v1/auth/me
  app.get('/v1/auth/me', async (c) => {
    const appId = c.get('appId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return err(c, 401, 'Authorization header missing or invalid format');
    }

    const token = authHeader.slice(7).trim();
    const payload = await verifyToken(config.server.secret, token);

    if (!payload) {
      return err(c, 401, 'Invalid or expired token');
    }

    if (payload.appId !== appId) {
      return err(c, 403, 'Token appId does not match request appId');
    }

    const userRow = db
      .query('SELECT id, email, role, banned FROM users WHERE app_id = ? AND id = ?')
      .get(appId, payload.sub) as { id: string; email: string; role: string; banned: number } | null;

    if (!userRow) {
      return err(c, 401, 'User no longer exists');
    }

    if (userRow.banned) {
      return err(c, 403, 'Account banned');
    }

    return c.json({
      user: {
        id: userRow.id,
        email: userRow.email,
        role: userRow.role,
        appId,
      },
    });
  });
}
