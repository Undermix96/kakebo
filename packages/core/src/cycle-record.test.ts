import { describe, expect, it } from 'vitest';
import { cycleBounds, generateCycleEntries, withDefaultStates } from './cycle.ts';
import { planCycle } from './plan.ts';
import { exampleCycle as fx } from './fixtures/golden.ts';
import { cycleDraftSchema, cycleTotals, historyImportSchema, planStoredCycle, type StoredTransfer } from './cycle-record.ts';

const bounds = cycleBounds(fx.month, fx.plannedOn);
const entries = withDefaultStates([...generateCycleEntries(fx.catalog, bounds).entries, ...fx.sporadic], fx.balances);
const fresh = planCycle({ accounts: fx.accounts, balances: fx.balances, entries, today: fx.plannedOn, end: bounds.end });
const stored: StoredTransfer[] = fresh.transfers.map((t, i) => ({ ...t, id: `t${i}`, doneOn: null }));
const record = {
  plannedOn: fx.plannedOn,
  endsOn: bounds.end,
  balances: fx.balances,
  entries,
  transfers: stored,
};

describe('planStoredCycle', () => {
  it('replays a confirmed cycle exactly, without new suggestions', () => {
    const replay = planStoredCycle({ ...record, status: 'confirmed' }, fx.accounts);
    expect(replay.transfers).toEqual([]);
    expect(replay.daily).toEqual(fresh.daily);
    expect(replay.leftover.totalCents).toBe(fresh.leftover.totalCents);
  });

  it('places a stamped transfer on the day it was made', () => {
    const late = stored.map((t, i) => (i === 0 ? { ...t, doneOn: bounds.end } : t));
    const replay = planStoredCycle({ ...record, status: 'confirmed', transfers: late }, fx.accounts);
    const row = replay.projection.find((r) => r.type === 'transfer' && r.amountCents === late[0]!.amountCents);
    expect(row?.date).toBe(bounds.end);
  });

  it('keeps a transfer stamped early on its planned day', () => {
    const late = stored.find((t) => t.date > fx.plannedOn)!;
    const early = stored.map((t) => (t === late ? { ...t, doneOn: fx.plannedOn } : t));
    const replay = planStoredCycle({ ...record, status: 'confirmed', transfers: early }, fx.accounts);
    expect(replay.daily).toEqual(fresh.daily);
  });

  it('in a reopened draft keeps the stamped transfers and suggests the rest', () => {
    const done = stored.map((t, i) => ({ ...t, doneOn: i === 0 ? fx.plannedOn : null }));
    const draft = planStoredCycle({ ...record, status: 'draft', transfers: done }, fx.accounts);
    const suggested = draft.transfers.reduce((s, t) => s + t.amountCents, 0);
    const total = fresh.transfers.reduce((s, t) => s + t.amountCents, 0);
    expect(suggested).toBeLessThan(total);
    expect(draft.warnings.filter((w) => w.type === 'account_shortfall')).toEqual([]);
  });
});

describe('cycleTotals', () => {
  it('counts only pending entries with an amount', () => {
    const t = cycleTotals([
      { id: 'a', name: 'a', kind: 'income', accountId: 'x', date: '2026-11-10', amountCents: 100, state: 'pending', origin: 'catalog' },
      { id: 'b', name: 'b', kind: 'expense', accountId: 'x', date: '2026-11-10', amountCents: 40, state: 'pending', origin: 'catalog' },
      { id: 'c', name: 'c', kind: 'expense', accountId: 'x', date: '2026-11-10', amountCents: 40, state: 'excluded', origin: 'catalog' },
      { id: 'd', name: 'd', kind: 'expense', accountId: 'x', date: '2026-11-10', amountCents: null, state: 'pending', origin: 'catalog' },
    ]);
    expect(t).toEqual({ incomeCents: 100, expenseCents: 40, incomes: 1, expenses: 1 });
  });
});

describe('schemas', () => {
  it('rejects a balance dated after the planning day', () => {
    const r = cycleDraftSchema.safeParse({
      plannedOn: '2026-11-10',
      endsOn: '2026-12-10',
      balances: [{ accountId: 'a', amountCents: 0, asOf: '2026-11-11' }],
      entries: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a history file with the same month twice', () => {
    const cycle = {
      month: '2026-09',
      plannedOn: '2026-09-10',
      endsOn: '2026-10-10',
      status: 'confirmed',
      balances: [{ account: 'A', amountCents: 0, asOf: '2026-09-10' }],
      entries: [],
      transfers: [],
    };
    expect(historyImportSchema.safeParse({ cycles: [cycle] }).success).toBe(true);
    expect(historyImportSchema.safeParse({ cycles: [cycle, cycle] }).success).toBe(false);
  });
});
