import type { CSSProperties, ReactNode } from 'react';
import { addDays, daysBetween, parseDate, type AccountRecord, type Cents, type CycleEntry, type ISODate } from '@kakebo/core';
import { AccountGlyph, accountColor, cx } from './kit.tsx';
import { formatDay, listJoin, money, ofDay } from '../format.ts';

/** Pieces shared by the planning result, the home page and the history. */

/** The 済 stamp: a dashed circle that receives the seal when a transfer is done. */
export function Stamp({
  done,
  onToggle,
  label,
  size = 'lg',
  disabled,
}: {
  done: boolean;
  onToggle?: () => void;
  label: string;
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
}) {
  const box = size === 'lg' ? 'size-14' : size === 'md' ? 'size-12' : 'size-[22px]';
  const seal = (
    <span
      aria-hidden="true"
      className={cx(
        'absolute inset-px flex flex-col items-center justify-center rounded-full border-verm bg-verm-bg font-display leading-none font-extrabold text-verm motion-safe:animate-hanko motion-reduce:-rotate-12',
        size === 'lg' ? 'border-[3px]' : size === 'md' ? 'border-[2.5px]' : 'border-[1.5px]',
      )}
    >
      <span className={size === 'lg' ? 'text-[22px]' : size === 'md' ? 'text-[19px]' : 'text-[11px]'}>済</span>
      {size === 'lg' && <span className="mt-0.5 text-[9px] tracking-[0.08em]">FATTO</span>}
    </span>
  );
  if (!onToggle) {
    return (
      <span
        role="img"
        aria-label={done ? `fatto: ${label}` : `non ancora fatto: ${label}`}
        className={cx('relative inline-grid flex-none place-items-center rounded-full', box, !done && 'border-[1.5px] border-dashed border-ink-2')}
      >
        {done && seal}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={done}
      aria-label={(done ? 'Timbrato, fatto: ' : 'Timbra come fatto: ') + label}
      className={cx(
        'relative grid flex-none cursor-pointer place-items-center rounded-full border-[1.5px] border-dashed border-ink-2 bg-transparent p-0 disabled:cursor-wait',
        box,
      )}
    >
      {done ? seal : <span className={cx('text-ink-2', size === 'lg' ? 'text-[11px]' : 'text-[10px]')}>timbra</span>}
    </button>
  );
}

/** One day of a projection: more ink = more money, a dot = zero, hatching = below zero. */
export function cellStyle(cents: Cents, color: string, scale: Cents): CSSProperties {
  if (cents > 0) return { background: color, opacity: Number((0.2 + 0.8 * Math.min(1, cents / Math.max(1, scale))).toFixed(2)) };
  if (cents < 0)
    return {
      background: 'repeating-linear-gradient(135deg, var(--k-verm) 0 2px, transparent 2px 5px)',
      boxShadow: 'inset 0 0 0 1.5px var(--k-verm)',
    };
  return {
    background: 'radial-gradient(circle, var(--k-zero) 1.5px, transparent 2px)',
    boxShadow: 'inset 0 0 0 1px var(--k-cell-zero)',
  };
}

/** Scale of the ink: the largest positive balance shown, at least 500 €. */
export function inkScale(series: Cents[][]): Cents {
  return Math.max(50000, ...series.flat());
}

export function accountInk(a: AccountRecord | undefined): string {
  return a ? accountColor(a.color) : 'var(--k-ink)';
}

/** Row of day cells. */
export function DayCells({
  values,
  dates,
  color,
  scale,
  today,
  label,
  height = 20,
  gap = 3,
  animate,
}: {
  values: Cents[];
  dates: ISODate[];
  color: string;
  scale: Cents;
  today?: ISODate;
  label: string;
  height?: number;
  gap?: number;
  animate?: boolean;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`, columnGap: gap }}>
      {values.map((v, i) => (
        <div
          key={dates[i]}
          title={`${label}, ${formatDay(dates[i]!)}: ${money(v)} €`}
          className={cx('rounded-[1px]', animate && 'motion-safe:animate-ink')}
          style={{
            height,
            ...cellStyle(v, color, scale),
            ...(animate ? { animationDelay: `${Math.min(i * 12, 400)}ms` } : {}),
            ...(dates[i] === today ? { outline: '2px solid var(--k-verm)', outlineOffset: 1 } : {}),
          }}
        />
      ))}
    </div>
  );
}

/** Day numbers above the cells: today in a vermilion dot, the 1st of a month underlined. */
export function DayLabels({ dates, today, small }: { dates: ISODate[]; today?: ISODate; small?: boolean }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`, columnGap: 3 }}>
      {dates.map((d) => {
        const day = parseDate(d).day;
        return (
          <div
            key={d}
            className={cx(
              'grid place-items-center font-mono',
              small ? 'h-3.5 text-[9px]' : 'h-[18px] text-[9.5px]',
              d === today ? 'rounded-full bg-verm font-semibold text-seal-ink' : day === 1 ? 'font-semibold text-ink shadow-[inset_1.5px_0_0_var(--k-ink)]' : 'text-ink-2',
            )}
          >
            {day}
          </div>
        );
      })}
    </div>
  );
}

export function datesBetween(start: ISODate, end: ISODate): ISODate[] {
  return Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
}

/** "per la spesa dell’11", "luce e gas del 6 dic", "asilo, mutuo e altre 3". */
export function transferWhy(coversEntryIds: string[], entries: CycleEntry[]): string {
  const covered = coversEntryIds
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is CycleEntry => !!e)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (covered.length === 0) return '';
  const days = [...new Set(covered.map((e) => e.date))];
  const names = covered.map((e) => e.name);
  if (covered.length > 4) return `per ${names.slice(0, 3).join(', ')} e altre ${covered.length - 3} spese`;
  const when = days.length === 1 ? ` ${ofDay(days[0]!)}` : '';
  return `per ${listJoin(names)}${when}`;
}

export function Glyph({ account }: { account: AccountRecord | undefined }) {
  return account ? <AccountGlyph color={account.color} shape={account.shape} /> : <span className="inline-block h-1 w-3.5 bg-ink" />;
}

/** "Banca Blu → Carta Spesa" with the account glyphs. */
export function Route({ from, to, className }: { from?: AccountRecord; to?: AccountRecord; className?: string }) {
  return (
    <span className={cx('flex min-w-0 flex-wrap items-center gap-x-[7px] gap-y-1 font-bold', className)}>
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap">
        <Glyph account={from} />
        {from?.name ?? '?'}
      </span>
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap">
        <span className="font-normal text-ink-2">→</span>
        <Glyph account={to} />
        {to?.name ?? '?'}
      </span>
    </span>
  );
}

/** Rounded vermilion note for things to look at (outline) or bad news (filled). */
export function Notice({ children, tone = 'outline', role = 'note' }: { children: ReactNode; tone?: 'outline' | 'filled'; role?: 'note' | 'alert' }) {
  return (
    <div
      role={role}
      className={cx(
        'flex items-start gap-3 rounded-field px-3.5 py-3 text-[14.5px] leading-[1.45]',
        tone === 'outline' ? 'border-[1.5px] border-verm' : 'bg-verm text-seal-ink',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid size-[22px] flex-none place-items-center rounded-full border-[1.5px] text-[13px] font-bold',
          tone === 'outline' ? 'border-verm text-verm' : 'border-seal-ink',
        )}
      >
        !
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
