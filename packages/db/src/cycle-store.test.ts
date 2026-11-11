import { describe, expect, it } from 'vitest';
import {
  catalogImportSchema,
  cycleBounds,
  generateCycleEntries,
  planStoredCycle,
  withDefaultStates,
  type CycleDraft,
} from '@kakebo/core';
import example from '../fixtures/catalog.example.json' with { type: 'json' };
import { CatalogStore } from './catalog-store.ts';
import { CycleStore } from './cycle-store.ts';
import { openDatabase } from './open.ts';
import { StoreError } from './catalog-store.ts';

const BY = 'test@example.com';
const MONTH = '2026-11';
const TODAY = '2026-11-10';

function setup() {
  const { db, sqlite } = openDatabase({ file: ':memory:' });
  const catalog = new CatalogStore(db);
  catalog.importCatalog(catalogImportSchema.parse(example), BY);
  const accounts = catalog.listAccounts();
  const items = catalog.listItems();
  const bounds = cycleBounds(MONTH, TODAY);
  const balances = accounts.map((a, i) => ({ accountId: a.id, amountCents: i === 0 ? 30000 : 0, asOf: TODAY }));
  const entries = withDefaultStates(generateCycleEntries(items, bounds).entries, balances);
  const draft: CycleDraft = { plannedOn: TODAY, endsOn: bounds.end, balances, entries };
  return { sqlite, catalog, cycles: new CycleStore(db), accounts, items, draft };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreError ? e.code : String(e);
  }
  return 'ok';
};

describe('CycleStore', () => {
  it('saves a draft and reads it back unchanged', () => {
    const { cycles, draft } = setup();
    const saved = cycles.saveDraft(MONTH, draft, BY);
    expect(saved).toMatchObject({ month: MONTH, status: 'draft', imported: false, plannedOn: TODAY });
    expect(saved.balances).toEqual(expect.arrayContaining(draft.balances));
    expect(saved.entries.map((e) => e.id).sort()).toEqual(draft.entries.map((e) => e.id).sort());
    // Saving again replaces, it does not duplicate.
    const again = cycles.saveDraft(MONTH, { ...draft, entries: draft.entries.slice(1) }, BY);
    expect(again.entries).toHaveLength(draft.entries.length - 1);
    expect(cycles.listCycles()).toHaveLength(1);
  });

  it('keeps the planned day of an entry moved for this cycle only', () => {
    const { cycles, draft } = setup();
    const [first, ...rest] = draft.entries;
    const moved = { ...first!, date: '2026-11-20', plannedDate: first!.date };
    const saved = cycles.saveDraft(MONTH, { ...draft, entries: [moved, ...rest] }, BY);
    expect(saved.entries.find((e) => e.id === first!.id)).toMatchObject({ date: '2026-11-20', plannedDate: first!.date });
    expect(saved.entries.filter((e) => e.id !== first!.id).every((e) => e.plannedDate === null)).toBe(true);
  });

  it('allows the same catalog occurrence in two cycles', () => {
    const { cycles, draft } = setup();
    cycles.saveDraft(MONTH, draft, BY);
    expect(code(() => cycles.saveDraft('2026-12', draft, BY))).toBe('ok');
  });

  it('confirms with transfers, updates "last" amounts, and keeps stamps on reopen', () => {
    const { cycles, catalog, accounts, items, draft } = setup();
    const spesa = items.find((i) => i.name === 'Spesa')!; // amountMode "last"
    const entries = draft.entries.map((e) => (e.recurringItemId === spesa.id ? { ...e, amountCents: 45000 } : e));
    cycles.saveDraft(MONTH, { ...draft, entries }, BY);
    const plan = planStoredCycle({ ...draft, entries, status: 'draft', transfers: [] }, accounts);
    expect(plan.transfers.length).toBeGreaterThan(0);

    const { cycle, updatedItems } = cycles.confirm(MONTH, { transfers: plan.transfers }, BY);
    expect(cycle.status).toBe('confirmed');
    expect(cycle.confirmedAt).not.toBeNull();
    expect(cycle.transfers).toHaveLength(plan.transfers.length);
    expect(updatedItems).toBeGreaterThanOrEqual(1);
    expect(catalog.getItem(spesa.id).amountCents).toBe(45000);

    // A confirmed cycle is read only until it is reopened.
    expect(code(() => cycles.saveDraft(MONTH, draft, BY))).toBe('conflict');
    expect(code(() => cycles.confirm(MONTH, { transfers: [] }, BY))).toBe('conflict');

    const first = cycle.transfers[0]!;
    const stamped = cycles.setTransferDone(first.id, TODAY, BY);
    expect(stamped.transfers.find((t) => t.id === first.id)?.doneOn).toBe(TODAY);

    const reopened = cycles.reopen(MONTH, BY);
    expect(reopened.status).toBe('draft');
    expect(reopened.transfers.map((t) => t.id)).toEqual([first.id]);
    // The stamped one survives a new confirmation.
    const again = cycles.confirm(MONTH, { transfers: [] }, BY).cycle;
    expect(again.transfers.map((t) => t.id)).toEqual([first.id]);
    // ...and makes the draft impossible to throw away.
    cycles.reopen(MONTH, BY);
    expect(code(() => cycles.deleteDraft(MONTH))).toBe('conflict');
  });

  it('rejects transfers between accounts outside the cycle or after its end', () => {
    const { cycles, draft, accounts } = setup();
    cycles.saveDraft(MONTH, { ...draft, balances: draft.balances.slice(0, 2), entries: [] }, BY);
    const [a, b, c] = accounts;
    const t = { fromAccountId: a!.id, toAccountId: c!.id, amountCents: 100, date: TODAY, dueDate: TODAY };
    expect(code(() => cycles.confirm(MONTH, { transfers: [t] }, BY))).toBe('invalid');
    const late = { ...t, toAccountId: b!.id, dueDate: '2027-01-01' };
    expect(code(() => cycles.confirm(MONTH, { transfers: [late] }, BY))).toBe('invalid');
  });

  it('deletes a draft but not a confirmed cycle', () => {
    const { cycles, draft } = setup();
    cycles.saveDraft(MONTH, draft, BY);
    cycles.deleteDraft(MONTH);
    expect(cycles.listCycles()).toEqual([]);
    cycles.saveDraft(MONTH, draft, BY);
    cycles.confirm(MONTH, { transfers: [] }, BY);
    expect(code(() => cycles.deleteDraft(MONTH))).toBe('conflict');
  });

  it('rejects entries of unknown catalog items with a readable error', () => {
    const { cycles, draft } = setup();
    const bad = { ...draft, entries: [{ ...draft.entries[0]!, recurringItemId: 'nope' }] };
    expect(code(() => cycles.saveDraft(MONTH, bad, BY))).toBe('invalid');
  });

  it('imports the history all or nothing, matching accounts and items by name', () => {
    const { cycles } = setup();
    const file = {
      cycles: [
        {
          month: '2026-09',
          plannedOn: '2026-09-10',
          endsOn: '2026-10-10',
          status: 'confirmed' as const,
          balances: [{ account: 'banca blu', amountCents: 3500, asOf: '2026-09-10' }],
          entries: [
            { name: 'Affitto', item: 'Affitto', kind: 'expense' as const, account: 'Banca Blu', date: '2026-09-30', amountCents: 65000, state: 'pending' as const, origin: 'catalog' as const },
            { name: 'Pizzeria', kind: 'expense' as const, account: 'Banca Blu', date: '2026-09-12', amountCents: 3000, state: 'pending' as const, origin: 'past_movement' as const },
          ],
          transfers: [{ from: 'Banca Viola', to: 'Banca Blu', amountCents: 125000, date: '2026-09-10', dueDate: '2026-09-10', doneOn: '2026-09-10' }],
        },
      ],
      debts: [{ date: '2026-04-14', description: 'Gita', amountCents: 18750 }],
      calendarEvents: [{ type: 'birthday' as const, title: 'Compleanno di Z.', month: 3, day: 9 }],
    };
    expect(cycles.importHistory(file, BY)).toEqual({ cycles: 1, debts: 1, calendarEvents: 1 });
    const sep = cycles.getCycle('2026-09');
    expect(sep).toMatchObject({ imported: true, status: 'confirmed' });
    expect(sep.entries.find((e) => e.name === 'Affitto')?.recurringItemId).not.toBeNull();
    expect(sep.entries.find((e) => e.name === 'Pizzeria')?.recurringItemId).toBeNull();
    expect(sep.transfers[0]?.doneOn).toBe('2026-09-10');
    expect(cycles.listDebts()).toHaveLength(1);
    expect(cycles.listCalendarEvents()).toHaveLength(1);

    // Same file again: nothing written.
    expect(code(() => cycles.importHistory(file, BY))).toBe('conflict');
    expect(cycles.listDebts()).toHaveLength(1);
    const unknown = { ...file, debts: [], calendarEvents: [], cycles: [{ ...file.cycles[0]!, month: '2026-10', balances: [{ account: 'Nessuno', amountCents: 0, asOf: '2026-10-10' }] }] };
    expect(code(() => cycles.importHistory(unknown, BY))).toBe('invalid');
    expect(cycles.listCycles()).toHaveLength(1);
  });
});
