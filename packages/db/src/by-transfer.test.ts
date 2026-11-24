import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  catalogImportSchema,
  cycleBounds,
  generateCycleEntries,
  planCycle,
  planStoredCycle,
  withDefaultStates,
  type CycleDraft,
  type CycleEntry,
} from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore, StoreError } from './catalog-store.ts';
import { CycleStore } from './cycle-store.ts';
import { defaultMigrationsFolder, openDatabase } from './open.ts';

// §13 phase 5c: expenses paid by a transfer. Invented data only (the example catalog).
const BY = 'test@example.com';
const MONTH = '2026-11';
const TODAY = '2026-11-10';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakebo-5c-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fill(file = ':memory:') {
  const opened = openDatabase({ file });
  const catalog = new CatalogStore(opened.db);
  catalog.importCatalog(catalogImportSchema.parse(example), BY);
  const accounts = catalog.listAccounts();
  const items = catalog.listItems();
  const bounds = cycleBounds(MONTH, TODAY);
  const balances = accounts.map((a, i) => ({ accountId: a.id, amountCents: i === 0 ? 30000 : 0, asOf: TODAY }));
  const sporadic: CycleEntry = {
    id: 'sporadica-1',
    name: 'Visita',
    kind: 'expense',
    accountId: accounts[0]!.id,
    date: '2026-11-22',
    amountCents: 12000,
    state: 'pending',
    origin: 'sporadic',
  };
  const entries = [...withDefaultStates(generateCycleEntries(items, bounds).entries, balances), sporadic];
  const draft: CycleDraft = { plannedOn: TODAY, endsOn: bounds.end, balances, entries };
  return { ...opened, catalog, cycles: new CycleStore(opened.db), accounts, items, draft };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreError ? e.code : String(e);
  }
  return 'ok';
};

const affittoOf = (entries: CycleEntry[]) => entries.find((e) => e.name === 'Affitto')!;

/** A confirmed November with its suggested transfers, one of them stamped. */
function confirmed(f: ReturnType<typeof fill>) {
  f.cycles.saveDraft(MONTH, f.draft, BY);
  const plan = planCycle({ accounts: f.accounts, balances: f.draft.balances, entries: f.draft.entries, today: TODAY, end: f.draft.endsOn });
  const { cycle } = f.cycles.confirm(MONTH, { transfers: plan.transfers }, BY);
  if (cycle.transfers[0]) f.cycles.setTransferDone(cycle.transfers[0].id, TODAY, BY);
  return f.cycles.getCycle(MONTH);
}

describe('migration 0004 on a database already in use', () => {
  it('keeps every cycle and gives the same numbers as before', () => {
    const file = path.join(tmp, 'k.db');
    const f = fill(file);
    confirmed(f);
    const before = f.cycles.listCycles();
    const plansBefore = before.map((c) => JSON.stringify(planStoredCycle(c, f.accounts)));
    const catalogBefore = f.catalog.listItems();

    // Bring the file back to how a release with migrations 0000–0003 left it.
    const j = JSON.parse(fs.readFileSync(path.join(defaultMigrationsFolder, 'meta', '_journal.json'), 'utf8'));
    const m4 = j.entries.find((e: { tag: string }) => e.tag === '0004_by_transfer');
    f.sqlite.exec('ALTER TABLE cycle_entries DROP COLUMN by_transfer; ALTER TABLE cycle_entries DROP COLUMN paid_on; ALTER TABLE recurring_items DROP COLUMN by_transfer;');
    f.sqlite.prepare('delete from __drizzle_migrations where created_at = ?').run(m4.when);
    const columns = (s: typeof f.sqlite, t: string) => (s.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name).sort();
    // Same shape as a brand new database at 0003.
    const old = path.join(tmp, 'm3');
    fs.cpSync(defaultMigrationsFolder, old, { recursive: true });
    fs.rmSync(path.join(old, '0004_by_transfer.sql'));
    fs.writeFileSync(path.join(old, 'meta', '_journal.json'), JSON.stringify({ ...j, entries: j.entries.filter((e: { idx: number }) => e.idx < 4) }));
    const fresh3 = openDatabase({ file: ':memory:', migrationsFolder: old }).sqlite;
    for (const t of ['cycle_entries', 'recurring_items']) expect(columns(f.sqlite, t)).toEqual(columns(fresh3, t));
    f.sqlite.close();

    // The new release starts on it: snapshot first, then the migration, by itself.
    const backupDir = path.join(tmp, 'backup');
    const after = openDatabase({ file, backupDir });
    expect(after.preMigrationBackup).toMatch(/pre-migration-.*\.db$/);
    const cycles = new CycleStore(after.db).listCycles();
    expect(cycles).toEqual(before);
    expect(cycles.map((c) => JSON.stringify(planStoredCycle(c, f.accounts)))).toEqual(plansBefore);
    const catalog = new CatalogStore(after.db).listItems();
    expect(catalog).toEqual(catalogBefore);
    expect(catalog.every((i) => i.byTransfer === false)).toBe(true);
    after.sqlite.close();
  });
});

describe('the catalog flag', () => {
  it('is imported from a catalog file, optional', () => {
    const file = structuredClone(example) as unknown as { items: Record<string, unknown>[] };
    file.items.find((i) => i.name === 'Affitto')!.byTransfer = true;
    const { db } = openDatabase({ file: ':memory:' });
    const catalog = new CatalogStore(db);
    catalog.importCatalog(catalogImportSchema.parse(file), BY);
    expect(catalog.listItems().filter((i) => i.byTransfer).map((i) => i.name)).toEqual(['Affitto']);
  });

  it('is refused on an envelope and on an income', () => {
    const f = fill();
    const spesa = f.items.find((i) => i.envelope)!;
    const income = f.items.find((i) => i.kind === 'income')!;
    expect(code(() => f.catalog.updateItem(spesa.id, { byTransfer: true }, BY))).toBe('invalid');
    expect(code(() => f.catalog.updateItem(income.id, { byTransfer: true }, BY))).toBe('invalid');
    const affitto = f.items.find((i) => i.name === 'Affitto')!;
    f.catalog.updateItem(affitto.id, { byTransfer: true }, BY);
    expect(code(() => f.catalog.updateItem(affitto.id, { envelope: true }, BY))).toBe('invalid');
  });

  it('follows into the unstamped entries of the cycle in progress, not stamped or ended ones', () => {
    const f = fill();
    const nov = confirmed(f);
    const affitto = f.items.find((i) => i.name === 'Affitto')!;
    const luce = f.items.find((i) => i.name === 'Luce')!;
    expect(affittoOf(nov.entries).byTransfer).toBeUndefined();

    f.catalog.updateItem(affitto.id, { byTransfer: true }, BY, '2026-11-24');
    const after = f.cycles.getCycle(MONTH);
    expect(affittoOf(after.entries).byTransfer).toBe(true);
    expect(after.status).toBe('confirmed');
    // Only that item changed.
    expect(after.entries.filter((e) => e.byTransfer).map((e) => e.name)).toEqual(['Affitto']);

    // A stamped entry keeps its flag and its stamp when the catalog changes again.
    f.cycles.setEntryPaid(MONTH, affittoOf(after.entries).id, '2026-11-24', BY);
    f.catalog.updateItem(affitto.id, { byTransfer: false }, BY, '2026-11-24');
    expect(affittoOf(f.cycles.getCycle(MONTH).entries)).toMatchObject({ byTransfer: true, paidOn: '2026-11-24' });

    // A cycle already ended does not follow.
    f.catalog.updateItem(luce.id, { byTransfer: true }, BY, '2026-12-11');
    expect(f.cycles.getCycle(MONTH).entries.filter((e) => e.name === 'Luce').every((e) => !e.byTransfer)).toBe(true);
  });
});

describe('stamping an expense paid by a transfer', () => {
  function ready() {
    const f = fill();
    confirmed(f);
    const affitto = f.items.find((i) => i.name === 'Affitto')!;
    f.catalog.updateItem(affitto.id, { byTransfer: true }, BY, TODAY);
    const nov = f.cycles.getCycle(MONTH);
    return { ...f, nov, id: affittoOf(nov.entries).id };
  }

  it('works on a confirmed cycle and moves the expense to the day it was paid', () => {
    const f = ready();
    const before = planStoredCycle(f.nov, f.accounts);
    const stamped = f.cycles.setEntryPaid(MONTH, f.id, '2026-11-15', BY);
    expect(stamped.status).toBe('confirmed');
    expect(affittoOf(stamped.entries).paidOn).toBe('2026-11-15');
    expect(stamped.transfers).toEqual(f.nov.transfers);
    const after = planStoredCycle(stamped, f.accounts);
    const blu = affittoOf(stamped.entries).accountId;
    const on = (p: typeof before, d: string) => p.daily.find((x) => x.date === d)!.balances[blu]!;
    expect(on(after, '2026-11-15')).toBe(on(before, '2026-11-15') - 65000);
    expect(on(after, '2026-11-30')).toBe(on(before, '2026-11-30'));
    expect(after.leftover.totalCents).toBe(before.leftover.totalCents);

    const unstamped = f.cycles.setEntryPaid(MONTH, f.id, null, BY);
    expect(affittoOf(unstamped.entries)).not.toHaveProperty('paidOn');
    expect(JSON.stringify(planStoredCycle(unstamped, f.accounts))).toBe(JSON.stringify(before));
  });

  it('accepts days from the balance date to the end of the cycle (a later day is a scheduled transfer)', () => {
    const f = ready();
    expect(code(() => f.cycles.setEntryPaid(MONTH, f.id, TODAY, BY))).toBe('ok');
    expect(code(() => f.cycles.setEntryPaid(MONTH, f.id, f.nov.endsOn, BY))).toBe('ok');
    expect(code(() => f.cycles.setEntryPaid(MONTH, f.id, '2026-11-09', BY))).toBe('invalid');
    expect(code(() => f.cycles.setEntryPaid(MONTH, f.id, '2026-12-11', BY))).toBe('invalid');
    expect(code(() => f.cycles.setEntryPaid(MONTH, f.id, 'ieri' as never, BY))).not.toBe('ok');
  });

  it('refuses entries that are not expenses paid by a transfer still to pay', () => {
    const f = ready();
    const luce = f.nov.entries.find((e) => e.name === 'Luce')!;
    const income = f.nov.entries.find((e) => e.kind === 'income')!;
    expect(code(() => f.cycles.setEntryPaid(MONTH, luce.id, '2026-11-15', BY))).toBe('invalid');
    expect(code(() => f.cycles.setEntryPaid(MONTH, income.id, '2026-11-15', BY))).toBe('invalid');
    expect(code(() => f.cycles.setEntryPaid(MONTH, 'nessuna', '2026-11-15', BY))).toBe('not_found');
    expect(code(() => f.cycles.setEntryPaid('2026-10', f.id, '2026-11-15', BY))).toBe('not_found');
  });

  it('keeps flags and stamps through reopening and saving the draft again', () => {
    const f = ready();
    f.cycles.setEntryPaid(MONTH, f.id, '2026-11-15', BY);
    const reopened = f.cycles.reopen(MONTH, BY);
    const saved = f.cycles.saveDraft(MONTH, { plannedOn: reopened.plannedOn, endsOn: reopened.endsOn, balances: reopened.balances, entries: reopened.entries }, BY);
    expect(affittoOf(saved.entries)).toMatchObject({ byTransfer: true, paidOn: '2026-11-15' });
    expect(saved.entries.find((e) => e.id === 'sporadica-1')).not.toHaveProperty('byTransfer');
  });

  it('lets a draft flag a sporadic expense but not an envelope', () => {
    const f = fill();
    const flagged = f.draft.entries.map((e) => (e.id === 'sporadica-1' ? { ...e, byTransfer: true, paidOn: '2026-11-12' } : e));
    const saved = f.cycles.saveDraft(MONTH, { ...f.draft, entries: flagged }, BY);
    expect(saved.entries.find((e) => e.id === 'sporadica-1')).toMatchObject({ byTransfer: true, paidOn: '2026-11-12' });
    const envelope = f.draft.entries.find((e) => e.name === 'Spesa')!;
    const bad = f.draft.entries.map((e) => (e.id === envelope.id ? { ...e, byTransfer: true } : e));
    expect(code(() => f.cycles.saveDraft(MONTH, { ...f.draft, entries: bad }, BY))).toBe('invalid');
  });
});
