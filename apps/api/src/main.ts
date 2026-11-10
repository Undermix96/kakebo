import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { createApp } from './app.ts';

const config = loadConfig();
const app = createApp(config);

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  const mode = config.access ? 'Cloudflare Access' : `DEV identity "${config.devFakeIdentity}"`;
  console.log(`kakebo listening on :${info.port} (auth: ${mode})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
