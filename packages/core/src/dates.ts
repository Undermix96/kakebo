/**
 * Calendar dates as ISO strings. Days are never represented with a local `Date`:
 * arithmetic goes through an integer day count (days since 1970-01-01), so there
 * is no time zone or DST involved.
 */

/** A calendar day, `YYYY-MM-DD` (Europe/Rome). */
export type ISODate = string;
/** A calendar month, `YYYY-MM`. */
export type YearMonth = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isISODate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(m[1]), month);
}

export function isYearMonth(s: string): boolean {
  const m = MONTH_RE.exec(s);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function parseDate(s: ISODate): { year: number; month: number; day: number } {
  if (!isISODate(s)) throw new RangeError(`invalid ISO date: ${s}`);
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

export function parseYearMonth(s: YearMonth): { year: number; month: number } {
  if (!isYearMonth(s)) throw new RangeError(`invalid year-month: ${s}`);
  const [y, m] = s.split('-').map(Number) as [number, number];
  return { year: y, month: m };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function formatYearMonth(year: number, month: number): YearMonth {
  return `${pad(year, 4)}-${pad(month)}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Day `day` of the month, clamped to the last day (31 → 30 in November, 29 → 28 in February). */
export function dateInMonth(ym: YearMonth, day: number): ISODate {
  const { year, month } = parseYearMonth(ym);
  return formatDate(year, month, Math.min(Math.max(1, day), daysInMonth(year, month)));
}

export function monthOf(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  const idx = year * 12 + (month - 1) + n;
  return formatYearMonth(Math.floor(idx / 12), (((idx % 12) + 12) % 12) + 1);
}

/** Days since 1970-01-01 (proleptic Gregorian). */
export function toEpochDay(date: ISODate): number {
  const { year, month, day } = parseDate(date);
  // Howard Hinnant's days_from_civil
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(n: number): ISODate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return formatDate(yoe + era * 400 + (month <= 2 ? 1 : 0), month, day);
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromEpochDay(toEpochDay(date) + n);
}

/** Number of days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** ISO dates compare correctly as strings; these helpers just make intent explicit. */
export const minDate = (a: ISODate, b: ISODate): ISODate => (a <= b ? a : b);
export const maxDate = (a: ISODate, b: ISODate): ISODate => (a >= b ? a : b);

/** Today's date in Europe/Rome, whatever the server's time zone. */
export function todayInRome(now: Date = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
