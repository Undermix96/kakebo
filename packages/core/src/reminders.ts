import { z } from 'zod';
import type { Cents } from './money.ts';
import { dateInMonth, daysInMonth, formatDate, formatYearMonth, minDate, monthOf, parseYearMonth, type ISODate, type YearMonth } from './dates.ts';
import { DEFAULT_END_DAY, occursInMonth } from './cycle.ts';
import type { CatalogItem } from './catalog.ts';
import type { CalendarEvent, CycleRecord, Debt } from './cycle-record.ts';
import type { Id } from './types.ts';
import { isoDate, positiveCents } from './schemas.ts';

/**
 * Calendar dates (birthdays, anniversaries, holidays) and debts: reminders only,
 * never planned automatically. Plus the calendar of the year, which puts them next
 * to the catalog and the confirmed cycles.
 */

// ---------- calendar dates ----------

export const CALENDAR_EVENT_TYPES = ['birthday', 'anniversary', 'other'] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

const eventFields = z.object({
  type: z.enum(CALENDAR_EVENT_TYPES),
  title: z.string().trim().min(1, 'scrivi cosa ricordare').max(120),
  month: z.number().int().min(1).max(12),
  /** null = only the month is known ("Compleanno Vale, gennaio"). */
  day: z.number().int().min(1).max(31).nullable(),
  note: z.string().trim().max(500).nullish(),
});

/** 29 February is allowed (it falls on the 28th in common years); 31 April is not. */
export const eventDayIsValid = (e: { month?: number; day?: number | null }) =>
  e.month == null || e.day == null || e.day <= daysInMonth(2024, e.month);
export const EVENT_DAY_MESSAGE = 'quel giorno non esiste in quel mese';

export const calendarEventCreateSchema = eventFields.refine(eventDayIsValid, { message: EVENT_DAY_MESSAGE, path: ['day'] });
export type CalendarEventCreate = z.input<typeof calendarEventCreateSchema>;
export const calendarEventPatchSchema = eventFields.partial().refine(eventDayIsValid, { message: EVENT_DAY_MESSAGE, path: ['day'] });
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>;

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  birthday: 'compleanno',
  anniversary: 'anniversario',
  other: 'festa o altro',
};

// ---------- debts ----------

const debtFields = z.object({
  /** When it was due (or when it was born). */
  date: isoDate,
  description: z.string().trim().min(1, 'scrivi di cosa si tratta').max(200),
  amountCents: positiveCents.refine((v) => v > 0, 'importo mancante'),
  paidOn: isoDate.nullish(),
  note: z.string().trim().max(500).nullish(),
});
export const debtCreateSchema = debtFields;
export type DebtCreate = z.input<typeof debtCreateSchema>;
export const debtPatchSchema = debtFields.partial();
export type DebtPatch = z.infer<typeof debtPatchSchema>;

/** Open debts, the oldest first. */
export const openDebts = (debts: Debt[]) => debts.filter((d) => !d.paidOn).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// ---------- the calendar ----------

/**
 * What a day (or a month, when the day is unknown) shows:
 * - `expense` / `income`: monthly catalog items, or the real entries of a confirmed cycle;
 * - `deadline`: an expense that is not monthly (bolli, TARI, the yearly insurance);
 * - `transfer`: a transfer of a confirmed cycle, on its due day (or the day it was stamped);
 * - `event`: a birthday, an anniversary, a holiday;
 * - `debt`: an open debt, on its date.
 */
export type CalendarItemType = 'expense' | 'income' | 'deadline' | 'transfer' | 'event' | 'debt';

export interface CalendarItem {
  key: string;
  type: CalendarItemType;
  name: string;
  /** null = in the month, with no fixed day. */
  date: ISODate | null;
  /** Positive; null = not known yet (never invented). */
  amountCents: Cents | null;
  accountId?: Id;
  toAccountId?: Id;
  /** Transfer stamped as done. */
  done?: boolean;
  /** Comes from a confirmed cycle (real amounts) rather than from the catalog. */
  fromCycle?: boolean;
  eventType?: CalendarEventType;
  /** Id of the catalog item, entry, transfer, date or debt. */
  refId: Id;
}

export type CalendarCycle = Pick<CycleRecord, 'month' | 'plannedOn' | 'endsOn' | 'status' | 'entries' | 'transfers'>;

export interface CalendarSources {
  items: CatalogItem[];
  events: CalendarEvent[];
  debts: Debt[];
  /** Stored cycles: only confirmed ones are used. */
  cycles?: CalendarCycle[];
  /** Settings' cycle end day (where a cycle starts at the latest). */
  cycleEndDay?: number;
}

const TYPE_ORDER: Record<CalendarItemType, number> = { debt: 0, event: 1, income: 2, transfer: 3, deadline: 4, expense: 5 };

const isActiveOn = (item: CatalogItem, date: ISODate) =>
  !item.archived && (!item.activeFrom || date >= item.activeFrom) && (!item.activeTo || date <= item.activeTo);

const isSeasonal = (item: Pick<CatalogItem, 'schedule'> | undefined) => !!item && item.schedule.type !== 'monthly';

/** The confirmed cycle that owns a day: the most recent one whose span contains it. */
function cycleOwner(cycles: CalendarCycle[], endDay: number): (date: ISODate) => CalendarCycle | undefined {
  const spans = cycles
    .filter((c) => c.status === 'confirmed')
    .map((c) => {
      const first = c.entries.reduce((d, e) => minDate(d, e.date), c.plannedOn);
      return { c, start: minDate(first, dateInMonth(c.month, endDay)), end: c.endsOn };
    })
    .sort((a, b) => (a.c.month < b.c.month ? 1 : -1));
  return (date) => spans.find((s) => s.start <= date && date <= s.end)?.c;
}

/** Everything the calendar shows in a month, sorted by day (undated items first). */
export function monthCalendar(ym: YearMonth, src: CalendarSources): CalendarItem[] {
  const { year, month } = parseYearMonth(ym);
  const owner = cycleOwner(src.cycles ?? [], src.cycleEndDay ?? DEFAULT_END_DAY);
  const itemsById = new Map(src.items.map((i) => [i.id, i]));
  const out: CalendarItem[] = [];

  // Real entries and transfers of the confirmed cycles, on the days they own.
  const fromCycles = new Set<Id>(); // catalog items already shown from a cycle this month
  for (const c of (src.cycles ?? []).filter((c) => c.status === 'confirmed')) {
    for (const e of c.entries) {
      if (monthOf(e.date) !== ym || owner(e.date) !== c || e.state === 'excluded') continue;
      if (e.recurringItemId) fromCycles.add(e.recurringItemId);
      const item = e.recurringItemId ? itemsById.get(e.recurringItemId) : undefined;
      out.push({
        key: `entry:${c.month}:${e.id}`,
        type: e.kind === 'income' ? 'income' : isSeasonal(item) ? 'deadline' : 'expense',
        name: e.name,
        date: e.date,
        amountCents: e.amountCents,
        accountId: e.accountId,
        fromCycle: true,
        refId: e.id,
      });
    }
    for (const t of c.transfers) {
      const date = t.doneOn ?? t.dueDate;
      if (monthOf(date) !== ym || owner(date) !== c) continue;
      out.push({
        key: `transfer:${t.id}`,
        type: 'transfer',
        name: 'Bonifico',
        date,
        amountCents: t.amountCents,
        accountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        done: !!t.doneOn,
        fromCycle: true,
        refId: t.id,
      });
    }
  }

  // The catalog, on the days no confirmed cycle owns.
  for (const item of src.items) {
    if (!occursInMonth(item.schedule, ym)) continue;
    const date = item.day == null ? null : dateInMonth(ym, item.day);
    if (!isActiveOn(item, date ?? dateInMonth(ym, 1))) continue;
    if (date ? owner(date) : fromCycles.has(item.id)) continue;
    out.push({
      key: `item:${item.id}:${ym}`,
      type: item.kind === 'income' ? 'income' : isSeasonal(item) ? 'deadline' : 'expense',
      name: item.name,
      date,
      amountCents: item.amountCents,
      accountId: item.accountId,
      refId: item.id,
    });
  }

  for (const e of src.events) {
    if (e.month !== month) continue;
    out.push({
      key: `event:${e.id}`,
      type: 'event',
      name: e.title,
      date: e.day == null ? null : formatDate(year, month, Math.min(e.day, daysInMonth(year, month))),
      amountCents: null,
      eventType: e.type,
      refId: e.id,
    });
  }

  for (const d of src.debts) {
    if (d.paidOn || monthOf(d.date) !== ym) continue;
    out.push({ key: `debt:${d.id}`, type: 'debt', name: d.description, date: d.date, amountCents: d.amountCents, refId: d.id });
  }

  return out.sort(
    (a, b) =>
      (a.date ?? '').localeCompare(b.date ?? '') ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.name.localeCompare(b.name, 'it'),
  );
}

/** A month is "heavy" when its deadlines weigh at least this much… */
export const HEAVY_DEADLINES_CENTS = 25_000;
/** …or when there are at least this many things to remember (deadlines and dates). */
export const HEAVY_REMINDERS = 4;

export interface MonthSummary {
  month: YearMonth;
  items: CalendarItem[];
  /** Deadlines with a known amount, summed. */
  deadlinesCents: Cents;
  /** Names of the deadlines without an amount. */
  deadlinesWithoutAmount: string[];
  deadlines: number;
  events: number;
  openDebts: number;
  heavy: boolean;
}

export function summarizeMonth(ym: YearMonth, items: CalendarItem[]): MonthSummary {
  const deadlines = items.filter((i) => i.type === 'deadline');
  const deadlinesCents = deadlines.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const events = items.filter((i) => i.type === 'event').length;
  return {
    month: ym,
    items,
    deadlinesCents,
    deadlinesWithoutAmount: [...new Set(deadlines.filter((i) => i.amountCents == null).map((i) => i.name))],
    deadlines: deadlines.length,
    events,
    openDebts: items.filter((i) => i.type === 'debt').length,
    heavy: deadlinesCents >= HEAVY_DEADLINES_CENTS || deadlines.length + events >= HEAVY_REMINDERS,
  };
}

/** The twelve months of a year. */
export function yearCalendar(year: number, src: CalendarSources): MonthSummary[] {
  return Array.from({ length: 12 }, (_, i) => {
    const ym = formatYearMonth(year, i + 1);
    return summarizeMonth(ym, monthCalendar(ym, src));
  });
}
