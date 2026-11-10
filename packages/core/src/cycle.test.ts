import { describe, expect, it } from 'vitest';
import {
  cycleBounds,
  cycleMonthFor,
  defaultEntryState,
  generateCycleEntries,
  lastUsedAmounts,
  occursInMonth,
} from './cycle.ts';
import type { CycleEntry, RecurringItem } from './types.ts';

const item = (over: Partial<RecurringItem>): RecurringItem => ({
  id: 'x',
  kind: 'expense',
  name: 'X',
  accountId: 'a',
  day: 15,
  schedule: { type: 'monthly' },
  amountMode: 'fixed',
  amountCents: 1000,
  ...over,
});

describe('schedules', () => {
  it('matches months', () => {
    expect(occursInMonth({ type: 'monthly' }, '2026-11')).toBe(true);
    expect(occursInMonth({ type: 'yearly', month: 5 }, '2026-05')).toBe(true);
    expect(occursInMonth({ type: 'yearly', month: 5 }, '2026-06')).toBe(false);
    expect(occursInMonth({ type: 'months', months: [2, 5, 8, 11] }, '2026-11')).toBe(true);
    expect(occursInMonth({ type: 'months', months: [2, 5, 8, 11] }, '2026-12')).toBe(false);
  });

  it('counts every N months from the start month, across years', () => {
    const s = { type: 'every_n_months' as const, n: 2, startMonth: '2026-09' };
    expect(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map((m) => occursInMonth(s, m))).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });
});

describe('cycle bounds', () => {
  it('runs to the 10th of the next month and starts on the 10th or on the planning day if earlier', () => {
    expect(cycleBounds('2026-11', '2026-11-09')).toEqual({ month: '2026-11', start: '2026-11-09', end: '2026-12-10' });
    expect(cycleBounds('2026-11', '2026-11-15')).toEqual({ month: '2026-11', start: '2026-11-10', end: '2026-12-10' });
    expect(cycleBounds('2026-12', '2026-12-10')).toEqual({ month: '2026-12', start: '2026-12-10', end: '2027-01-10' });
  });

  it('supports a different end day', () => {
    expect(cycleBounds('2026-11', '2026-11-20', 15).end).toBe('2026-12-15');
  });

  it('assigns a planning day to a cycle', () => {
    expect(cycleMonthFor('2026-11-09')).toBe('2026-11');
    expect(cycleMonthFor('2026-11-20')).toBe('2026-11');
    expect(cycleMonthFor('2026-12-03')).toBe('2026-11');
    expect(cycleMonthFor('2027-01-05')).toBe('2026-12');
  });
});

describe('generateCycleEntries', () => {
  const bounds = cycleBounds('2026-11', '2026-11-09');

  it('counts expenses by date, including next month up to the end day', () => {
    const { entries } = generateCycleEntries([item({ id: 'ins', day: 10 })], bounds);
    expect(entries.map((e) => e.date)).toEqual(['2026-11-10', '2026-12-10']);
    const { entries: late } = generateCycleEntries([item({ id: 'late', day: 11 })], bounds);
    expect(late.map((e) => e.date)).toEqual(['2026-11-11']);
  });

  it("counts incomes once per cycle and never next cycle's", () => {
    const { entries } = generateCycleEntries([item({ id: 'salary', kind: 'income', day: 8 })], bounds);
    // 8 November (before the plan: asked about later) but not 8 December.
    expect(entries.map((e) => e.date)).toEqual(['2026-11-08']);
  });

  it('clamps days 29–31 to the last day of the month', () => {
    const { entries } = generateCycleEntries([item({ day: 31 })], bounds);
    expect(entries.map((e) => e.date)).toEqual(['2026-11-30']);
  });

  it('skips archived items, inactive periods and months outside the schedule', () => {
    const { entries } = generateCycleEntries(
      [
        item({ id: 'arch', archived: true }),
        item({ id: 'ended', activeTo: '2026-10-31' }),
        item({ id: 'future', activeFrom: '2026-12-01' }),
        item({ id: 'may', schedule: { type: 'yearly', month: 5 } }),
        item({ id: 'dec', day: 5, schedule: { type: 'yearly', month: 12 } }),
      ],
      bounds,
    );
    expect(entries.map((e) => e.id)).toEqual(['dec@2026-12-05']);
  });

  it('flags missing amounts and days instead of inventing them', () => {
    const { entries, warnings } = generateCycleEntries(
      [item({ id: 'telepass', amountCents: null, day: 30 }), item({ id: 'bollo', day: null, schedule: { type: 'yearly', month: 12 } })],
      bounds,
    );
    expect(entries.find((e) => e.recurringItemId === 'telepass')?.amountCents).toBeNull();
    expect(warnings).toEqual([
      { type: 'missing_amount', recurringItemId: 'telepass', date: '2026-11-30' },
      { type: 'missing_day', recurringItemId: 'bollo', date: '2026-12-01' },
    ]);
  });
});

describe('entry states', () => {
  const entry = (date: string, state: CycleEntry['state'] = 'pending'): CycleEntry => ({
    id: date,
    name: 'X',
    kind: 'expense',
    accountId: 'a',
    date,
    amountCents: 100,
    state,
    origin: 'catalog',
  });
  const balances = [{ accountId: 'a', amountCents: 0, asOf: '2026-11-15' }];

  it('assumes entries before the balance date are already in it', () => {
    expect(defaultEntryState(entry('2026-11-11'), balances)).toBe('included_in_balance');
    expect(defaultEntryState(entry('2026-11-15'), balances)).toBe('pending');
    expect(defaultEntryState(entry('2026-11-20', 'excluded'), balances)).toBe('excluded');
  });
});

describe('lastUsedAmounts', () => {
  it('returns the amounts of "last" items for the next proposal', () => {
    const catalog = [item({ id: 'spesa', amountMode: 'last' }), item({ id: 'mutuo', amountMode: 'fixed' })];
    const e = (id: string, recurringItemId: string, date: string, amountCents: number): CycleEntry => ({
      id,
      recurringItemId,
      name: id,
      kind: 'expense',
      accountId: 'a',
      date,
      amountCents,
      state: 'pending',
      origin: 'catalog',
    });
    const result = lastUsedAmounts(catalog, [
      e('1', 'spesa', '2026-11-11', 70000),
      e('2', 'mutuo', '2026-11-30', 28465),
      e('3', 'spesa', '2026-12-01', 65000),
    ]);
    expect([...result]).toEqual([['spesa', 65000]]);
  });
});
