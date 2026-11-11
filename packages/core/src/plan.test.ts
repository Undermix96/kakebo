import { describe, expect, it } from 'vitest';
import { fitLeftover, planCycle, PlanInputError, type PlanInput } from './plan.ts';
import { checkInvariants } from './test-utils.ts';
import type { Account, CycleEntry } from './types.ts';

const account = (id: string, sort: number, over: Partial<Account> = {}): Account => ({
  id,
  name: id,
  sort,
  marginCents: 0,
  receivesLeftover: false,
  ...over,
});

let n = 0;
const entry = (accountId: string, date: string, signed: number, over: Partial<CycleEntry> = {}): CycleEntry => ({
  id: `e${++n}`,
  name: `e${n}`,
  kind: signed >= 0 ? 'income' : 'expense',
  accountId,
  date,
  amountCents: Math.abs(signed),
  state: 'pending',
  origin: 'sporadic',
  ...over,
});

const base = (over: Partial<PlanInput>): PlanInput => ({
  accounts: [account('a', 1), account('b', 2)],
  balances: [
    { accountId: 'a', amountCents: 0, asOf: '2026-11-10' },
    { accountId: 'b', amountCents: 0, asOf: '2026-11-10' },
  ],
  entries: [],
  today: '2026-11-10',
  end: '2026-12-10',
  ...over,
});

const run = (input: PlanInput) => {
  const plan = planCycle(input);
  checkInvariants(input, plan);
  return plan;
};

describe('planCycle: projection', () => {
  it('orders a day as incomes, then transfers, then expenses, with running balances', () => {
    const plan = run(
      base({
        balances: [
          { accountId: 'a', amountCents: 1000, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 0, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-20', -500), entry('b', '2026-11-20', 300), entry('a', '2026-11-12', -200)],
      }),
    );
    expect(plan.projection.map((r) => [r.date, r.type, r.amountCents, r.totalCents])).toEqual([
      ['2026-11-12', 'expense', -200, 800],
      ['2026-11-20', 'income', 300, 1100],
      ['2026-11-20', 'expense', -500, 600],
    ]);
    expect(plan.transfers).toEqual([]);
    expect(plan.leftover.totalCents).toBe(600);
  });

  it('moves entries dated before the balance date, still to be paid, to the balance date', () => {
    const plan = run(
      base({
        today: '2026-11-15',
        balances: [
          { accountId: 'a', amountCents: 1000, asOf: '2026-11-15' },
          { accountId: 'b', amountCents: 0, asOf: '2026-11-15' },
        ],
        entries: [
          entry('a', '2026-11-11', -300, { state: 'included_in_balance' }),
          entry('a', '2026-11-12', -200), // not yet charged
          entry('a', '2026-11-13', -100, { state: 'excluded' }),
        ],
      }),
    );
    expect(plan.projection).toHaveLength(1);
    expect(plan.projection[0]).toMatchObject({ date: '2026-11-15', originalDate: '2026-11-12', amountCents: -200 });
    expect(plan.total.endCents).toBe(800);
  });

  it('gives the same result in both ways of working (today\'s balances vs balance on the 10th + movements)', () => {
    const later = [entry('a', '2026-11-20', -900), entry('b', '2026-11-25', -100), entry('b', '2026-12-01', 400)];
    // Way 1: balances of the 15th; the salary of the 13th is already in b.
    const today = run(
      base({
        today: '2026-11-15',
        balances: [
          { accountId: 'a', amountCents: 200, asOf: '2026-11-15' },
          { accountId: 'b', amountCents: 1500, asOf: '2026-11-15' },
        ],
        entries: [entry('b', '2026-11-13', 1500, { state: 'included_in_balance' }), ...later],
      }),
    );
    // Way 2: balances of the 10th plus the salary entered by hand.
    const withMovements = run(
      base({
        today: '2026-11-15',
        balances: [
          { accountId: 'a', amountCents: 200, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 0, asOf: '2026-11-10' },
        ],
        entries: [entry('b', '2026-11-13', 1500, { origin: 'past_movement' }), ...later],
      }),
    );
    expect(withMovements.total.endCents).toBe(today.total.endCents);
    expect(withMovements.transfers).toEqual(today.transfers);
    expect(withMovements.start).toBe('2026-11-10');
  });

  it('leaves entries without an amount out, with a warning', () => {
    const plan = run(base({ entries: [entry('a', '2026-11-30', -1, { amountCents: null, id: 'telepass' })] }));
    expect(plan.projection).toEqual([]);
    expect(plan.warnings).toEqual([{ type: 'missing_amount', entryId: 'telepass' }]);
  });

  it('rejects inconsistent input', () => {
    expect(() => planCycle(base({ balances: [{ accountId: 'a', amountCents: 0, asOf: '2026-11-10' }] }))).toThrow(
      PlanInputError,
    );
    expect(() => planCycle(base({ entries: [entry('zzz', '2026-11-20', -1)] }))).toThrow(PlanInputError);
    expect(() => planCycle(base({ entries: [entry('a', '2026-11-20', -1, { amountCents: 1.5 })] }))).toThrow(
      PlanInputError,
    );
    expect(() =>
      planCycle(
        base({
          balances: [
            { accountId: 'a', amountCents: 0, asOf: '2026-11-11' },
            { accountId: 'b', amountCents: 0, asOf: '2026-11-10' },
          ],
        }),
      ),
    ).toThrow(/after today/);
  });
});

describe('planCycle: transfers', () => {
  it('covers the whole future need with one transfer, dated when the source has the money', () => {
    const plan = run(
      base({
        entries: [
          entry('b', '2026-11-13', 2000),
          entry('a', '2026-11-20', -500),
          entry('a', '2026-12-05', -700),
        ],
      }),
    );
    expect(plan.transfers).toEqual([
      expect.objectContaining({
        fromAccountId: 'b',
        toAccountId: 'a',
        amountCents: 1200,
        date: '2026-11-13',
        dueDate: '2026-11-19',
        needDate: '2026-11-20',
        kind: 'cover',
      }),
    ]);
    expect(plan.transfers[0]!.coversEntryIds).toHaveLength(2);
  });

  it('never takes money a source needs for its own future expenses', () => {
    const plan = run(
      base({
        accounts: [account('a', 1), account('b', 2), account('c', 3)],
        balances: [
          { accountId: 'a', amountCents: 0, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 1000, asOf: '2026-11-10' },
          { accountId: 'c', amountCents: 1000, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-15', -500), entry('b', '2026-12-01', -800)],
      }),
    );
    // b can spare only 200; c can spare 1000 and is preferred.
    expect(plan.transfers.map((t) => [t.fromAccountId, t.amountCents])).toEqual([['c', 500]]);
  });

  it('respects the margin of every account', () => {
    const plan = run(
      base({
        accounts: [account('a', 1, { marginCents: 5000 }), account('b', 2, { marginCents: 10000 })],
        balances: [
          { accountId: 'a', amountCents: 5000, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 30000, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-20', -10000)],
      }),
    );
    expect(plan.transfers.map((t) => t.amountCents)).toEqual([10000]);
    expect(plan.accounts.find((a) => a.accountId === 'a')!.withoutTransfers.needCents).toBe(10000);
  });

  it('rounds transfers up when asked, within what the source has', () => {
    const entries = [entry('b', '2026-11-12', 100000), entry('a', '2026-11-20', -20545)];
    expect(run(base({ entries, options: { roundingCents: 500 } })).transfers[0]!.amountCents).toBe(21000);
    expect(run(base({ entries, options: { roundingCents: 1000 } })).transfers[0]!.amountCents).toBe(21000);
    expect(run(base({ entries, options: { roundingCents: 100 } })).transfers[0]!.amountCents).toBe(20600);
    const tight = [entry('b', '2026-11-12', 20600), entry('a', '2026-11-20', -20545)];
    expect(run(base({ entries: tight, options: { roundingCents: 1000 } })).transfers[0]!.amountCents).toBe(20600);
  });

  it('keeps the cents in the source and asks a later transfer for the rest', () => {
    const plan = run(
      base({
        accounts: [account('a', 1), account('b', 2), account('c', 3)],
        balances: [
          { accountId: 'a', amountCents: 0, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 129440, asOf: '2026-11-10' },
          { accountId: 'c', amountCents: 0, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-20', -129598), entry('c', '2026-11-15', 50000), entry('c', '2026-11-30', -9972)],
        options: { roundingCents: 100 },
      }),
    );
    expect(plan.transfers.every((t) => t.amountCents % 100 === 0)).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it('falls back to a same-day transfer when the money only arrives on the day of the expense', () => {
    const plan = run(base({ entries: [entry('b', '2026-11-20', 1000), entry('a', '2026-11-20', -400)] }));
    expect(plan.transfers).toEqual([expect.objectContaining({ date: '2026-11-20', dueDate: '2026-11-20' })]);
    expect(plan.warnings).toEqual([]);
  });

  it('honours leadDays', () => {
    const entries = [entry('b', '2026-11-12', 1000), entry('a', '2026-11-20', -400)];
    expect(run(base({ entries, options: { leadDays: 3 } })).transfers[0]!.dueDate).toBe('2026-11-17');
    expect(run(base({ entries, options: { leadDays: 0 } })).transfers[0]!.dueDate).toBe('2026-11-20');
  });

  it('splits a need when the source only gets the money in steps', () => {
    const plan = run(
      base({
        entries: [
          entry('b', '2026-11-12', 300),
          entry('a', '2026-11-15', -300),
          entry('b', '2026-11-25', 500),
          entry('a', '2026-12-01', -400),
        ],
      }),
    );
    expect(plan.transfers.map((t) => [t.amountCents, t.date, t.dueDate])).toEqual([
      [300, '2026-11-12', '2026-11-14'],
      [400, '2026-11-25', '2026-11-30'],
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('reports what the money cannot cover, per account and in total', () => {
    const plan = run(
      base({
        entries: [
          entry('b', '2026-11-12', 1000),
          entry('a', '2026-11-15', -300),
          entry('b', '2026-11-25', -650),
          entry('a', '2026-12-01', -200),
        ],
      }),
    );
    expect(plan.transfers.map((t) => t.amountCents)).toEqual([350]);
    expect(plan.warnings).toEqual([
      { type: 'cash_shortfall', from: '2026-12-01', to: '2026-12-10', maxDeficitCents: 150 },
      { type: 'account_shortfall', accountId: 'a', from: '2026-12-01', to: '2026-12-10', maxDeficitCents: 150 },
    ]);
  });

  it('bridges with a loan when only an account that needs the money back later can cover', () => {
    // a needs 100 on the 11th and gets 200 on the 14th; b has 100 but needs it on the 20th.
    const plan = run(
      base({
        balances: [
          { accountId: 'a', amountCents: 0, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 100, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-11', -100), entry('a', '2026-11-14', 200), entry('b', '2026-11-20', -100)],
      }),
    );
    expect(plan.transfers.map((t) => [t.fromAccountId, t.toAccountId, t.amountCents, t.kind])).toEqual([
      ['b', 'a', 100, 'bridge'],
      ['a', 'b', 100, 'cover'],
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('applies fixed transfers and only suggests what is still missing', () => {
    const entries = [entry('b', '2026-11-12', 1000), entry('a', '2026-11-20', -400)];
    const plan = run(
      base({
        entries,
        fixedTransfers: [{ fromAccountId: 'b', toAccountId: 'a', amountCents: 300, date: '2026-11-12', dueDate: '2026-11-19' }],
      }),
    );
    expect(plan.transfers.map((t) => t.amountCents)).toEqual([100]);
    expect(plan.projection.filter((r) => r.type === 'transfer').map((r) => r.type === 'transfer' && r.fixed)).toEqual([
      true,
      false,
    ]);
  });
});

describe('planCycle: cash warnings and leftover', () => {
  it('warns when the total is negative and suggests no impossible transfer', () => {
    const plan = run(
      base({
        balances: [
          { accountId: 'a', amountCents: 0, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 500, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-12-03', -620), entry('b', '2026-12-08', 300)],
      }),
    );
    expect(plan.warnings).toContainEqual({ type: 'cash_shortfall', from: '2026-12-03', to: '2026-12-07', maxDeficitCents: 120 });
    // b gives what it has, never more.
    expect(plan.transfers.reduce((s, t) => s + t.amountCents, 0)).toBeLessThanOrEqual(500 + 300);
    for (const t of plan.transfers) expect(t.fromAccountId).toBe('b');
  });

  it('suggests moving the leftover to the leftover account without leaving anyone short', () => {
    const plan = run(
      base({
        accounts: [account('a', 1), account('b', 2), account('ing', 3, { receivesLeftover: true })],
        balances: [
          { accountId: 'a', amountCents: 1000, asOf: '2026-11-10' },
          { accountId: 'b', amountCents: 500, asOf: '2026-11-10' },
          { accountId: 'ing', amountCents: 0, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-20', -800), entry('b', '2026-12-01', 50)],
      }),
    );
    expect(plan.leftover).toEqual({
      totalCents: 750,
      toAccountId: 'ing',
      suggestions: [
        { fromAccountId: 'a', toAccountId: 'ing', amountCents: 200, date: '2026-11-10', dueDate: '2026-12-10' },
        // What b has today goes now; the income of the 1st follows when it arrives.
        { fromAccountId: 'b', toAccountId: 'ing', amountCents: 500, date: '2026-11-10', dueDate: '2026-12-10' },
        { fromAccountId: 'b', toAccountId: 'ing', amountCents: 50, date: '2026-12-01', dueDate: '2026-12-10' },
      ],
      availability: {
        a: [{ date: '2026-11-10', amountCents: 200 }],
        b: [
          { date: '2026-11-10', amountCents: 500 },
          { date: '2026-12-01', amountCents: 550 },
        ],
      },
    });
  });

  it('moves the part of the leftover that is free today, the rest when it frees up', () => {
    const plan = run(
      base({
        accounts: [account('a', 1), account('ing', 2, { receivesLeftover: true })],
        balances: [
          { accountId: 'a', amountCents: 1000, asOf: '2026-11-10' },
          { accountId: 'ing', amountCents: 0, asOf: '2026-11-10' },
        ],
        // a dips to 150 on the 15th and only gets back to 950 on the 25th.
        entries: [entry('a', '2026-11-15', -850), entry('a', '2026-11-25', 800), entry('a', '2026-12-05', -105)],
        options: { roundingCents: 100 },
      }),
    );
    expect(plan.leftover.suggestions).toEqual([
      { fromAccountId: 'a', toAccountId: 'ing', amountCents: 100, date: '2026-11-10', dueDate: '2026-12-10' },
      { fromAccountId: 'a', toAccountId: 'ing', amountCents: 700, date: '2026-11-25', dueDate: '2026-12-10' },
    ]);
    // The cents stay on a.
    expect(plan.accounts.find((x) => x.accountId === 'a')!.withTransfers.endCents - 800).toBe(45);
  });

  it('suggests nothing when the source has no surplus', () => {
    const plan = run(
      base({
        accounts: [account('a', 1), account('ing', 2, { receivesLeftover: true })],
        balances: [
          { accountId: 'a', amountCents: 100, asOf: '2026-11-10' },
          { accountId: 'ing', amountCents: 0, asOf: '2026-11-10' },
        ],
        entries: [entry('a', '2026-11-15', -100)],
      }),
    );
    expect(plan.leftover.suggestions).toEqual([]);
    expect(plan.leftover.availability).toEqual({});
  });
});

describe('fitLeftover', () => {
  const steps = [
    { date: '2026-11-10', amountCents: 100 },
    { date: '2026-11-25', amountCents: 800 },
  ];
  const mv = (date: string, amountCents: number, chosen = true) => ({ date, amountCents, chosen });

  it('keeps the suggested moves as they are', () => {
    expect(fitLeftover(steps, [mv('2026-11-10', 100), mv('2026-11-25', 700)])).toEqual([100, 700]);
  });

  it('cuts a move brought forward to what is free on its new day', () => {
    expect(fitLeftover(steps, [mv('2026-11-10', 100), mv('2026-11-20', 700)])).toEqual([100, 0]);
    expect(fitLeftover(steps, [mv('2026-11-10', 100, false), mv('2026-11-20', 700)])).toEqual([100, 100]);
  });

  it('lets a move be postponed, also before or after the other one', () => {
    expect(fitLeftover(steps, [mv('2026-11-30', 100), mv('2026-11-25', 700)])).toEqual([100, 700]);
    expect(fitLeftover(steps, [mv('2026-11-09', 100), mv('2026-11-25', 700)])).toEqual([0, 700]);
  });
});
