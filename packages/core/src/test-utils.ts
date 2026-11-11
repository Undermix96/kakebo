import { expect } from 'vitest';
import { addDays, maxDate } from './dates.ts';
import type { PlanInput, PlanResult } from './plan.ts';
import { effectiveAmount, envelopeSpent } from './envelope.ts';

/**
 * Checks the engine's invariants on a result, recomputing balances naively and
 * independently from the plan's own bookkeeping.
 */
export function checkInvariants(input: PlanInput, plan: PlanResult): void {
  const ids = input.accounts.map((a) => a.id);
  const margin = new Map(input.accounts.map((a) => [a.id, a.marginCents]));
  const asOf = new Map(input.balances.map((b) => [b.accountId, b.asOf]));
  const all = [...(input.fixedTransfers ?? []), ...plan.transfers];

  // Transfers are well formed and never before today.
  for (const t of plan.transfers) {
    expect(t.amountCents).toBeGreaterThan(0);
    expect(t.fromAccountId).not.toBe(t.toAccountId);
    expect(t.date >= input.today).toBe(true);
    expect(t.date <= t.dueDate).toBe(true);
    expect(t.dueDate <= input.end).toBe(true);
    expect(t.dueDate <= t.needDate).toBe(true);
  }

  // Naive day-by-day balances match the plan's.
  const balanceAt = (id: string, day: string, withTransfers: boolean) => {
    let v = input.balances.find((b) => b.accountId === id)!.amountCents;
    const spent = envelopeSpent(input.entries);
    for (const e of input.entries) {
      const amount = effectiveAmount(e, spent);
      if (e.accountId !== id || e.state !== 'pending' || amount == null) continue;
      const d = maxDate(e.date, asOf.get(id)!);
      if (d <= day && d <= input.end) v += (e.kind === 'income' ? 1 : -1) * amount;
    }
    if (withTransfers)
      for (const t of all) {
        if (t.date > day) continue;
        if (t.fromAccountId === id) v -= t.amountCents;
        if (t.toAccountId === id) v += t.amountCents;
      }
    return v;
  };
  expect(plan.daily.at(-1)!.date).toBe(input.end);
  for (const row of plan.daily)
    for (const id of ids) expect(row.balances[id], `${id} on ${row.date}`).toBe(balanceAt(id, row.date, true));

  // Transfers move money, they never create or destroy it.
  const endWithout = ids.reduce((s, id) => s + balanceAt(id, input.end, false), 0);
  expect(plan.total.endCents).toBe(endWithout);
  for (const row of plan.daily) {
    const without = ids.reduce((s, id) => s + balanceAt(id, row.date, false), 0);
    expect(row.totalCents).toBe(without);
  }

  // From today on: when the total allows it, every account is at or above its margin;
  // whatever is still short is reported.
  const sumMargins = ids.reduce((s, id) => s + margin.get(id)!, 0);
  for (const row of plan.daily) {
    if (row.date < input.today) continue;
    const covered = (type: 'account_shortfall' | 'cash_shortfall', id?: string) =>
      plan.warnings.some(
        (w) => w.type === type && w.from <= row.date && row.date <= w.to && (!id || ('accountId' in w && w.accountId === id)),
      );
    if (row.totalCents < 0) expect(covered('cash_shortfall'), `cash warning on ${row.date}`).toBe(true);
    for (const id of ids) {
      const short = row.balances[id]! < margin.get(id)!;
      if (row.totalCents >= sumMargins) expect(short, `${id} short on ${row.date}`).toBe(false);
      if (short) expect(covered('account_shortfall', id), `${id} warning on ${row.date}`).toBe(true);
    }
  }

  // Leftover suggestions, all taken together, never push a source below its margin,
  // and never go beyond what the availability says.
  for (let d = input.today; d <= input.end; d = addDays(d, 1)) {
    const row = plan.daily.find((r) => r.date === d)!;
    for (const [src, steps] of Object.entries(plan.leftover.availability)) {
      const moved = plan.leftover.suggestions.filter((s) => s.fromAccountId === src && s.date <= d).reduce((t, s) => t + s.amountCents, 0);
      const free = steps.filter((s) => s.date <= d).at(-1)?.amountCents ?? 0;
      expect(moved).toBeLessThanOrEqual(free);
      if (moved > 0) expect(row.balances[src]! - moved).toBeGreaterThanOrEqual(margin.get(src)!);
    }
  }
  for (const s of plan.leftover.suggestions) expect(plan.leftover.availability[s.fromAccountId]).toBeDefined();
}
