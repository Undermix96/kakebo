import fc from 'fast-check';
import { describe, it } from 'vitest';
import { addDays } from './dates.ts';
import { planCycle, type PlanInput } from './plan.ts';
import { checkInvariants } from './test-utils.ts';
import type { CycleEntry } from './types.ts';

const TODAY = '2026-11-10';
const END = '2026-12-10';
const DAYS = 31;

/** Random cycles: 2–5 accounts, margins, balances (some dated before today), entries, options. */
const arbInput: fc.Arbitrary<PlanInput> = fc
  .integer({ min: 2, max: 5 })
  .chain((nAccounts) => {
    const ids = Array.from({ length: nAccounts }, (_, i) => `acc${i}`);
    const accountId = fc.constantFrom(...ids);
    const entry = fc.record({
      accountId,
      offset: fc.integer({ min: -5, max: DAYS }),
      income: fc.boolean(),
      amount: fc.integer({ min: 1, max: 300_000 }),
      state: fc.constantFrom('pending', 'pending', 'pending', 'included_in_balance', 'excluded'),
    });
    return fc.record({
      ids: fc.constant(ids),
      margins: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 20_000 })), {
        minLength: nAccounts,
        maxLength: nAccounts,
      }),
      balances: fc.array(fc.integer({ min: -50_000, max: 300_000 }), { minLength: nAccounts, maxLength: nAccounts }),
      asOfOffsets: fc.array(fc.integer({ min: -5, max: 0 }), { minLength: nAccounts, maxLength: nAccounts }),
      entries: fc.array(entry, { maxLength: 30 }),
      rounding: fc.constantFrom(0, 0, 100, 500, 1000),
      lead: fc.constantFrom(0, 1, 1, 2),
      leftover: fc.option(fc.integer({ min: 0, max: nAccounts - 1 })),
    });
  })
  .map(({ ids, margins, balances, asOfOffsets, entries, rounding, lead, leftover }) => ({
    accounts: ids.map((id, i) => ({
      id,
      name: id,
      sort: i,
      marginCents: margins[i]!,
      receivesLeftover: leftover === i,
    })),
    balances: ids.map((id, i) => ({ accountId: id, amountCents: balances[i]!, asOf: addDays(TODAY, asOfOffsets[i]!) })),
    entries: entries.map(
      (e, k): CycleEntry => ({
        id: `e${k}`,
        name: `e${k}`,
        kind: e.income ? 'income' : 'expense',
        accountId: e.accountId,
        date: addDays(TODAY, e.offset),
        amountCents: e.amount,
        state: e.state as CycleEntry['state'],
        origin: 'catalog',
      }),
    ),
    today: TODAY,
    end: END,
    options: { roundingCents: rounding, leadDays: lead },
  }));

describe('planCycle invariants (property-based)', () => {
  it('holds on random cycles', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        checkInvariants(input, planCycle(input));
      }),
      { numRuns: 400 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const a = JSON.stringify(planCycle(input));
        const b = JSON.stringify(planCycle(structuredClone(input)));
        if (a !== b) throw new Error('two runs differ');
      }),
      { numRuns: 50 },
    );
  });
});
