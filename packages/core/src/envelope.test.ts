import { describe, expect, it } from 'vitest';
import { planCycle, type PlanInput } from './plan.ts';
import { cycleDraftSchema, cycleTotals } from './cycle-record.ts';
import { lastUsedAmounts } from './cycle.ts';
import { effectiveAmount, envelopeSpent, envelopeStatus } from './envelope.ts';
import { checkInvariants } from './test-utils.ts';
import type { Account, CycleEntry, RecurringItem } from './types.ts';

// Invented case (amounts chosen for the test, no real data): the groceries and
// pharmacy envelope is 700,00 on "Carta Spesa", which is empty; on the 10th two
// expenses of the envelope (50,00 and 100,00) were paid with another account.
const accounts: Account[] = [
  { id: 'giorno', name: 'Conto Giorno', sort: 1, marginCents: 0, receivesLeftover: true },
  { id: 'spesa', name: 'Carta Spesa', sort: 2, marginCents: 0, receivesLeftover: false },
];
const TODAY = '2026-11-11';
const END = '2026-12-10';

const envelope: CycleEntry = {
  id: 'item-spesa@2026-11-11',
  recurringItemId: 'item-spesa',
  name: 'Spesa',
  kind: 'expense',
  accountId: 'spesa',
  date: '2026-11-11',
  amountCents: 70000,
  state: 'pending',
  origin: 'catalog',
};

const spend = (id: string, amountCents: number, accountId: string, date = '2026-11-10', state: CycleEntry['state'] = 'included_in_balance'): CycleEntry => ({
  id,
  name: id,
  kind: 'expense',
  accountId,
  date,
  amountCents,
  state,
  origin: 'past_movement',
  envelopeEntryId: envelope.id,
});

function input(entries: CycleEntry[], spesaBalance = 0, giornoBalance = 200000): PlanInput {
  return {
    accounts,
    balances: [
      { accountId: 'giorno', amountCents: giornoBalance, asOf: TODAY },
      { accountId: 'spesa', amountCents: spesaBalance, asOf: TODAY },
    ],
    entries,
    today: TODAY,
    end: END,
  };
}

const toSpesa = (p: ReturnType<typeof planCycle>) =>
  p.transfers.filter((t) => t.toAccountId === 'spesa').reduce((s, t) => s + t.amountCents, 0);

describe('envelope', () => {
  it('only covers what is left when the expenses were paid from another account', () => {
    const entries = [envelope, spend('conad', 5000, 'giorno'), spend('farmacia', 10000, 'giorno')];
    const i = input(entries);
    const plan = planCycle(i);
    expect(toSpesa(plan)).toBe(55000);
    const row = plan.projection.find((r) => r.type === 'expense' && r.entryId === envelope.id);
    expect(row).toMatchObject({ amountCents: -55000, envelope: { totalCents: 70000, spentCents: 15000, leftCents: 55000, overCents: 0 } });
    expect(plan.warnings).toEqual([]);
    checkInvariants(i, plan);
  });

  it('covers the whole envelope when the expenses were paid from the envelope account itself', () => {
    // Its balance is already 150,00 below zero: 550,00 left + 150,00 of hole.
    const entries = [envelope, spend('conad', 5000, 'spesa'), spend('farmacia', 10000, 'spesa')];
    const i = input(entries, -15000);
    const plan = planCycle(i);
    expect(toSpesa(plan)).toBe(70000);
    checkInvariants(i, plan);
  });

  it('without linked expenses the envelope counts in full', () => {
    expect(toSpesa(planCycle(input([envelope])))).toBe(70000);
  });

  it('counts an expense made after the balance date on its own account too', () => {
    const later = spend('mercato', 10000, 'giorno', '2026-11-15', 'pending');
    const i = input([envelope, later]);
    const plan = planCycle(i);
    expect(toSpesa(plan)).toBe(60000);
    // The expense leaves Conto Giorno on its day.
    expect(plan.projection.find((r) => r.type === 'expense' && r.entryId === 'mercato')).toMatchObject({ date: '2026-11-15', amountCents: -10000 });
    checkInvariants(i, plan);
  });

  it('warns when the envelope is overspent and counts it as empty', () => {
    const i = input([envelope, spend('grande', 80000, 'giorno')]);
    const plan = planCycle(i);
    expect(toSpesa(plan)).toBe(0);
    expect(plan.warnings).toContainEqual({ type: 'envelope_overspent', entryId: envelope.id, overCents: 10000 });
    checkInvariants(i, plan);
  });

  it('ignores excluded expenses and links to unknown entries', () => {
    const entries = [envelope, { ...spend('tolta', 5000, 'giorno'), state: 'excluded' as const }, { ...spend('orfana', 5000, 'giorno'), envelopeEntryId: 'nope' }];
    expect(envelopeSpent(entries).size).toBe(0);
    expect(effectiveAmount(envelope, envelopeSpent(entries))).toBe(70000);
    expect(envelopeStatus(envelope, envelopeSpent(entries))).toBeNull();
  });

  it('totals count what is left; the "last" amount stays the whole envelope', () => {
    const entries = [envelope, spend('conad', 5000, 'giorno'), spend('farmacia', 10000, 'giorno')];
    expect(cycleTotals(entries)).toMatchObject({ expenseCents: 55000, expenses: 1 });
    const item: RecurringItem = {
      id: 'item-spesa',
      kind: 'expense',
      name: 'Spesa',
      accountId: 'spesa',
      day: 11,
      schedule: { type: 'monthly' },
      amountMode: 'last',
      amountCents: 60000,
      envelope: true,
    };
    expect(lastUsedAmounts([item], entries).get('item-spesa')).toBe(70000);
  });

  it('the draft accepts only expenses already made, linked to an expense of the cycle', () => {
    const base = { plannedOn: TODAY, endsOn: END, balances: input([]).balances };
    const ok = cycleDraftSchema.safeParse({ ...base, entries: [envelope, spend('conad', 5000, 'giorno')] });
    expect(ok.success).toBe(true);
    const orphan = cycleDraftSchema.safeParse({ ...base, entries: [envelope, { ...spend('x', 5000, 'giorno'), envelopeEntryId: 'nope' }] });
    expect(orphan.success).toBe(false);
    const sporadic = cycleDraftSchema.safeParse({ ...base, entries: [envelope, { ...spend('x', 5000, 'giorno'), origin: 'sporadic' }] });
    expect(sporadic.success).toBe(false);
  });
});
