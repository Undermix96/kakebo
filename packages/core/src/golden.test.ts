import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cycleBounds, generateCycleEntries, withDefaultStates } from './cycle.ts';
import { planCycle } from './plan.ts';
import { exampleCycle, type GoldenFixture } from './fixtures/golden.ts';
import { checkInvariants } from './test-utils.ts';

// The real cycle (family data) is only on the developer's machine, never in the repo.
const realPath = fileURLToPath(new URL('../../../private/fixtures/golden-2026-11.json', import.meta.url));
const fixtures: GoldenFixture[] = [exampleCycle];
if (existsSync(realPath)) fixtures.push(JSON.parse(readFileSync(realPath, 'utf8')) as GoldenFixture);

const byDateName = <T extends [string, string, ...unknown[]]>(a: T, b: T) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;

describe.each(fixtures)('golden cycle: $name', (fx) => {
  const bounds = cycleBounds(fx.month, fx.plannedOn);
  const generated = generateCycleEntries(fx.catalog, bounds);
  const entries = withDefaultStates([...generated.entries, ...fx.sporadic], fx.balances);
  const plan = planCycle({
    accounts: fx.accounts,
    balances: fx.balances,
    entries,
    today: fx.plannedOn,
    end: bounds.end,
  });

  it('generates the expected entries from the catalog', () => {
    const got = entries
      .filter((e) => e.amountCents != null && e.state === 'pending')
      .map((e): [string, string, string, number] => [
        e.date,
        e.name,
        e.accountId,
        (e.kind === 'income' ? 1 : -1) * e.amountCents!,
      ]);
    expect(got.sort(byDateName)).toEqual([...fx.expected.entries].sort(byDateName));
  });

  it('flags catalog items without an amount instead of inventing one', () => {
    const missing = generated.warnings.filter((w) => w.type === 'missing_amount').map((w) => w.recurringItemId);
    expect(missing.sort()).toEqual([...fx.expected.missingAmounts].sort());
    const planMissing = plan.warnings.filter((w) => w.type === 'missing_amount');
    expect(planMissing).toHaveLength(fx.expected.missingAmounts.length);
  });

  it('projects each account without transfers', () => {
    for (const [id, exp] of Object.entries(fx.expected.withoutTransfers)) {
      const s = plan.accounts.find((a) => a.accountId === id)!;
      expect(s.withoutTransfers.endCents, id).toBe(exp.endCents);
      if (exp.minDate) expect(s.withoutTransfers.min.date, id).toBe(exp.minDate);
      if (exp.firstBelowMargin !== undefined) expect(s.withoutTransfers.firstBelowMargin, id).toBe(exp.firstBelowMargin);
    }
  });

  it('keeps the expected total at the end of the cycle', () => {
    expect(plan.total.endCents).toBe(fx.expected.totalEndCents);
    expect(plan.leftover.totalCents).toBe(fx.expected.totalEndCents);
  });

  it('suggests few transfers that leave every account covered', () => {
    expect(plan.transfers.length).toBeLessThanOrEqual(fx.expected.maxTransfers);
    expect(plan.warnings.filter((w) => w.type !== 'missing_amount')).toEqual([]);
    for (const a of plan.accounts) expect(a.withTransfers.min.amountCents).toBeGreaterThanOrEqual(0);
    checkInvariants({ accounts: fx.accounts, balances: fx.balances, entries, today: fx.plannedOn, end: bounds.end }, plan);
    if (fx.expected.transfers) {
      const got = plan.transfers.map((t): [string, string, number] => [t.fromAccountId, t.toAccountId, t.amountCents]);
      expect(got.sort()).toEqual([...fx.expected.transfers].sort());
    }
  });

  it('offers to move the whole leftover to the leftover account', () => {
    const moved = plan.leftover.suggestions.reduce((s, t) => s + t.amountCents, 0);
    const already = plan.accounts.find((a) => a.accountId === plan.leftover.toAccountId)!.withTransfers.endCents;
    expect(moved + already).toBe(fx.expected.totalEndCents);
  });
});

it('runs against the real fixture when it is available', () => {
  // Informational: shows in the output whether the private golden case ran.
  expect(fixtures.length).toBeGreaterThanOrEqual(1);
  if (fixtures.length === 1) console.info('private golden fixture not found: only the invented example ran');
});
