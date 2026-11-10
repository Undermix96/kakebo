import { MONTHS_LONG, MONTHS_SHORT, daysBetween, formatEuro, parseDate, toEpochDay, type Cents, type ISODate } from '@kakebo/core';

/** "1 gen 2027" (the year only when it is not the current one). */
export function formatDay(date: ISODate, currentYear = new Date().getFullYear()): string {
  const { year, month, day } = parseDate(date);
  return `${day} ${MONTHS_SHORT[month - 1]}${year === currentYear ? '' : ` ${year}`}`;
}

const WEEKDAYS_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'] as const;
const WEEKDAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'] as const;

/** 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export const weekdayIndex = (date: ISODate) => (((toEpochDay(date) + 3) % 7) + 7) % 7;

/** "lun 9 nov" */
export function formatDayWeek(date: ISODate): string {
  return `${WEEKDAYS_SHORT[weekdayIndex(date)]} ${formatDay(date)}`;
}

/** "lunedì 9 novembre" */
export function formatDayLong(date: ISODate): string {
  const { month, day } = parseDate(date);
  return `${WEEKDAYS_LONG[weekdayIndex(date)]} ${day} ${MONTHS_LONG[month - 1]}`;
}

export const weekdayShort = (date: ISODate) => WEEKDAYS_SHORT[weekdayIndex(date)];
export const weekdayLong = (date: ISODate) => WEEKDAYS_LONG[weekdayIndex(date)];

/** "oggi", "domani", "tra 5 giorni", "ieri", "3 giorni fa". */
export function relativeDay(date: ISODate, today: ISODate): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  if (n === -1) return 'ieri';
  return n > 0 ? `tra ${n} giorni` : `${-n} giorni fa`;
}

/** Amount without the € sign: "1.234,00", "−42,00", "+950,00" with `plus`. */
export const money = (cents: Cents, plus = false) => formatEuro(cents, { symbol: false, plus });

/** "novembre 2026" */
export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_LONG[m! - 1]} ${y}`;
}

/** "Novembre" */
export function monthName(ym: string): string {
  const m = Number(ym.slice(5, 7));
  const name = MONTHS_LONG[m - 1]!;
  return name[0]!.toUpperCase() + name.slice(1);
}

/** "a, b e c" */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

// Articles before a date: "l’11 nov", "dall’8 dic", "al 20 nov".
const elides = (date: ISODate) => [8, 11].includes(parseDate(date).day);
export const theDay = (d: ISODate) => (elides(d) ? 'l’' : 'il ') + formatDay(d);
export const fromDay = (d: ISODate) => (elides(d) ? 'dall’' : 'dal ') + formatDay(d);
export const toDay = (d: ISODate) => (elides(d) ? 'all’' : 'al ') + formatDay(d);
export const ofDay = (d: ISODate) => (elides(d) ? 'dell’' : 'del ') + formatDay(d);

/** How long a debt has been waiting: "da 40 giorni", "da 5 mesi e mezzo", "da quasi 3 mesi", "scade tra 4 giorni". */
export function debtAge(date: ISODate, today: ISODate): string {
  const n = daysBetween(date, today);
  if (n < -1) return `scade tra ${-n} giorni`;
  if (n === -1) return 'scade domani';
  if (n === 0) return 'scade oggi';
  if (n === 1) return 'da ieri';
  if (n < 45) return `da ${n} giorni`;
  const MONTH = 30.44;
  const months = Math.floor(n / MONTH);
  const rest = n - months * MONTH;
  if (months >= 12) {
    const years = Math.floor(n / 365.25);
    return years === 1 ? 'da più di un anno' : `da più di ${years} anni`;
  }
  if (rest >= 22) return months + 1 === 12 ? 'da quasi un anno' : `da quasi ${months + 1} mesi`;
  if (rest >= 12) return `da ${months === 1 ? 'un mese' : `${months} mesi`} e mezzo`;
  return months === 1 ? 'da un mese' : `da ${months} mesi`;
}
