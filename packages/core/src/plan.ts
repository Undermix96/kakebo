import type { Cents } from './money.ts';
import { addDays, daysBetween, maxDate, minDate, type ISODate } from './dates.ts';
import type { Account, Balance, CycleEntry, Id, Transfer } from './types.ts';

export interface PlanOptions {
  /** Transfers are rounded up to a multiple of this (0 = exact cents). E.g. 100, 500, 1000. */
  roundingCents?: Cents;
  /**
   * Days between a transfer and the expense it covers (default 1: "the day before").
   * When the source only has the money later, the engine falls back to the same day.
   */
  leadDays?: number;
  /**
   * false = only project the fixed transfers, suggest nothing (a confirmed cycle,
   * whose transfers are already decided). Default true.
   */
  suggest?: boolean;
}

export interface PlanInput {
  accounts: Account[];
  /** One per account. `asOf` must not be after `today`. */
  balances: Balance[];
  entries: CycleEntry[];
  /** Planning day: no transfer is suggested before it. */
  today: ISODate;
  /** Last day of the cycle, inclusive. */
  end: ISODate;
  /**
   * Transfers already decided (done or edited by hand). They are applied as given
   * and the engine only suggests what is still missing. Do not pass transfers that
   * are already reflected in the balances.
   */
  fixedTransfers?: Transfer[];
  options?: PlanOptions;
}

export interface SuggestedTransfer extends Transfer {
  /** First day the destination would go below its margin. */
  needDate: ISODate;
  /** Expenses of the destination this transfer is meant to cover. */
  coversEntryIds: Id[];
  /**
   * 'cover' = the source can spare the money for the whole cycle.
   * 'bridge' = the source lends what it has today and will itself need money back
   * later (only used when no source can spare it for good).
   */
  kind: 'cover' | 'bridge';
}

export type ProjectionRow =
  | {
      type: 'income' | 'expense';
      date: ISODate;
      /** Set when the entry was dated before the account's balance date but is still to be paid. */
      originalDate?: ISODate;
      entryId: Id;
      name: string;
      accountId: Id;
      /** Signed: positive for incomes, negative for expenses. */
      amountCents: Cents;
      balances: Record<Id, Cents>;
      totalCents: Cents;
    }
  | {
      type: 'transfer';
      date: ISODate;
      fixed: boolean;
      fromAccountId: Id;
      toAccountId: Id;
      amountCents: Cents;
      balances: Record<Id, Cents>;
      totalCents: Cents;
    };

export interface AccountSummary {
  accountId: Id;
  startCents: Cents;
  /** Without any transfer (fixed ones excluded too): what the account needs. */
  withoutTransfers: {
    endCents: Cents;
    min: { amountCents: Cents; date: ISODate };
    /** First day below the margin, null if never. */
    firstBelowMargin: ISODate | null;
    /** How much it needs to stay at or above its margin for the whole cycle. */
    needCents: Cents;
  };
  /** With fixed and suggested transfers. */
  withTransfers: {
    endCents: Cents;
    min: { amountCents: Cents; date: ISODate };
  };
}

export type PlanWarning =
  | { type: 'missing_amount'; entryId: Id }
  | { type: 'out_of_cycle'; entryId: Id }
  /** The total of all accounts is below zero: no transfer can fix it. */
  | { type: 'cash_shortfall'; from: ISODate; to: ISODate; maxDeficitCents: Cents }
  /** Even with transfers the account stays below its margin on these days. */
  | { type: 'account_shortfall'; accountId: Id; from: ISODate; to: ISODate; maxDeficitCents: Cents };

export interface LeftoverSuggestion extends Transfer {}

export interface PlanResult {
  start: ISODate;
  today: ISODate;
  end: ISODate;
  accounts: AccountSummary[];
  total: { startCents: Cents; endCents: Cents; min: { amountCents: Cents; date: ISODate } };
  transfers: SuggestedTransfer[];
  /** End-of-day balances with all transfers, one row per day from `start` to `end`. */
  daily: { date: ISODate; balances: Record<Id, Cents>; totalCents: Cents }[];
  projection: ProjectionRow[];
  leftover: {
    /** Total left at the end of the cycle (same with or without transfers). */
    totalCents: Cents;
    /** The account flagged `receivesLeftover`, if any. */
    toAccountId: Id | null;
    /** Optional moves of the surplus to that account, never below anyone's margin. */
    suggestions: LeftoverSuggestion[];
  };
  warnings: PlanWarning[];
}

export class PlanInputError extends Error {
  override name = 'PlanInputError';
}

const sign = (e: CycleEntry) => (e.kind === 'income' ? 1 : -1);

function roundUp(amount: Cents, step: Cents): Cents {
  return step > 0 ? Math.ceil(amount / step) * step : amount;
}

function assertCents(n: number, what: string) {
  if (!Number.isInteger(n)) throw new PlanInputError(`${what} must be integer cents, got ${n}`);
}

/**
 * Plans a cycle: projection per account and in total, needs, suggested transfers,
 * leftover and cash warnings. Pure: no I/O, deterministic.
 *
 * Balances are end-of-day; within a day incomes come first, then transfers, then
 * expenses, so a transfer made on the day of an expense is in time.
 *
 * Transfer algorithm (greedy, chronological). For each day from `today`, for each
 * account D below its margin:
 * 1. cover: cover D's residual need for the rest of the cycle (margin − D's lowest
 *    future balance) from the accounts that can spare money for good. The
 *    availability of a source S from day d is min(S's balance from d to the end) −
 *    margin, so a source is never left short for its own future expenses. The richest
 *    source goes first; the transfer is dated on the first day the source has the
 *    money, no later than `leadDays` before the need (or the same day as a fallback).
 *    A transfer between the same pair is grown instead of adding a new one.
 * 2. bridge: if D is still short today, borrow what other accounts hold up to this
 *    day; their later needs are handled when the loop gets there.
 * Whatever is still missing shows up as a warning. Transfers never exceed what the
 * source has, so the engine never "saves" an account at another one's expense.
 */
export function planCycle(input: PlanInput): PlanResult {
  const { today, end } = input;
  const rounding = input.options?.roundingCents ?? 0;
  const lead = input.options?.leadDays ?? 1;
  assertCents(rounding, 'roundingCents');
  if (rounding < 0 || !Number.isInteger(lead) || lead < 0) throw new PlanInputError('invalid options');
  if (today > end) throw new PlanInputError(`today (${today}) is after the end of the cycle (${end})`);

  const accounts = [...input.accounts].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const ids = accounts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new PlanInputError('duplicate account id');
  const margin = new Map(accounts.map((a) => [a.id, a.marginCents]));
  for (const a of accounts) assertCents(a.marginCents, `margin of ${a.id}`);

  const balanceOf = new Map<Id, Balance>();
  for (const b of input.balances) {
    if (!margin.has(b.accountId)) throw new PlanInputError(`balance for unknown account ${b.accountId}`);
    if (balanceOf.has(b.accountId)) throw new PlanInputError(`two balances for account ${b.accountId}`);
    assertCents(b.amountCents, `balance of ${b.accountId}`);
    if (b.asOf > today) throw new PlanInputError(`balance of ${b.accountId} is dated after today`);
    balanceOf.set(b.accountId, b);
  }
  for (const id of ids) if (!balanceOf.has(id)) throw new PlanInputError(`missing balance for account ${id}`);

  const start = [...balanceOf.values()].reduce((d, b) => minDate(d, b.asOf), today);
  const days = daysBetween(start, end) + 1;
  const idx = (d: ISODate) => daysBetween(start, d);
  const dateAt = (i: number) => addDays(start, i);
  const todayIdx = idx(today);
  const warnings: PlanWarning[] = [];

  // --- Entries → daily deltas -------------------------------------------------
  type Placed = { entry: CycleEntry; date: ISODate };
  const placed: Placed[] = [];
  const delta = new Map(ids.map((id) => [id, new Array<number>(days).fill(0)]));
  for (const e of input.entries) {
    if (!margin.has(e.accountId)) throw new PlanInputError(`entry ${e.id} on unknown account ${e.accountId}`);
    if (e.state !== 'pending') continue;
    if (e.amountCents == null) {
      warnings.push({ type: 'missing_amount', entryId: e.id });
      continue;
    }
    assertCents(e.amountCents, `amount of ${e.id}`);
    if (e.amountCents < 0) throw new PlanInputError(`amount of ${e.id} must be positive (the sign comes from kind)`);
    const date = maxDate(e.date, balanceOf.get(e.accountId)!.asOf);
    if (date > end) {
      warnings.push({ type: 'out_of_cycle', entryId: e.id });
      continue;
    }
    placed.push({ entry: e, date });
    delta.get(e.accountId)![idx(date)]! += sign(e) * e.amountCents;
  }

  const cumulative = (id: Id): number[] => {
    const out = new Array<number>(days);
    let run = balanceOf.get(id)!.amountCents;
    const d = delta.get(id)!;
    for (let i = 0; i < days; i++) out[i] = run += d[i]!;
    return out;
  };
  const base = new Map(ids.map((id) => [id, cumulative(id)]));
  const bal = new Map(ids.map((id) => [id, [...base.get(id)!]]));
  const m = (id: Id) => margin.get(id)!;
  const series = (id: Id) => bal.get(id)!;

  const minOver = (id: Id, from: number, to: number) => {
    const s = series(id);
    let min = Infinity;
    for (let j = from; j <= to; j++) min = Math.min(min, s[j]!);
    return min;
  };

  const shift = (id: Id, from: number, amount: Cents) => {
    const s = series(id);
    for (let j = from; j < days; j++) s[j]! += amount;
  };

  // --- Transfers -----------------------------------------------------------------
  interface Planned extends SuggestedTransfer {
    fixed: boolean;
  }
  const planned: Planned[] = [];

  for (const t of input.fixedTransfers ?? []) {
    if (!margin.has(t.fromAccountId) || !margin.has(t.toAccountId) || t.fromAccountId === t.toAccountId)
      throw new PlanInputError('invalid fixed transfer accounts');
    assertCents(t.amountCents, 'fixed transfer amount');
    const date = maxDate(t.date, start);
    if (date > end) continue;
    shift(t.fromAccountId, idx(date), -t.amountCents);
    shift(t.toAccountId, idx(date), t.amountCents);
    planned.push({ ...t, date, needDate: date, coversEntryIds: [], kind: 'cover', fixed: true });
  }

  const covers = (accountId: Id, from: number, to: number): Id[] =>
    placed
      .filter((p) => p.entry.accountId === accountId && p.entry.kind === 'expense')
      .filter((p) => idx(p.date) >= from && idx(p.date) <= to)
      .map((p) => p.entry.id);

  /** Moves up to `amount` into `dest`, needed on day `need`, from sources dated no later than `windowEnd`. */
  const cover = (dest: Id, need: number, amount: Cents, windowEnd: number, kind: 'cover' | 'bridge'): Cents => {
    // Money a source can give from day d without going below its margin on any day
    // that matters: until the end ('cover') or until the day of the need ('bridge').
    const avail = (src: Id, d: number) => minOver(src, d, kind === 'cover' ? days - 1 : need) - m(src);
    // Days the transfer covers, for the "reason" shown to the user.
    const coverTo = (() => {
      if (kind === 'bridge') return need;
      const s = series(dest);
      let at = need;
      for (let j = need; j < days; j++) if (s[j]! < s[at]!) at = j;
      return at;
    })();

    while (amount > 0) {
      let best: Id | null = null;
      let bestAvail = 0;
      for (const src of ids) {
        if (src === dest) continue;
        const a = avail(src, windowEnd);
        if (a > bestAvail) [best, bestAvail] = [src, a];
      }
      if (best === null) break;
      const x = Math.min(roundUp(amount, rounding), bestAvail);
      const dueDate = dateAt(windowEnd);
      const coverIds = covers(dest, need, coverTo);

      const existing = planned.find(
        (t) =>
          !t.fixed &&
          t.fromAccountId === best &&
          t.toAccountId === dest &&
          idx(t.date) <= windowEnd &&
          avail(best, idx(t.date)) >= x,
      );
      if (existing) {
        existing.amountCents += x;
        existing.dueDate = minDate(existing.dueDate, dueDate);
        existing.coversEntryIds = [...new Set([...existing.coversEntryIds, ...coverIds])];
        if (kind === 'bridge') existing.kind = 'bridge';
        shift(best, idx(existing.date), -x);
        shift(dest, idx(existing.date), x);
      } else {
        let d = todayIdx;
        while (avail(best, d) < x) d++; // availability only grows with d, and avail(windowEnd) >= x
        planned.push({
          fromAccountId: best,
          toAccountId: dest,
          amountCents: x,
          date: dateAt(d),
          dueDate,
          needDate: dateAt(need),
          coversEntryIds: coverIds,
          kind,
          fixed: false,
        });
        shift(best, d, -x);
        shift(dest, d, x);
      }
      amount -= x;
    }
    return Math.max(0, amount);
  };

  for (let i = todayIdx; i < days && input.options?.suggest !== false; i++) {
    const windows = [...new Set([Math.max(todayIdx, i - lead), i])];
    for (const dest of ids) {
      if (series(dest)[i]! >= m(dest)) continue;
      let need = m(dest) - minOver(dest, i, days - 1);
      for (const w of windows) if (need > 0) need = cover(dest, i, need, w, 'cover');
      let deficit = m(dest) - series(dest)[i]!;
      for (const w of windows) if (deficit > 0) deficit = cover(dest, i, deficit, w, 'bridge');
    }
  }

  // --- Leftover --------------------------------------------------------------------
  const leftoverAccount = accounts.find((a) => a.receivesLeftover)?.id ?? null;
  const leftoverSuggestions: LeftoverSuggestion[] = [];
  if (leftoverAccount) {
    for (const src of ids) {
      if (src === leftoverAccount) continue;
      const amount = series(src)[days - 1]! - m(src);
      if (amount <= 0) continue;
      let d = todayIdx;
      while (minOver(src, d, days - 1) - m(src) < amount) d++;
      leftoverSuggestions.push({
        fromAccountId: src,
        toAccountId: leftoverAccount,
        amountCents: amount,
        date: dateAt(d),
        dueDate: end,
      });
    }
  }

  // --- Summaries -------------------------------------------------------------------
  const minOf = (s: number[]) => {
    let at = 0;
    for (let j = 1; j < s.length; j++) if (s[j]! < s[at]!) at = j;
    return { amountCents: s[at]!, date: dateAt(at) };
  };
  const summaries: AccountSummary[] = ids.map((id) => {
    const b = base.get(id)!;
    const below = b.findIndex((v) => v < m(id));
    const min = minOf(b);
    return {
      accountId: id,
      startCents: balanceOf.get(id)!.amountCents,
      withoutTransfers: {
        endCents: b[days - 1]!,
        min,
        firstBelowMargin: below < 0 ? null : dateAt(below),
        needCents: Math.max(0, m(id) - min.amountCents),
      },
      withTransfers: { endCents: series(id)[days - 1]!, min: minOf(series(id)) },
    };
  });

  const totalSeries = Array.from({ length: days }, (_, j) => ids.reduce((s, id) => s + series(id)[j]!, 0));
  const startTotal = ids.reduce((s, id) => s + balanceOf.get(id)!.amountCents, 0);

  // --- Warnings --------------------------------------------------------------------
  const runs = (below: (j: number) => number): { from: number; to: number; max: number }[] => {
    const out: { from: number; to: number; max: number }[] = [];
    for (let j = 0; j < days; j++) {
      const deficit = below(j);
      if (deficit <= 0) continue;
      const last = out.at(-1);
      if (last && last.to === j - 1) [last.to, last.max] = [j, Math.max(last.max, deficit)];
      else out.push({ from: j, to: j, max: deficit });
    }
    return out;
  };
  for (const r of runs((j) => -totalSeries[j]!))
    warnings.push({ type: 'cash_shortfall', from: dateAt(r.from), to: dateAt(r.to), maxDeficitCents: r.max });
  for (const id of ids)
    for (const r of runs((j) => m(id) - series(id)[j]!))
      warnings.push({
        type: 'account_shortfall',
        accountId: id,
        from: dateAt(r.from),
        to: dateAt(r.to),
        maxDeficitCents: r.max,
      });

  // --- Projection rows ---------------------------------------------------------------
  const order = new Map(accounts.map((a, k) => [a.id, k]));
  type Ev =
    | { kind: 0 | 2; date: ISODate; p: Placed }
    | { kind: 1; date: ISODate; t: Planned };
  const events: Ev[] = [
    ...placed.map((p): Ev => ({ kind: p.entry.kind === 'income' ? 0 : 2, date: p.date, p })),
    ...planned.map((t): Ev => ({ kind: 1, date: t.date, t })),
  ];
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind - b.kind;
    const accA = a.kind === 1 ? a.t.fromAccountId : a.p.entry.accountId;
    const accB = b.kind === 1 ? b.t.fromAccountId : b.p.entry.accountId;
    return order.get(accA)! - order.get(accB)!;
  });

  const running = new Map(ids.map((id) => [id, balanceOf.get(id)!.amountCents]));
  const snapshot = () => Object.fromEntries(running) as Record<Id, Cents>;
  const totalNow = () => [...running.values()].reduce((s, v) => s + v, 0);
  const projection: ProjectionRow[] = events.map((ev) => {
    if (ev.kind === 1) {
      const t = ev.t;
      running.set(t.fromAccountId, running.get(t.fromAccountId)! - t.amountCents);
      running.set(t.toAccountId, running.get(t.toAccountId)! + t.amountCents);
      return {
        type: 'transfer',
        date: t.date,
        fixed: t.fixed,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amountCents: t.amountCents,
        balances: snapshot(),
        totalCents: totalNow(),
      };
    }
    const e = ev.p.entry;
    const amount = sign(e) * e.amountCents!;
    running.set(e.accountId, running.get(e.accountId)! + amount);
    return {
      type: e.kind,
      date: ev.date,
      ...(ev.date !== e.date ? { originalDate: e.date } : {}),
      entryId: e.id,
      name: e.name,
      accountId: e.accountId,
      amountCents: amount,
      balances: snapshot(),
      totalCents: totalNow(),
    };
  });

  return {
    start,
    today,
    end,
    accounts: summaries,
    total: { startCents: startTotal, endCents: totalSeries[days - 1]!, min: minOf(totalSeries) },
    transfers: planned
      .filter((t) => !t.fixed)
      .map(({ fixed: _fixed, ...t }) => t)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    daily: Array.from({ length: days }, (_, j) => ({
      date: dateAt(j),
      balances: Object.fromEntries(ids.map((id) => [id, series(id)[j]!])),
      totalCents: totalSeries[j]!,
    })),
    projection,
    leftover: { totalCents: totalSeries[days - 1]!, toAccountId: leftoverAccount, suggestions: leftoverSuggestions },
    warnings,
  };
}
