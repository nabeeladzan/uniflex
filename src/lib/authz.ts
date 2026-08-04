import type { Context } from 'hono';
import type { UniflexConfig } from '../config';
import { verifyToken } from './authn';
import { err } from './errors';
import type { RuleUserContext } from './rules';

export async function resolveAuthUser(
  c: Context,
  config: UniflexConfig
): Promise<{ user: RuleUserContext; response?: Response }> {
  const appId = c.get('appId');
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: { id: null, email: null, role: null } };
  }

  const token = authHeader.slice(7).trim();
  const payload = await verifyToken(config.server.secret, token);

  if (!payload) {
    return { user: { id: null, email: null, role: null } };
  }

  if (payload.appId !== appId) {
    return {
      user: { id: null, email: null, role: null },
      response: err(c, 403, 'Token appId does not match request appId'),
    };
  }

  return {
    user: {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    },
  };
}
