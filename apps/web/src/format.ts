import { MONTHS_SHORT, parseDate, type ISODate } from '@kakebo/core';

/** "1 gen 2027" (the year only when it is not the current one). */
export function formatDay(date: ISODate, currentYear = new Date().getFullYear()): string {
  const { year, month, day } = parseDate(date);
  return `${day} ${MONTHS_SHORT[month - 1]}${year === currentYear ? '' : ` ${year}`}`;
}
