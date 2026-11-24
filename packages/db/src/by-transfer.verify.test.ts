import { describe, expect, it } from 'vitest';
import { catalogImportSchema, cycleBounds, generateCycleEntries, historyImportSchema, withDefaultStates, type CycleDraft, type CycleEntry } from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore, StoreError } from './catalog-store.ts';
import { CycleStore } from './cycle-store.ts';
import { openDatabase } from './open.ts';

// Independent verification of §13 phase 5c. Invented data only (the example catalog).
const BY = 'test@example.com';
const OTHER = 'other@example.com';

function fill() {
  const opened = openDatabase({ file: ':memory:' });
  const catalog = new CatalogStore(opened.db);
  catalog.importCatalog(catalogImportSchema.parse(example), BY);
  const accounts = catalog.listAccounts();
  const items = catalog.listItems();
  const draftFor = (month: string, today: string): CycleDraft => {
    const bounds = cycleBounds(month, today);
    const balances = accounts.map((a) => ({ accountId: a.id, amountCents: 100000, asOf: today }));
    const sporadic: CycleEntry = {
      id: `sp-${month}`,
      name: 'Affitto',
      kind: 'expense',
      accountId: accounts[0]!.id,
      date: bounds.end,
      amountCents: 1000,
      state: 'pending',
      origin: 'sporadic',
    };
    return { plannedOn: today, endsOn: bounds.end, balances, entries: [...withDefaultStates(generateCycleEntries(items, bounds).entries, balances), sporadic] };
  };
  return { ...opened, catalog, cycles: new CycleStore(opened.db), accounts, items, draftFor };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreError ? e.code : String(e);
  }
  return 'ok';
};

describe('catalog flag propagation', () => {
  it('touches only that item\'s catalog expenses in cycles not ended, confirmed or draft, and records who', () => {
    const f = fill();
    f.cycles.saveDraft('2026-10', f.draftFor('2026-10', '2026-10-10'), BY);
    f.cycles.confirm('2026-10', { transfers: [] }, BY);
    f.cycles.saveDraft('2026-11', f.draftFor('2026-11', '2026-11-10'), BY);
    f.cycles.confirm('2026-11', { transfers: [] }, BY);
    f.cycles.saveDraft('2026-12', f.draftFor('2026-12', '2026-12-10'), BY);
    const affitto = f.items.find((i) => i.name === 'Affitto')!;

    f.catalog.updateItem(affitto.id, { byTransfer: true }, OTHER, '2026-11-24');
    const oct = f.cycles.getCycle('2026-10');
    const nov = f.cycles.getCycle('2026-11');
    const dec = f.cycles.getCycle('2026-12');
    expect(oct.entries.some((e) => e.byTransfer)).toBe(false); // ended 2026-11-10
    for (const c of [nov, dec]) {
      expect(c.entries.filter((e) => e.byTransfer).map((e) => e.id)).toEqual(c.entries.filter((e) => e.recurringItemId === affitto.id).map((e) => e.id));
      // The sporadic entry with the same name is not the item's.
      expect(c.entries.find((e) => e.origin === 'sporadic')).not.toHaveProperty('byTransfer');
    }
    expect(nov.status).toBe('confirmed');
    expect(dec.status).toBe('draft');
    const by = f.sqlite.prepare("select distinct updated_by as u from cycle_entries where by_transfer = 1").all();
    expect(by).toEqual([{ u: OTHER }]);

    // A patch that does not change the flag does not touch entries.
    const before = JSON.stringify(f.cycles.listCycles());
    f.catalog.updateItem(affitto.id, { byTransfer: true, note: 'x' }, BY, '2026-11-24');
    expect(JSON.stringify(f.cycles.listCycles())).toBe(before);

    // Back to false: unflagged again, and old records read exactly as before (no field).
    f.catalog.updateItem(affitto.id, { byTransfer: false }, BY, '2026-11-24');
    expect(f.cycles.getCycle('2026-11').entries.some((e) => 'byTransfer' in e)).toBe(false);
  });
});

describe('stamping', () => {
  it('refuses an excluded entry, allows un-stamping anything, and accepts the balance date of that account', () => {
    const f = fill();
    const d = f.draftFor('2026-11', '2026-11-10');
    const affitto = f.items.find((i) => i.name === 'Affitto')!;
    const blu = affitto.accountId;
    // The balance of Banca Blu was read on the 8th.
    d.balances = d.balances.map((b) => (b.accountId === blu ? { ...b, asOf: '2026-11-08' } : b));
    d.entries = d.entries.map((e) => (e.recurringItemId === affitto.id ? { ...e, byTransfer: true } : e));
    const excluded = d.entries.find((e) => e.name === 'Rata finanziamento')!;
    d.entries = d.entries.map((e) => (e.id === excluded.id ? { ...e, byTransfer: true, state: 'excluded' } : e));
    f.cycles.saveDraft('2026-11', d, BY);
    const id = d.entries.find((e) => e.recurringItemId === affitto.id)!.id;
    expect(code(() => f.cycles.setEntryPaid('2026-11', excluded.id, '2026-11-15', BY))).toBe('invalid');
    expect(code(() => f.cycles.setEntryPaid('2026-11', excluded.id, null, BY))).toBe('ok');
    expect(code(() => f.cycles.setEntryPaid('2026-11', id, '2026-11-08', BY))).toBe('ok');
    expect(code(() => f.cycles.setEntryPaid('2026-11', id, '2026-11-07', BY))).toBe('invalid');
  });
});

describe('history import', () => {
  const file = (entry: Record<string, unknown>) =>
    historyImportSchema.parse({
      cycles: [
        {
          month: '2026-09',
          plannedOn: '2026-09-10',
          endsOn: '2026-10-10',
          status: 'confirmed',
          balances: [{ account: 'Banca Blu', amountCents: 0, asOf: '2026-09-10' }],
          entries: [{ name: 'Stipendio', kind: 'income', account: 'Banca Blu', date: '2026-09-20', amountCents: 100, state: 'pending', origin: 'sporadic', ...entry }],
          transfers: [],
        },
      ],
    });

  it('an old history file reads back without the new fields', () => {
    const f = fill();
    f.cycles.importHistory(file({}), BY);
    const e = f.cycles.getCycle('2026-09').entries[0]!;
    expect(e).not.toHaveProperty('byTransfer');
    expect(e).not.toHaveProperty('paidOn');
  });

  it('does not store "paid by transfer" on an income (spec §1)', () => {
    const f = fill();
    const r = code(() => f.cycles.importHistory(file({ byTransfer: true, paidOn: '2026-09-15' }), BY));
    const stored = r === 'ok' ? f.cycles.getCycle('2026-09').entries[0] : undefined;
    expect(stored?.byTransfer).not.toBe(true);
  });
});
