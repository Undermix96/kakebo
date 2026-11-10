import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import type { JWTVerifyGetKey } from 'jose';
import { ZodError } from 'zod';
import { StoreError, type CatalogStore, type CycleStore } from '@kakebo/db';
import { cloudflareAccess, fakeIdentity, type AccessEnv } from './access.ts';
import type { Config } from './config.ts';
import { apiRoutes } from './routes.ts';

const STATUS = { not_found: 404, conflict: 409, invalid: 422 } as const;

export function createApp(config: Config, deps: { store: CatalogStore; cycles: CycleStore; jwks?: JWTVerifyGetKey }) {
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

  const typed = app.route('/api', apiRoutes(deps.store, deps.cycles));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  app.onError((err, c) => {
    if (err instanceof StoreError) return c.json({ error: err.message }, STATUS[err.code]);
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? 'dati non validi' }, 422);
    console.error(err);
    return c.json({ error: 'errore interno' }, 500);
  });

  if (config.staticDir) {
    const root = config.staticDir;
    app.use('*', serveStatic({ root }));
    // SPA fallback: client-side routes get index.html
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return typed;
}

/** Type of the whole app, for the typed Hono client (`hc<App>`). */
export type App = ReturnType<typeof createApp>;
