import type { Cents } from './money.ts';
import {
  addMonths,
  dateInMonth,
  minDate,
  monthOf,
  parseYearMonth,
  type ISODate,
  type YearMonth,
} from './dates.ts';
import type { Balance, CycleEntry, EntryState, Id, RecurringItem, Schedule } from './types.ts';

export const DEFAULT_END_DAY = 10;

/** Does the schedule fall in the given month? */
export function occursInMonth(schedule: Schedule, ym: YearMonth): boolean {
  const { year, month } = parseYearMonth(ym);
  switch (schedule.type) {
    case 'monthly':
      return true;
    case 'yearly':
      return schedule.month === month;
    case 'months':
      return schedule.months.includes(month);
    case 'every_n_months': {
      if (!Number.isInteger(schedule.n) || schedule.n < 1) throw new RangeError(`invalid n: ${schedule.n}`);
      const start = parseYearMonth(schedule.startMonth);
      const diff = year * 12 + month - (start.year * 12 + start.month);
      return diff >= 0 && diff % schedule.n === 0;
    }
  }
}

export interface CycleBounds {
  month: YearMonth;
  /** First day whose movements belong to the cycle. */
  start: ISODate;
  /** Last day of the cycle, inclusive: day `endDay` of the next month. */
  end: ISODate;
}

/**
 * Cycle `M` runs until day `endDay` (default 10) of M+1, inclusive. It starts on day
 * `endDay` of M, or on the planning day if earlier: a plan made on the 9th still sees
 * the payments of the 10th. Items dated before the balance date are asked about
 * ("already in the balance?"), so an early start is harmless.
 */
export function cycleBounds(month: YearMonth, plannedOn: ISODate, endDay = DEFAULT_END_DAY): CycleBounds {
  return {
    month,
    start: minDate(plannedOn, dateInMonth(month, endDay)),
    end: dateInMonth(addMonths(month, 1), endDay),
  };
}

/**
 * Default cycle for a planning day: from the day before `endDay` of M onward it is
 * cycle M (a plan made on 9 November is November's), earlier days still belong to M−1.
 * The UI may let the user pick another month.
 */
export function cycleMonthFor(date: ISODate, endDay = DEFAULT_END_DAY): YearMonth {
  const ym = monthOf(date);
  return date < dateInMonth(ym, Math.max(1, endDay - 1)) ? addMonths(ym, -1) : ym;
}

export type GenerationWarning =
  | { type: 'missing_amount'; recurringItemId: Id; date: ISODate }
  | { type: 'missing_day'; recurringItemId: Id; date: ISODate };

function isActiveOn(item: RecurringItem, date: ISODate): boolean {
  if (item.archived) return false;
  if (item.activeFrom && date < item.activeFrom) return false;
  if (item.activeTo && date > item.activeTo) return false;
  return true;
}

/**
 * Occurrences of the catalog in a cycle.
 *
 * - Expenses count **by date**: every occurrence dated within the cycle, including
 *   those of the next month up to the end day.
 * - Incomes count **by cycle**: one occurrence per income, in month M only. The
 *   salary of the 8th of M+1 belongs to the next cycle even if it falls before the
 *   10th (prudence: never count next cycle's income).
 * - An item with an unknown day is placed on the 1st of its month (the earliest,
 *   hence prudent, choice) and flagged.
 * - An item without an amount is still generated, with `amountCents: null`, and flagged.
 *
 * States are left `pending`; use `withDefaultStates` once the balances are known.
 */
export function generateCycleEntries(
  catalog: RecurringItem[],
  bounds: CycleBounds,
): { entries: CycleEntry[]; warnings: GenerationWarning[] } {
  const entries: CycleEntry[] = [];
  const warnings: GenerationWarning[] = [];

  const months: YearMonth[] = [];
  for (let m = monthOf(bounds.start); m <= monthOf(bounds.end); m = addMonths(m, 1)) months.push(m);

  for (const item of catalog) {
    const candidateMonths = item.kind === 'income' ? [bounds.month] : months;
    for (const ym of candidateMonths) {
      if (!occursInMonth(item.schedule, ym)) continue;
      const date = dateInMonth(ym, item.day ?? 1);
      if (item.kind === 'expense' && (date < bounds.start || date > bounds.end)) continue;
      if (!isActiveOn(item, date)) continue;

      if (item.day == null) warnings.push({ type: 'missing_day', recurringItemId: item.id, date });
      if (item.amountCents == null) warnings.push({ type: 'missing_amount', recurringItemId: item.id, date });
      entries.push({
        id: `${item.id}@${date}`,
        recurringItemId: item.id,
        name: item.name,
        kind: item.kind,
        accountId: item.accountId,
        date,
        amountCents: item.amountCents,
        state: 'pending',
        origin: 'catalog',
      });
    }
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, warnings };
}

/**
 * Default answer to "already in the balance?": yes for anything dated before the
 * balance date of its account, otherwise pending. Excluded entries stay excluded.
 */
export function defaultEntryState(entry: CycleEntry, balances: Balance[]): EntryState {
  if (entry.state === 'excluded') return 'excluded';
  const balance = balances.find((b) => b.accountId === entry.accountId);
  return balance && entry.date < balance.asOf ? 'included_in_balance' : 'pending';
}

export function withDefaultStates(entries: CycleEntry[], balances: Balance[]): CycleEntry[] {
  return entries.map((e) => ({ ...e, state: defaultEntryState(e, balances) }));
}

/**
 * When a cycle is confirmed, the amounts used for `amountMode: 'last'` items become
 * the new proposals. Returns recurringItemId → amount (the latest-dated occurrence wins).
 */
export function lastUsedAmounts(catalog: RecurringItem[], entries: CycleEntry[]): Map<Id, Cents> {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const latest = new Map<Id, CycleEntry>();
  for (const e of entries) {
    if (!e.recurringItemId || e.amountCents == null || e.state === 'excluded') continue;
    if (byId.get(e.recurringItemId)?.amountMode !== 'last') continue;
    const prev = latest.get(e.recurringItemId);
    if (!prev || e.date >= prev.date) latest.set(e.recurringItemId, e);
  }
  return new Map([...latest].map(([id, e]) => [id, e.amountCents as Cents]));
}
