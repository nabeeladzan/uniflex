import { sign, verify } from 'hono/jwt';

export const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export interface JWTPayload {
  sub: string;
  email: string;
  appId: string;
  role: string;
  exp: number;
}

export async function signToken(
  secret: string,
  claims: { sub: string; email: string; appId: string; role: string }
): Promise<string> {
  const payload: JWTPayload = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
  };
  return await sign(payload as unknown as Record<string, unknown>, secret, 'HS256');
}

export async function verifyToken(secret: string, token: string): Promise<JWTPayload | null> {
  try {
    const payload = await verify(token, secret, 'HS256');
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
