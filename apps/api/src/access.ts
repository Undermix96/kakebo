import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Identity {
  /** User email, or the service token's common_name for native apps. */
  id: string;
  kind: 'user' | 'service' | 'dev';
}

export type AccessEnv = { Variables: { identity: Identity } };

export interface AccessOptions {
  teamDomain: string;
  audiences: string[];
  /** Override for tests; defaults to the team's remote JWKS. */
  jwks?: JWTVerifyGetKey;
}

/**
 * Verifies the Cloudflare Access JWT on every request (defense in depth:
 * even a misconfigured tunnel must not expose data). Rejects with 403.
 */
export function cloudflareAccess(opts: AccessOptions): MiddlewareHandler<AccessEnv> {
  const issuer = `https://${opts.teamDomain}`;
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  return async (c, next) => {
    const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
    if (!token) return c.json({ error: 'forbidden' }, 403);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: opts.audiences,
        algorithms: ['RS256'],
      });
      const email = typeof payload.email === 'string' ? payload.email : null;
      const commonName = typeof payload.common_name === 'string' ? payload.common_name : null;
      if (email) c.set('identity', { id: email, kind: 'user' });
      else if (commonName) c.set('identity', { id: commonName, kind: 'service' });
      else return c.json({ error: 'forbidden' }, 403);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  };
}

/** Local development only (config refuses it in production). */
export function fakeIdentity(id: string): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    c.set('identity', { id, kind: 'dev' });
    await next();
  };
}
