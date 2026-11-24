import { describe, expect, it } from 'vitest';
import { planCycle, type PlanInput } from './plan.ts';
import { cycleDraftSchema, planStoredCycle, type CycleRecord } from './cycle-record.ts';
import { cycleBounds, defaultEntryState, entryDay, generateCycleEntries } from './cycle.ts';
import { itemCreateSchema } from './catalog.ts';
import { recurringItemSchema } from './schemas.ts';
import { monthCalendar } from './reminders.ts';
import type { Account, CycleEntry, RecurringItem } from './types.ts';

// §13 phase 5c. Invented case (no real data): "Conto Casa" has 500,00 on the 10th;
// "Asilo" (200,00, due on the 20th) is paid with a transfer made by hand.
const accounts: Account[] = [{ id: 'casa', name: 'Conto Casa', sort: 1, marginCents: 0, receivesLeftover: true }];
const TODAY = '2026-11-10';
const END = '2026-12-10';

const asilo: CycleEntry = {
  id: 'item-asilo@2026-11-20',
  recurringItemId: 'item-asilo',
  name: 'Asilo',
  kind: 'expense',
  accountId: 'casa',
  date: '2026-11-20',
  amountCents: 20000,
  state: 'pending',
  origin: 'catalog',
  byTransfer: true,
};

const input = (entry: CycleEntry): PlanInput => ({
  accounts,
  balances: [{ accountId: 'casa', amountCents: 50000, asOf: TODAY }],
  entries: [entry],
  today: TODAY,
  end: END,
});

const balanceOn = (p: ReturnType<typeof planCycle>, d: string) => p.daily.find((x) => x.date === d)!.balances.casa;

describe('expense paid by a transfer', () => {
  it('stays on its due day until it is stamped', () => {
    const p = planCycle(input(asilo));
    expect(balanceOn(p, '2026-11-15')).toBe(50000);
    expect(balanceOn(p, '2026-11-19')).toBe(50000);
    expect(balanceOn(p, '2026-11-20')).toBe(30000);
  });

  it('leaves the account on the day it was paid when stamped early', () => {
    const p = planCycle(input({ ...asilo, paidOn: '2026-11-15' }));
    expect(balanceOn(p, '2026-11-14')).toBe(50000);
    expect(balanceOn(p, '2026-11-15')).toBe(30000);
    expect(balanceOn(p, '2026-11-20')).toBe(30000);
    const row = p.projection.find((r) => r.type === 'expense')!;
    expect(row).toMatchObject({ date: '2026-11-15', originalDate: '2026-11-20', paidOn: '2026-11-15', amountCents: -20000 });
    expect(p.leftover.totalCents).toBe(30000);
  });

  it('leaves the account on the day it was paid when stamped late', () => {
    const p = planCycle(input({ ...asilo, paidOn: '2026-11-22' }));
    expect(balanceOn(p, '2026-11-21')).toBe(50000);
    expect(balanceOn(p, '2026-11-22')).toBe(30000);
  });

  it('counts a stamp before the balance date on the balance date, like any entry still to pay', () => {
    const p = planCycle(input({ ...asilo, paidOn: '2026-11-08' }));
    expect(p.projection.find((r) => r.type === 'expense')!.date).toBe(TODAY);
  });

  it('answers "already in the balance?" with the day it was paid', () => {
    const balances = [{ accountId: 'casa', amountCents: 30000, asOf: '2026-11-16' }];
    expect(defaultEntryState(asilo, balances)).toBe('pending');
    expect(defaultEntryState({ ...asilo, paidOn: '2026-11-15' }, balances)).toBe('included_in_balance');
    expect(entryDay({ ...asilo, paidOn: '2026-11-15' })).toBe('2026-11-15');
    expect(entryDay(asilo)).toBe(asilo.date);
  });

  it('moves the money of a stored confirmed cycle without suggesting new transfers', () => {
    const record: Pick<CycleRecord, 'plannedOn' | 'endsOn' | 'status' | 'balances' | 'entries' | 'transfers'> = {
      plannedOn: TODAY,
      endsOn: END,
      status: 'confirmed',
      balances: [{ accountId: 'casa', amountCents: 50000, asOf: TODAY }],
      entries: [{ ...asilo, paidOn: '2026-11-15' }],
      transfers: [],
    };
    const p = planStoredCycle(record, accounts);
    expect(balanceOn(p, '2026-11-15')).toBe(30000);
    expect(p.transfers).toEqual([]);
  });
});

describe('the catalog flag', () => {
  const item = (over: Partial<RecurringItem>): RecurringItem => ({
    id: 'item-asilo',
    kind: 'expense',
    name: 'Asilo',
    accountId: 'casa',
    day: 20,
    schedule: { type: 'monthly' },
    amountMode: 'fixed',
    amountCents: 20000,
    ...over,
  });

  it('is copied to the cycle entries of expenses only, and left out otherwise', () => {
    const bounds = cycleBounds('2026-11', TODAY);
    const [flagged] = generateCycleEntries([item({ byTransfer: true })], bounds).entries;
    expect(flagged!.byTransfer).toBe(true);
    const [plain] = generateCycleEntries([item({})], bounds).entries;
    expect(plain).not.toHaveProperty('byTransfer');
    const [income] = generateCycleEntries([item({ kind: 'income', byTransfer: true })], bounds).entries;
    expect(income).not.toHaveProperty('byTransfer');
  });

  it('is refused on incomes and envelopes, and optional in requests and files', () => {
    const base = { kind: 'expense', name: 'Asilo', accountId: 'casa', day: 20, schedule: { type: 'monthly' }, amountMode: 'fixed', amountCents: 20000 } as const;
    expect(itemCreateSchema.safeParse({ ...base, byTransfer: true }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ ...base, kind: 'income', byTransfer: true }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...base, envelope: true, byTransfer: true }).success).toBe(false);
    expect(recurringItemSchema.safeParse({ ...base, id: 'x', envelope: true, byTransfer: true }).success).toBe(false);
    expect(itemCreateSchema.safeParse(base).success).toBe(true);
  });
});

describe('cycle draft validation', () => {
  const draft = (entries: CycleEntry[]) => ({
    plannedOn: TODAY,
    endsOn: END,
    balances: [{ accountId: 'casa', amountCents: 50000, asOf: TODAY }],
    entries,
  });
  const ok = (entries: CycleEntry[]) => cycleDraftSchema.safeParse(draft(entries)).success;

  it('accepts flagged and stamped expenses, and drafts without the new fields', () => {
    expect(ok([asilo])).toBe(true);
    expect(ok([{ ...asilo, paidOn: '2026-11-15' }])).toBe(true);
    expect(ok([{ ...asilo, origin: 'sporadic', recurringItemId: null }])).toBe(true);
    const { byTransfer: _b, ...plain } = asilo;
    expect(ok([plain])).toBe(true);
  });

  it('refuses the flag where nothing is left to pay, and a stamp without the flag or after the cycle', () => {
    expect(ok([{ ...asilo, kind: 'income' }])).toBe(false);
    expect(ok([{ ...asilo, origin: 'past_movement', recurringItemId: null }])).toBe(false);
    const envelope: CycleEntry = { ...asilo, id: 'busta', byTransfer: false };
    expect(ok([envelope, { ...asilo, id: 'b1', origin: 'past_movement', recurringItemId: null, envelopeEntryId: 'busta' }])).toBe(false);
    expect(ok([{ ...asilo, byTransfer: false, paidOn: '2026-11-15' }])).toBe(false);
    expect(ok([{ ...asilo, paidOn: '2026-12-11' }])).toBe(false);
  });
});

describe('calendar', () => {
  it('shows a stamped expense of a confirmed cycle on the day it was paid, as done', () => {
    const cycle = {
      month: '2026-11',
      plannedOn: TODAY,
      endsOn: END,
      status: 'confirmed' as const,
      entries: [
        { ...asilo, paidOn: '2026-11-15' },
        { ...asilo, id: 'altro', name: 'Altro', date: '2026-11-25' },
      ],
      transfers: [],
    };
    const items = monthCalendar('2026-11', { items: [], events: [], debts: [], cycles: [cycle] }).filter((i) => i.fromCycle);
    expect(items.find((i) => i.name === 'Asilo')).toMatchObject({ date: '2026-11-15', done: true });
    expect(items.find((i) => i.name === 'Altro')).toMatchObject({ date: '2026-11-25', done: false });
  });
});
