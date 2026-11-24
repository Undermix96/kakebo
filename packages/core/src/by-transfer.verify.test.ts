import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { planCycle, type PlanInput } from './plan.ts';
import { cycleDraftSchema, historyImportSchema, planStoredCycle } from './cycle-record.ts';
import { defaultEntryState } from './cycle.ts';
import { monthCalendar } from './reminders.ts';
import { addDays } from './dates.ts';
import type { Account, CycleEntry } from './types.ts';

// Independent verification of §13 phase 5c. Invented data only.
const accounts: Account[] = [
  { id: 'a', name: 'Conto A', sort: 1, marginCents: 0, receivesLeftover: true },
  { id: 'b', name: 'Conto B', sort: 2, marginCents: 0, receivesLeftover: false },
];
const TODAY = '2026-11-10';
const END = '2026-12-10';
const exp: CycleEntry = {
  id: 'it@2026-11-20',
  recurringItemId: 'it',
  name: 'Bolletta',
  kind: 'expense',
  accountId: 'b',
  date: '2026-11-20',
  amountCents: 30000,
  state: 'pending',
  origin: 'catalog',
  byTransfer: true,
};
const inc: CycleEntry = { ...exp, id: 'stip', recurringItemId: null, name: 'Stipendio', kind: 'income', accountId: 'a', date: '2026-11-27', amountCents: 150000, origin: 'sporadic', byTransfer: undefined };
const input = (entries: CycleEntry[], asOf = TODAY): PlanInput => ({
  accounts,
  balances: [
    { accountId: 'a', amountCents: 100000, asOf },
    { accountId: 'b', amountCents: 0, asOf },
  ],
  entries,
  today: TODAY,
  end: END,
});

describe('engine edge cases', () => {
  it('a stamp on the last day of the cycle is in the cycle; the due date after the end with an in-cycle stamp counts', () => {
    const late = { ...exp, date: '2026-12-15', paidOn: END };
    const p = planCycle(input([late]));
    expect(p.warnings.find((w) => w.type === 'out_of_cycle')).toBeUndefined();
    expect(p.projection.find((r) => r.type === 'expense')).toMatchObject({ date: END, originalDate: '2026-12-15', paidOn: END });
  });

  it('suggested transfers cover a stamped expense by its paid day (early stamp)', () => {
    const early = planCycle(input([{ ...exp, paidOn: '2026-11-12' }]));
    const due = planCycle(input([exp]));
    // B must never go below zero in either case.
    for (const p of [early, due]) for (const d of p.daily) expect(d.balances.b).toBeGreaterThanOrEqual(0);
    expect(early.transfers.every((t) => t.date <= '2026-11-12')).toBe(true);
  });

  it('defaultEntryState: excluded stays excluded even when stamped', () => {
    expect(defaultEntryState({ ...exp, state: 'excluded', paidOn: '2026-11-01' }, input([]).balances)).toBe('excluded');
  });

  it('is deterministic', () => {
    const i = input([{ ...exp, paidOn: '2026-11-25' }, inc]);
    expect(JSON.stringify(planCycle(i))).toBe(JSON.stringify(planCycle(structuredClone(i))));
  });

  it('a stored confirmed cycle: un-stamping restores the exact numbers (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 40 }), (dueOff, paidOff) => {
        const e = { ...exp, date: addDays(TODAY, dueOff) };
        const rec = (entries: CycleEntry[]) => ({ plannedOn: TODAY, endsOn: END, status: 'confirmed' as const, balances: input([]).balances, entries, transfers: [] });
        const base = JSON.stringify(planStoredCycle(rec([e, inc]), accounts));
        const stamped = planStoredCycle(rec([{ ...e, paidOn: addDays(TODAY, paidOff) }, inc]), accounts);
        const total = (p: typeof stamped) => p.leftover.totalCents;
        // Unstamped (paidOn null) equals no field at all.
        expect(JSON.stringify(planStoredCycle(rec([{ ...e, paidOn: null }, inc]), accounts))).toBe(base);
        if (addDays(TODAY, paidOff) <= END) expect(total(stamped)).toBe(JSON.parse(base).leftover.totalCents);
      }),
      { numRuns: 100 },
    );
  });
});

describe('draft validation gaps', () => {
  const draft = (entries: CycleEntry[], asOf = TODAY) => ({ plannedOn: TODAY, endsOn: END, balances: input([], asOf).balances, entries });
  const ok = (entries: CycleEntry[]) => cycleDraftSchema.safeParse(draft(entries)).success;

  it('refuses a stamp before the balance date of the account (spec §3: from asOf to endsOn)', () => {
    // setEntryPaid refuses this day, the draft path should too.
    expect(ok([{ ...exp, paidOn: '2026-11-01' }])).toBe(false);
  });

  it('refuses a stamp on an entry that is not pending (spec §3: only pending expenses are stamped)', () => {
    expect(ok([{ ...exp, state: 'excluded', paidOn: '2026-11-15' }])).toBe(false);
  });
});

describe('history import validation gaps', () => {
  const file = (entry: Record<string, unknown>) => ({
    cycles: [
      {
        month: '2026-11',
        plannedOn: TODAY,
        endsOn: END,
        status: 'confirmed',
        balances: [{ account: 'Conto B', amountCents: 0, asOf: TODAY }],
        entries: [{ name: 'X', kind: 'income', account: 'Conto B', date: '2026-11-20', amountCents: 100, state: 'pending', origin: 'sporadic', ...entry }],
        transfers: [],
      },
    ],
  });

  it('accepts old files without the new fields', () => {
    expect(historyImportSchema.safeParse(file({})).success).toBe(true);
  });

  it('refuses byTransfer on an income and paidOn without byTransfer (spec §1)', () => {
    expect(historyImportSchema.safeParse(file({ byTransfer: true })).success).toBe(false);
    expect(historyImportSchema.safeParse(file({ kind: 'expense', paidOn: '2026-11-15' })).success).toBe(false);
  });
});

describe('calendar', () => {
  it('shows a stamp made on the balance date even when that day is before the planning day', () => {
    // Balance read on the 8th, planned on the 10th: setEntryPaid accepts the 8th.
    const cycle = {
      month: '2026-11',
      plannedOn: TODAY,
      endsOn: END,
      status: 'confirmed' as const,
      entries: [{ ...exp, paidOn: '2026-11-08' }],
      transfers: [],
    };
    const items = monthCalendar('2026-11', { items: [], events: [], debts: [], cycles: [cycle] });
    expect(items.find((i) => i.name === 'Bolletta')).toMatchObject({ date: '2026-11-08', done: true });
  });
});
