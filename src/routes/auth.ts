import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { UniflexConfig } from '../config';
import type { EventBus } from '../lib/events';
import { err } from '../lib/errors';
import { appContext } from '../lib/tenant';
import { signToken, verifyToken } from '../lib/authn';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['user', 'admin']).optional().default('user'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return err(c, 400, msg);
    }

    const { email, password, role } = parsed.data;

    const existing = db
      .prepare('SELECT id FROM users WHERE app_id = ? AND email = ?')
      .get(appId, email.toLowerCase());

    if (existing) {
      return err(c, 409, 'User with this email already exists in application');
    }

    const userId = `u_${crypto.randomUUID()}`;
    const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
    const createdAt = new Date().toISOString();

    db.prepare(
      'INSERT INTO users (id, app_id, email, password_hash, role, banned, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(userId, appId, email.toLowerCase(), passwordHash, role, createdAt);

    const token = await signToken(config.server.secret, {
      sub: userId,
      email: email.toLowerCase(),
      appId,
      role,
    });

    const userObj = {
      id: userId,
      email: email.toLowerCase(),
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

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return err(c, 400, msg);
    }

    const { email, password } = parsed.data;

    const userRow = db
      .prepare('SELECT id, email, password_hash, role, banned FROM users WHERE app_id = ? AND email = ?')
      .get(appId, email.toLowerCase()) as
      | { id: string; email: string; password_hash: string; role: string; banned: number }
      | undefined;

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
      .prepare('SELECT id, email, role, banned FROM users WHERE app_id = ? AND id = ?')
      .get(appId, payload.sub) as { id: string; email: string; role: string; banned: number } | undefined;

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
