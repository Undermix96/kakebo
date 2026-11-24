import { describe, expect, it } from 'vitest';
import { catalogImportSchema, cycleBounds, generateCycleEntries, historyImportSchema, withDefaultStates, type CycleDraft } from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore, StoreError } from './catalog-store.ts';
import { CycleStore } from './cycle-store.ts';
import { openDatabase } from './open.ts';

// Second independent verification of §13 phase 5c. Invented data only (the example catalog).
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

/** A confirmed November cycle with "Luce" paid by transfer and stamped on 2026-11-12. */
function stampedLuce() {
  const f = fill();
  const luce = f.catalog.listItems().find((i) => i.name === 'Luce')!;
  f.catalog.updateItem(luce.id, { byTransfer: true }, BY, '2026-11-10');
  f.cycles.saveDraft('2026-11', f.draftFor('2026-11', '2026-11-10'), BY);
  f.cycles.confirm('2026-11', { transfers: [] }, BY);
  const entry = f.cycles.getCycle('2026-11').entries.find((e) => e.recurringItemId === luce.id && e.state === 'pending')!;
  f.cycles.setEntryPaid('2026-11', entry.id, '2026-11-12', BY);
  return { ...f, luce, entry };
}

describe('every write path refuses byTransfer on an envelope (rules 1, 3)', () => {
  it('history import: an entry of the envelope item "Spesa" flagged byTransfer', () => {
    const f = fill();
    const file = historyImportSchema.parse({
      cycles: [
        {
          month: '2025-11',
          plannedOn: '2025-11-10',
          endsOn: '2025-12-10',
          status: 'confirmed',
          balances: [{ account: 'Carta Spesa', amountCents: 0, asOf: '2025-11-10' }],
          entries: [
            { name: 'Spesa', item: 'Spesa', kind: 'expense', account: 'Carta Spesa', date: '2025-11-11', amountCents: 50000, state: 'pending', origin: 'catalog', byTransfer: true },
          ],
          transfers: [],
        },
      ],
    });
    expect(code(() => f.cycles.importHistory(file, BY))).toMatch(/^invalid/);
  });
});

// Resolution chosen (phase 5c): the envelope change is refused while a stamp is in a cycle
// not ended, so no cycle is left unsaveable; the cycle still saves unchanged.
describe('turning a byTransfer item into an envelope after a stamp', () => {
  it('is refused while the stamp is in a cycle not ended, and the reopened cycle still saves', () => {
    const f = stampedLuce();
    expect(code(() => f.catalog.updateItem(f.luce.id, { byTransfer: false, envelope: true }, BY, '2026-11-12'))).toMatch(/^conflict: /);
    const r = f.cycles.reopen('2026-11', BY);
    expect(code(() => f.cycles.saveDraft('2026-11', { plannedOn: '2026-11-12', endsOn: r.endsOn, balances: r.balances, entries: r.entries }, BY))).toBe('ok');
  });
});

// Resolution chosen (phase 5c): moving the balance date past a stamp makes the entry
// "already in the balance" in the wizard (applyDefaultStates); the server keeps refusing
// a pending entry stamped before its balance date (rule 3).
describe('balance date moved after an existing stamp (web Plan step 1 on a reopened cycle)', () => {
  it('a pending stamp before the balance date is refused; the same entry already in the balance is accepted', () => {
    const f = stampedLuce();
    const r = f.cycles.reopen('2026-11', BY);
    const balances = r.balances.map((b) => ({ ...b, asOf: '2026-11-14' }));
    const draft = (entries: typeof r.entries) => ({ plannedOn: '2026-11-14', endsOn: r.endsOn, balances, entries });
    expect(code(() => f.cycles.saveDraft('2026-11', draft(r.entries), BY))).toContain('il giorno del pagamento è prima della data del saldo');
    const asWizard = r.entries.map((e) => (e.state === 'pending' && e.paidOn && e.paidOn < '2026-11-14' ? { ...e, state: 'included_in_balance' as const } : e));
    expect(code(() => f.cycles.saveDraft('2026-11', draft(asWizard), BY))).toBe('ok');
  });
});
