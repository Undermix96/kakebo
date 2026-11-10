import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import type { JWTVerifyGetKey } from 'jose';
import { cloudflareAccess, fakeIdentity, type AccessEnv } from './access.ts';
import type { Config } from './config.ts';

export function createApp(config: Config, deps: { jwks?: JWTVerifyGetKey } = {}) {
  const app = new Hono<AccessEnv>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  // Liveness probe for the container healthcheck: no data, no auth.
  app.get('/healthz', (c) => c.text('ok'));

  // Everything else requires a verified identity.
  if (config.access) {
    app.use('*', cloudflareAccess({ ...config.access, ...(deps.jwks ? { jwks: deps.jwks } : {}) }));
  } else if (config.devFakeIdentity) {
    app.use('*', fakeIdentity(config.devFakeIdentity));
  }

  const api = new Hono<AccessEnv>().get('/me', (c) => c.json(c.get('identity')));
  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  if (config.staticDir) {
    const root = config.staticDir;
    app.use('*', serveStatic({ root }));
    // SPA fallback: client-side routes get index.html
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
