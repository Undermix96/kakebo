import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';
import { preMigrationSnapshot } from './backup.ts';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Opened {
  db: Db;
  sqlite: Database.Database;
  /** Path of the pre-migration snapshot, if one was taken. */
  preMigrationBackup: string | null;
}

/** Migrations shipped with this package (development). The Docker image passes its own folder. */
export const defaultMigrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

interface JournalEntry {
  when: number;
}

/** Are there migrations in `folder` that this database has not applied yet? */
export function hasPendingMigrations(sqlite: Database.Database, folder: string): boolean {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  const latest = Math.max(0, ...journal.entries.map((e) => e.when));
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!table) return journal.entries.length > 0;
  const row = sqlite.prepare('select max(created_at) as last from __drizzle_migrations').get() as { last: number | null };
  return (row.last ?? 0) < latest;
}

function hasUserTables(sqlite: Database.Database): boolean {
  return !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name not like 'sqlite_%' limit 1").get();
}

/**
 * Opens (or creates) the database in WAL mode with foreign keys on, and applies
 * pending migrations. Before migrating an existing database it writes a
 * `pre-migration-*.db` snapshot to `backupDir`.
 */
export function openDatabase(opts: { file: string; migrationsFolder?: string; backupDir?: string | null }): Opened {
  const migrationsFolder = opts.migrationsFolder ?? defaultMigrationsFolder;
  if (opts.file !== ':memory:') fs.mkdirSync(path.dirname(opts.file), { recursive: true });

  const sqlite = new Database(opts.file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  let preMigrationBackup: string | null = null;
  if (hasPendingMigrations(sqlite, migrationsFolder) && hasUserTables(sqlite) && opts.backupDir) {
    preMigrationBackup = preMigrationSnapshot(sqlite, opts.backupDir);
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite, preMigrationBackup };
}
