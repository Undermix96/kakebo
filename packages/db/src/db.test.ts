import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { catalogImportSchema } from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore, StoreError } from './catalog-store.ts';
import { hasPendingMigrations, openDatabase, defaultMigrationsFolder } from './open.ts';
import { nightlySnapshot, prune } from './backup.ts';

const BY = 'test@example.com';
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakebo-db-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function store() {
  const { db, sqlite } = openDatabase({ file: ':memory:' });
  return { s: new CatalogStore(db), sqlite };
}

const acc = (name: string, extra: object = {}) => ({ name, color: 'indaco' as const, shape: 'square' as const, ...extra });

describe('openDatabase', () => {
  it('migrates a new database, in WAL mode, with foreign keys on', () => {
    const file = path.join(tmp, 'k.db');
    const { sqlite, preMigrationBackup } = openDatabase({ file, backupDir: path.join(tmp, 'backup') });
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(hasPendingMigrations(sqlite, defaultMigrationsFolder)).toBe(false);
    // Nothing to protect in a brand new database.
    expect(preMigrationBackup).toBeNull();
    sqlite.close();
  });

  it('snapshots an existing database before applying new migrations', () => {
    const file = path.join(tmp, 'k.db');
    const backupDir = path.join(tmp, 'backup');
    openDatabase({ file }).sqlite.close();
    // A newer release ships one more migration.
    const folder = path.join(tmp, 'migrations');
    fs.cpSync(defaultMigrationsFolder, folder, { recursive: true });
    const journalFile = path.join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    const last = journal.entries.at(-1);
    journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: '9999_test' });
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    fs.writeFileSync(path.join(folder, '9999_test.sql'), 'CREATE TABLE `extra` (`id` text PRIMARY KEY NOT NULL);');

    const { sqlite, preMigrationBackup } = openDatabase({ file, backupDir, migrationsFolder: folder });
    expect(preMigrationBackup).toMatch(/pre-migration-.*\.db$/);
    expect(fs.existsSync(preMigrationBackup!)).toBe(true);
    sqlite.close();
  });
});

describe('backups', () => {
  it('writes one consistent snapshot per day and keeps the last 7', () => {
    const { s, sqlite } = store();
    s.createAccount(acc('Uno'), BY);
    const dir = path.join(tmp, 'backup');

    for (let d = 1; d <= 9; d++) {
      nightlySnapshot(sqlite, dir, { today: `2026-11-0${d}` });
    }
    const again = nightlySnapshot(sqlite, dir, { today: '2026-11-09' });
    expect(again.created).toBeNull();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => `kakebo-2026-11-0${d}.db`));

    const copy = new Database(path.join(dir, files.at(-1)!), { readonly: true });
    expect(copy.prepare('select name from accounts').all()).toEqual([{ name: 'Uno' }]);
    copy.close();
  });

  it('prune ignores unrelated files', () => {
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(tmp, 'kakebo-2026-01-01.db'), 'x');
    expect(prune(tmp, /^kakebo-.*\.db$/, 0)).toEqual(['kakebo-2026-01-01.db']);
    expect(fs.readdirSync(tmp)).toEqual(['notes.txt']);
  });
});

describe('CatalogStore: accounts', () => {
  it('creates accounts in order and records who did it', () => {
    const { s, sqlite } = store();
    const a = s.createAccount(acc('Uno'), BY);
    const b = s.createAccount(acc('Due', { color: 'viola', shape: 'diamond' }), BY);
    expect([a.sort, b.sort]).toEqual([1, 2]);
    expect(s.listAccounts().map((x) => x.name)).toEqual(['Uno', 'Due']);
    expect(sqlite.prepare('select created_by, updated_by from accounts limit 1').get()).toEqual({ created_by: BY, updated_by: BY });
  });

  it('rejects duplicate names, case-insensitively', () => {
    const { s } = store();
    s.createAccount(acc('Uno'), BY);
    expect(() => s.createAccount(acc('uno'), BY)).toThrow(StoreError);
  });

  it('keeps a single leftover account', () => {
    const { s } = store();
    const a = s.createAccount(acc('Uno', { receivesLeftover: true }), BY);
    const b = s.createAccount(acc('Due'), BY);
    s.updateAccount(b.id, { receivesLeftover: true }, 'other@example.com');
    const list = s.listAccounts();
    expect(list.find((x) => x.id === a.id)!.receivesLeftover).toBe(false);
    expect(list.find((x) => x.id === b.id)!.receivesLeftover).toBe(true);
  });

  it('refuses to close an account that still has items', () => {
    const { s } = store();
    const a = s.createAccount(acc('Uno'), BY);
    const item = s.createItem(
      { kind: 'expense', name: 'Affitto', accountId: a.id, day: 1, schedule: { type: 'monthly' }, amountMode: 'fixed', amountCents: 100 },
      BY,
    );
    expect(() => s.updateAccount(a.id, { active: false }, BY)).toThrow(/ancora 1 voci/);
    s.updateItem(item.id, { archived: true }, BY);
    expect(s.updateAccount(a.id, { active: false }, BY).active).toBe(false);
    // …and then an item cannot be restored onto the closed account.
    expect(() => s.updateItem(item.id, { archived: false }, BY)).toThrow(/chiuso/);
  });
});

describe('CatalogStore: items', () => {
  it('creates, edits and archives an item', () => {
    const { s } = store();
    const a = s.createAccount(acc('Uno'), BY);
    const b = s.createAccount(acc('Due'), BY);
    const it = s.createItem(
      {
        kind: 'expense',
        name: ' Carta ',
        accountId: a.id,
        day: 3,
        schedule: { type: 'monthly' },
        amountMode: 'last',
        amountCents: 60000,
        note: 'spese + 50 € di interessi',
      },
      BY,
    );
    expect(it).toMatchObject({ name: 'Carta', note: 'spese + 50 € di interessi', archived: false, category: null });

    const edited = s.updateItem(it.id, { accountId: b.id, schedule: { type: 'months', months: [2, 8] }, note: '' }, BY);
    expect(edited).toMatchObject({ accountId: b.id, schedule: { type: 'months', months: [2, 8] }, note: null });
    expect(s.updateItem(it.id, { archived: true }, BY).archived).toBe(true);
  });

  it('keeps items without an amount (flagged later, never invented)', () => {
    const { s } = store();
    const a = s.createAccount(acc('Uno'), BY);
    const it = s.createItem(
      { kind: 'expense', name: 'Tassa', accountId: a.id, day: 16, schedule: { type: 'months', months: [6, 12] }, amountMode: 'last', amountCents: null },
      BY,
    );
    expect(it.amountCents).toBeNull();
  });

  it('validates the account and the active range', () => {
    const { s } = store();
    const a = s.createAccount(acc('Uno'), BY);
    const base = { kind: 'expense' as const, name: 'X', day: 1, schedule: { type: 'monthly' as const }, amountMode: 'fixed' as const, amountCents: 1 };
    expect(() => s.createItem({ ...base, accountId: 'nope' }, BY)).toThrow(/non esiste/);
    const it = s.createItem({ ...base, accountId: a.id, activeFrom: '2026-01-01' }, BY);
    expect(() => s.updateItem(it.id, { activeTo: '2025-12-31' }, BY)).toThrow(/fine viene prima/);
    expect(() => s.updateItem('nope', { name: 'Y' }, BY)).toThrow(/non trovata/);
  });
});

describe('CatalogStore: settings', () => {
  it('returns defaults and stores changes', () => {
    const { s } = store();
    expect(s.getSettings()).toEqual({ cycleEndDay: 10, roundingCents: 0, leadDays: 1 });
    expect(s.updateSettings({ roundingCents: 500 }, BY)).toEqual({ cycleEndDay: 10, roundingCents: 500, leadDays: 1 });
    expect(s.getSettings().roundingCents).toBe(500);
    expect(() => s.updateSettings({ roundingCents: 300 }, BY)).toThrow();
  });
});

describe('CatalogStore: import', () => {
  it('loads the example catalog once', () => {
    const { s } = store();
    const file = catalogImportSchema.parse(example);
    expect(s.importCatalog(file, BY)).toEqual({ accounts: 4, items: 10 });
    const accounts = s.listAccounts();
    expect(accounts.map((a) => a.name)).toEqual(['Banca Blu', 'Banca Viola', 'Conto Giorno', 'Carta Spesa']);
    expect(accounts.filter((a) => a.receivesLeftover).map((a) => a.name)).toEqual(['Conto Giorno']);
    const items = s.listItems();
    expect(items.filter((i) => i.archived).map((i) => i.name)).toEqual(['Vecchia carta']);
    expect(items.find((i) => i.name === 'Spesa')!.accountId).toBe(accounts.find((a) => a.name === 'Carta Spesa')!.id);
    expect(() => s.importCatalog(file, BY)).toThrow(/non è vuoto/);
  });

  it('rejects a file that refers to an unknown account', () => {
    const bad = { ...example, items: [{ ...example.items[0], account: 'Altro' }] };
    expect(catalogImportSchema.safeParse(bad).success).toBe(false);
  });
});
