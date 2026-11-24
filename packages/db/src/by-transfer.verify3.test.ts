import { describe, expect, it } from 'vitest';
import { catalogImportSchema, cycleBounds, generateCycleEntries, historyImportSchema, withDefaultStates, type CycleDraft } from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore, StoreError } from './catalog-store.ts';
import { CycleStore } from './cycle-store.ts';
import { openDatabase } from './open.ts';

// Third independent verification of §13 phase 5c (rules B, C). Invented data only.
const BY = 'test@example.com';

function fill() {
  const opened = openDatabase({ file: ':memory:' });
  const catalog = new CatalogStore(opened.db);
  catalog.importCatalog(catalogImportSchema.parse(example), BY);
  const accounts = catalog.listAccounts();
  const draftFor = (month: string, today: string): CycleDraft => {
    const items = catalog.listItems();
    const bounds = cycleBounds(month, today);
    const balances = accounts.map((a) => ({ accountId: a.id, amountCents: 100000, asOf: today }));
    return { plannedOn: today, endsOn: bounds.end, balances, entries: withDefaultStates(generateCycleEntries(items, bounds).entries, balances) };
  };
  return { catalog, cycles: new CycleStore(opened.db), accounts, draftFor };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreError ? `${e.code}: ${e.message}` : String(e);
  }
  return 'ok';
};
const item = (f: ReturnType<typeof fill>, name: string) => f.catalog.listItems().find((i) => i.name === name)!;

function stampedLuce(confirm = true) {
  const f = fill();
  const luce = item(f, 'Luce');
  f.catalog.updateItem(luce.id, { byTransfer: true }, BY, '2026-11-10');
  f.cycles.saveDraft('2026-11', f.draftFor('2026-11', '2026-11-10'), BY);
  if (confirm) f.cycles.confirm('2026-11', { transfers: [] }, BY);
  const entry = f.cycles.getCycle('2026-11').entries.find((e) => e.recurringItemId === luce.id && e.state === 'pending')!;
  f.cycles.setEntryPaid('2026-11', entry.id, '2026-11-12', BY);
  return { ...f, luce, entry };
}

const histCycle = (month: string, entries: unknown[]) => ({
  month,
  plannedOn: `${month}-10`,
  endsOn: `${month}-28`,
  status: 'confirmed',
  balances: [{ account: 'Carta Spesa', amountCents: 0, asOf: `${month}-10` }, { account: 'Banca Blu', amountCents: 0, asOf: `${month}-10` }],
  entries,
  transfers: [],
});

describe('rule B: history import', () => {
  it('is all-or-nothing: an envelope byTransfer in the 2nd cycle leaves no cycle and no debt', () => {
    const f = fill();
    const file = historyImportSchema.parse({
      cycles: [
        histCycle('2025-10', [{ name: 'Luce', item: 'Luce', kind: 'expense', account: 'Banca Blu', date: '2025-10-12', amountCents: 8000, state: 'pending', origin: 'catalog', byTransfer: true }]),
        histCycle('2025-11', [{ name: 'Spesa', item: 'spesa', kind: 'expense', account: 'Carta Spesa', date: '2025-11-11', amountCents: 500, state: 'pending', origin: 'catalog', byTransfer: true }]),
      ],
      debts: [{ description: 'Prestito', amountCents: 100, date: '2025-11-01' }],
    });
    expect(code(() => f.cycles.importHistory(file, BY))).toMatch(/^invalid: /);
    expect(f.cycles.listCycles()).toEqual([]);
    expect(f.cycles.listDebts()).toEqual([]);
  });

  it('still accepts byTransfer on a non-envelope item and on an unmatched name', () => {
    const f = fill();
    const file = historyImportSchema.parse({
      cycles: [
        histCycle('2025-10', [
          { name: 'Luce', item: 'Luce', kind: 'expense', account: 'Banca Blu', date: '2025-10-12', amountCents: 8000, state: 'pending', origin: 'catalog', byTransfer: true, paidOn: '2025-10-12' },
          { name: 'Altro', item: 'Non esiste', kind: 'expense', account: 'Banca Blu', date: '2025-10-13', amountCents: 100, state: 'pending', origin: 'sporadic', byTransfer: true },
        ]),
      ],
    });
    expect(code(() => f.cycles.importHistory(file, BY))).toBe('ok');
    const es = f.cycles.getCycle('2025-10').entries;
    expect(es.find((e) => e.name === 'Luce')).toMatchObject({ byTransfer: true, paidOn: '2025-10-12' });
  });
});

describe('rule C: item to envelope', () => {
  it('refused in a draft too, and the refusal writes nothing', () => {
    const f = stampedLuce(false);
    expect(code(() => f.catalog.updateItem(f.luce.id, { byTransfer: false, envelope: true }, BY, '2026-11-12'))).toMatch(/^conflict: /);
    expect(item(f, 'Luce')).toMatchObject({ envelope: false, byTransfer: true });
  });

  it('refused when the item was unflagged earlier but the stamped entry is still there', () => {
    const f = stampedLuce();
    expect(code(() => f.catalog.updateItem(f.luce.id, { byTransfer: false }, BY, '2026-11-12'))).toBe('ok');
    expect(f.cycles.getCycle('2026-11').entries.find((e) => e.id === f.entry.id)).toMatchObject({ byTransfer: true, paidOn: '2026-11-12' });
    expect(code(() => f.catalog.updateItem(f.luce.id, { envelope: true }, BY, '2026-11-12'))).toMatch(/^conflict: /);
  });

  it('allowed once the stamp is removed, and allowed after the cycle ended', () => {
    const a = stampedLuce();
    a.cycles.setEntryPaid('2026-11', a.entry.id, null, BY);
    expect(code(() => a.catalog.updateItem(a.luce.id, { byTransfer: false, envelope: true }, BY, '2026-11-12'))).toBe('ok');
    const b = stampedLuce();
    const after = b.cycles.getCycle('2026-11').endsOn.replace(/\d\d$/, (d) => String(Number(d) + 1).padStart(2, '0'));
    expect(code(() => b.catalog.updateItem(b.luce.id, { byTransfer: false, envelope: true }, BY, after))).toBe('ok');
    const endDay = b.cycles.getCycle('2026-11').endsOn;
    const c = stampedLuce();
    expect(code(() => c.catalog.updateItem(c.luce.id, { byTransfer: false, envelope: true }, BY, endDay))).toMatch(/^conflict: /);
  });

  it('an entry still flagged after its item became an envelope cannot then be stamped', () => {
    // Item never flagged; entry flagged by hand in step 3 ("con bonifico"), not stamped.
    const f = fill();
    const luce = item(f, 'Luce');
    const d = f.draftFor('2026-11', '2026-11-10');
    const target = d.entries.find((e) => e.recurringItemId === luce.id && e.state === 'pending')!;
    f.cycles.saveDraft('2026-11', { ...d, entries: d.entries.map((e) => (e.id === target.id ? { ...e, byTransfer: true } : e)) }, BY);
    f.cycles.confirm('2026-11', { transfers: [] }, BY);
    expect(code(() => f.catalog.updateItem(luce.id, { envelope: true }, BY, '2026-11-12'))).toBe('ok');
    // Now the entry belongs to an envelope: stamping it would recreate the state rule C refuses.
    expect(code(() => f.cycles.setEntryPaid('2026-11', target.id, '2026-11-12', BY))).toMatch(/^invalid/);
  });
});
