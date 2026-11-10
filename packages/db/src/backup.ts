import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { todayInRome } from '@kakebo/core';

/**
 * Consistent copies of the live database, for Backrest to pick up from /data/backup.
 * Never copy the live file: in WAL mode recent data lives in the -wal file.
 * `VACUUM INTO` writes a compact, self-contained snapshot while the app keeps running.
 */

const NIGHTLY = /^kakebo-(\d{4}-\d{2}-\d{2})\.db$/;
const PRE_MIGRATION = /^pre-migration-[\dT-]+\.db$/;

/** Writes a snapshot to `dir/fileName` atomically (temp file + rename). */
export function snapshot(sqlite: Database.Database, dir: string, fileName: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, fileName);
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { force: true });
  sqlite.prepare('VACUUM INTO ?').run(tmp);
  fs.renameSync(tmp, target);
  return target;
}

/** Keeps only the newest `keep` files matching `pattern` (names sort chronologically). */
export function prune(dir: string, pattern: RegExp, keep: number): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort();
  const removed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });
  return removed;
}

/**
 * Today's snapshot (`kakebo-YYYY-MM-DD.db`, Europe/Rome date) if it does not exist yet,
 * then retention. Idempotent: safe to call at startup and every hour.
 */
export function nightlySnapshot(
  sqlite: Database.Database,
  dir: string,
  opts: { today?: string; keep?: number } = {},
): { created: string | null; removed: string[] } {
  const today = opts.today ?? todayInRome();
  const name = `kakebo-${today}.db`;
  const created = fs.existsSync(path.join(dir, name)) ? null : snapshot(sqlite, dir, name);
  return { created, removed: prune(dir, NIGHTLY, opts.keep ?? 7) };
}

export function preMigrationSnapshot(sqlite: Database.Database, dir: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '');
  const file = snapshot(sqlite, dir, `pre-migration-${stamp}.db`);
  prune(dir, PRE_MIGRATION, 7);
  return file;
}

/**
 * Runs `nightlySnapshot` now and then every hour (the date check makes it one per day).
 * Returns a stop function. Errors are reported, never thrown: a failed backup must not
 * take the app down.
 */
export function scheduleNightlySnapshots(
  sqlite: Database.Database,
  dir: string,
  log: (msg: string) => void = console.log,
): () => void {
  const run = () => {
    try {
      const { created, removed } = nightlySnapshot(sqlite, dir);
      if (created) log(`backup: wrote ${path.basename(created)}`);
      if (removed.length) log(`backup: removed ${removed.join(', ')}`);
    } catch (err) {
      console.error('backup: snapshot failed', err);
    }
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
