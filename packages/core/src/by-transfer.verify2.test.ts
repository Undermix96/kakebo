import { describe, expect, it } from 'vitest';
import { monthCalendar, type CalendarCycle } from './reminders.ts';
import { historyImportSchema } from './cycle-record.ts';
import type { CycleEntry } from './types.ts';

// Second independent verification of §13 phase 5c. Invented data only.
const e = (over: Partial<CycleEntry>): CycleEntry => ({
  id: 'x',
  recurringItemId: null,
  name: 'X',
  kind: 'expense',
  accountId: 'b',
  date: '2026-11-10',
  amountCents: 1000,
  state: 'pending',
  origin: 'sporadic',
  ...over,
});

describe('calendar: a stamp never loses the expense (rule 5)', () => {
  it('a late stamp on a day the next confirmed cycle also covers still shows the expense once', () => {
    const nov: CalendarCycle = {
      month: '2026-11',
      plannedOn: '2026-10-25',
      endsOn: '2026-11-27',
      status: 'confirmed',
      entries: [e({ id: 'bol', name: 'Bolletta', date: '2026-11-10', byTransfer: true, paidOn: '2026-11-26' })],
      transfers: [],
    };
    // Next cycle planned (and confirmed) before the old one ended: its span starts at its plannedOn.
    const dec: CalendarCycle = {
      month: '2026-12',
      plannedOn: '2026-11-24',
      endsOn: '2026-12-27',
      status: 'confirmed',
      entries: [e({ id: 'aff', name: 'Affitto', date: '2026-12-01' })],
      transfers: [],
    };
    const base = { items: [], events: [], debts: [] } as never as Parameters<typeof monthCalendar>[1];
    const unstamped = monthCalendar('2026-11', { ...base, cycles: [{ ...nov, entries: [{ ...nov.entries[0]!, paidOn: null }] }, dec] });
    expect(unstamped.filter((i) => i.name === 'Bolletta')).toHaveLength(1);
    const stamped = monthCalendar('2026-11', { ...base, cycles: [nov, dec] });
    expect(stamped.filter((i) => i.name === 'Bolletta')).toEqual([expect.objectContaining({ date: '2026-11-26', done: true })]);
  });
});

describe('history import: byTransfer rules', () => {
  const file = (entry: Record<string, unknown>) => ({
    cycles: [
      {
        month: '2026-11',
        plannedOn: '2026-11-10',
        endsOn: '2026-12-10',
        status: 'confirmed',
        balances: [{ account: 'Conto B', amountCents: 0, asOf: '2026-11-10' }],
        entries: [
          { name: 'Bolletta', kind: 'expense', account: 'conto b', date: '2026-11-20', amountCents: 1000, state: 'pending', origin: 'sporadic', ...entry },
        ],
        transfers: [],
      },
    ],
  });
  it('account names match case-insensitively for the balance date', () => {
    expect(historyImportSchema.safeParse(file({ byTransfer: true, paidOn: '2026-11-09' })).success).toBe(false);
    expect(historyImportSchema.safeParse(file({ byTransfer: true, paidOn: '2026-11-10' })).success).toBe(true);
  });
  it('refuses a stamp without the flag, on an income, after the end', () => {
    expect(historyImportSchema.safeParse(file({ paidOn: '2026-11-12' })).success).toBe(false);
    expect(historyImportSchema.safeParse(file({ kind: 'income', byTransfer: true })).success).toBe(false);
    expect(historyImportSchema.safeParse(file({ byTransfer: true, paidOn: '2026-12-11' })).success).toBe(false);
  });
});
