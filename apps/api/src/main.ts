import path from 'node:path';
import { serve } from '@hono/node-server';
import { CatalogStore, CycleStore, openDatabase, scheduleNightlySnapshots } from '@kakebo/db';
import { loadConfig } from './config.ts';
import { createApp } from './app.ts';

const config = loadConfig();
const backupDir = path.join(config.dataDir, 'backup');
const { db, sqlite, preMigrationBackup } = openDatabase({
  file: path.join(config.dataDir, 'kakebo.db'),
  backupDir,
  ...(config.migrationsDir ? { migrationsFolder: config.migrationsDir } : {}),
});
if (preMigrationBackup) console.log(`database: snapshot before migrating: ${path.basename(preMigrationBackup)}`);
const stopBackups = scheduleNightlySnapshots(sqlite, backupDir);

const app = createApp(config, { store: new CatalogStore(db), cycles: new CycleStore(db) });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  const mode = config.access ? 'Cloudflare Access' : `DEV identity "${config.devFakeIdentity}"`;
  console.log(`kakebo listening on :${info.port} (auth: ${mode})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () =>
    server.close(() => {
      stopBackups();
      sqlite.close();
      process.exit(0);
    }),
  );
}
