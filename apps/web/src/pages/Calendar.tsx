import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CALENDAR_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  MONTHS_LONG,
  MONTHS_SHORT,
  daysInMonth,
  formatDate,
  formatYearMonth,
  parseDate,
  todayInRome,
  yearCalendar,
  type AccountRecord,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarItem,
  type CycleRecord,
  type ISODate,
  type MonthSummary,
} from '@kakebo/core';
import { useCalendarEvents, useCatalog, useCreateCalendarEvent, useCycles, useDebts, useDeleteCalendarEvent, useUpdateCalendarEvent } from '../api.ts';
import { Button, ErrorNote, Field, Loading, Segmented, cx, inputClass, monoInputClass } from '../ui/kit.tsx';
import { formatDay, listJoin, money, weekdayIndex } from '../format.ts';
import { EmptyNotebook } from './EmptyNotebook.tsx';

/**
 * The year at a glance, as the old "Scadenze" sheet: one column per month, with the
 * catalog, the deadlines, the dates to remember and the open debts. A month view
 * shows the days with their amounts (the real ones, for confirmed cycles).
 */

const WD_LETTER = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const WD_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const WD_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

type View = 'anno' | 'mese';

export function CalendarPage() {
  const catalog = useCatalog();
  const events = useCalendarEvents();
  const debts = useDebts();
  const cycles = useCycles();
  const today = todayInRome();
  // "?mese=2026-11" opens that month (links from other pages).
  const asked = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(new URLSearchParams(window.location.search).get('mese') ?? '');
  const now = asked ? { year: Number(asked[1]), month: Number(asked[2]) } : parseDate(today);
  const [view, setView] = useState<View>(asked ? 'mese' : 'anno');
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const months = useMemo(
    () =>
      catalog.data && events.data && debts.data && cycles.data
        ? yearCalendar(year, {
            items: catalog.data.items,
            events: events.data,
            debts: debts.data,
            cycles: cycles.data,
            cycleEndDay: catalog.data.settings.cycleEndDay,
          })
        : null,
    [catalog.data, events.data, debts.data, cycles.data, year],
  );

  const failed = catalog.error ?? events.error ?? debts.error ?? cycles.error;
  if (failed)
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <ErrorNote error={failed} />
        <Button onClick={() => (catalog.refetch(), events.refetch(), debts.refetch(), cycles.refetch())}>Riprova</Button>
      </div>
    );
  if (!months || !catalog.data || !events.data || !cycles.data) return <Loading />;
  if (catalog.data.accounts.length === 0) return <EmptyNotebook />;

  const accounts = new Map(catalog.data.accounts.map((a) => [a.id, a]));
  const sel = months[month - 1]!;
  const ym = formatYearMonth(year, month);
  const shift = (n: number) => {
    const m = month - 1 + n;
    setYear(year + Math.floor(m / 12));
    setMonth((((m % 12) + 12) % 12) + 1);
  };
  const open = (m: number) => {
    setMonth(m);
    setView('mese');
  };
  const isYear = view === 'anno';
  const monthEvents = events.data.filter((e) => e.month === month);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3.5">
        <div>
          <h1 className="m-0 font-display text-[34px] leading-none font-bold md:text-5xl">
            <span className="hidden md:inline">{isYear ? `Il ${year}, un mese per colonna` : `${cap(MONTHS_LONG[month - 1]!)} ${year}`}</span>
            <span className="md:hidden">Il {year}</span>
          </h1>
          <p className="mt-2 mb-0 max-w-[70ch] text-[15px] text-ink-2">
            <span className={cx(!isYear && 'md:hidden')}>{yearSubtitle(months, year)}</span>
            {!isYear && <span className="hidden md:inline">{monthSubtitle(sel, cycles.data, ym)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-field border-[1.5px] border-ink">
            <button
              type="button"
              onClick={() => (isYear ? setYear(year - 1) : shift(-1))}
              aria-label={isYear ? 'Anno precedente' : 'Mese precedente'}
              className="h-[42px] w-11 cursor-pointer border-none bg-transparent text-lg text-ink"
            >
              ‹
            </button>
            <span className="px-2.5 font-mono text-sm font-semibold">
              <span className={cx(!isYear && 'md:hidden')}>{year}</span>
              {!isYear && (
                <span className="hidden md:inline">
                  {MONTHS_SHORT[month - 1]} {year}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => (isYear ? setYear(year + 1) : shift(1))}
              aria-label={isYear ? 'Anno successivo' : 'Mese successivo'}
              className="h-[42px] w-11 cursor-pointer border-none bg-transparent text-lg text-ink"
            >
              ›
            </button>
          </div>
          <div className="hidden md:block">
            <Segmented
              label="Vista"
              options={[
                ['anno', 'Anno'],
                ['mese', 'Mese'],
              ]}
              value={view}
              onChange={setView}
            />
          </div>
          <Button variant="dashed" onClick={() => setEditing('new')}>
            + Aggiungi data
          </Button>
        </div>
      </div>

      <Legend />

      {editing === 'new' && (
        <div className="mt-4">
          <EventEditor defaultMonth={month} onClose={() => setEditing(null)} />
        </div>
      )}

      {/* desktop */}
      <div className="hidden md:block">
        {isYear ? (
          <YearGrid months={months} today={today} onOpen={open} />
        ) : (
          <MonthGrid summary={sel} accounts={accounts} cycles={cycles.data} today={today} />
        )}
      </div>

      {/* phone: the twelve months as tiles, then the chosen one as an agenda */}
      <div className="md:hidden">
        <MonthTiles months={months} selected={month} today={today} onSelect={setMonth} />
        <h2 className="mt-[26px] mb-0 font-display text-2xl font-bold">{cap(MONTHS_LONG[month - 1]!)}</h2>
        <MonthAgenda summary={sel} accounts={accounts} today={today} />
      </div>

      <EventList
        title={isYear ? `Le date da ricordare` : `Da ricordare a ${MONTHS_LONG[month - 1]}`}
        phoneTitle={`Da ricordare a ${MONTHS_LONG[month - 1]}`}
        all={events.data}
        month={monthEvents}
        showAll={isYear}
        editing={editing}
        onEdit={setEditing}
      />
    </div>
  );
}

// ---------- texts ----------

function yearSubtitle(months: MonthSummary[], year: number): string {
  const heavy = months.filter((m) => m.heavy).map((m) => MONTHS_LONG[Number(m.month.slice(5)) - 1]!);
  const debts = months.reduce((s, m) => s + m.openDebts, 0);
  const parts: string[] = [];
  if (heavy.length === 1) parts.push(`${cap(heavy[0]!)} è il mese pesante.`);
  else if (heavy.length > 1) parts.push(`${cap(listJoin(heavy))} sono i mesi pesanti.`);
  else parts.push(`Nessun mese pesante nel ${year}.`);
  if (debts === 1) parts.push('Un debito di quest’anno è ancora aperto.');
  else if (debts > 1) parts.push(`${debts} debiti di quest’anno sono ancora aperti.`);
  return parts.join(' ');
}

function monthSubtitle(m: MonthSummary, cycles: CycleRecord[], ym: string): string {
  const cycle = cycles.find((c) => c.status === 'confirmed' && c.month === ym);
  const undated = m.items.filter((i) => i.date == null && i.type !== 'event').map((i) => i.name);
  const parts: string[] = [];
  if (cycle) parts.push(`Il ciclo va dal ${formatDay(cycle.plannedOn)} al ${formatDay(cycle.endsOn)}.`);
  else parts.push('Le spese fisse sono quelle del catalogo, all’importo dell’ultima volta.');
  if (undated.length === 1) parts.push(`${undated[0]} è nel mese, senza giorno fisso.`);
  else if (undated.length > 1) parts.push(`${listJoin(undated)} sono nel mese, senza giorno fisso.`);
  return parts.join(' ');
}

/** "+400,00 di scadenze · + TARI · 2 feste · 1 debito aperto" */
function monthWeight(m: MonthSummary): string {
  const parts: string[] = [];
  if (m.deadlinesCents) parts.push(`+${money(m.deadlinesCents)} di scadenze`);
  if (m.deadlinesWithoutAmount.length) parts.push(`+ ${m.deadlinesWithoutAmount.join(', ')}`);
  if (m.events) parts.push(m.events === 1 ? '1 data' : `${m.events} date`);
  if (m.openDebts) parts.push(m.openDebts === 1 ? '1 debito aperto' : `${m.openDebts} debiti aperti`);
  const text = parts.join(' · ');
  if (m.heavy) return `mese pesante · ${text}`;
  return text || 'solo spese fisse';
}

// ---------- marks ----------

const SPECIAL = new Set<CalendarItem['type']>(['deadline', 'event', 'debt']);

function specialClass(i: CalendarItem): string {
  if (i.type === 'debt')
    return 'px-1 font-bold text-verm shadow-[inset_0_0_0_1px_var(--k-verm)] bg-[repeating-linear-gradient(135deg,var(--k-verm-bg)_0_3px,transparent_3px_6px)]';
  if (i.type === 'event') return 'font-hand text-ink';
  return 'px-1 font-bold text-ink shadow-[inset_0_0_0_1px_var(--k-ink)]';
}

function specialText(i: CalendarItem, withAmount = true): string {
  const prefix = i.type === 'debt' ? '未 ' : i.type === 'event' ? '○ ' : '';
  const amount = withAmount && i.type === 'debt' && i.amountCents != null ? ` ${money(i.amountCents)}` : '';
  return prefix + i.name + amount;
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12.5px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-ink-2" />
        uscita fissa
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--k-ink-2)]" />
        entrata
      </span>
      <span className="flex items-center gap-1.5">
        <span className="border border-ink px-[5px] text-[11px] text-ink">scadenza</span>
        scadenza dell’anno
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-hand text-base text-ink">○ Bianca</span>
        compleanno, festa
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cx(specialClass({ type: 'debt' } as CalendarItem), 'text-[11px] font-normal')}>未 debito</span>
        debito non saldato
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-3.5 bg-inv" />
        mese pesante
      </span>
    </div>
  );
}

// ---------- year (desktop) ----------

function YearGrid({ months, today, onOpen }: { months: MonthSummary[]; today: ISODate; onOpen: (m: number) => void }) {
  const t = parseDate(today);
  return (
    <div className="mt-[18px] max-w-[1344px] overflow-x-auto md:w-[calc(100vw-96px)]">
      <div className="grid min-w-[1080px] grid-cols-12 border-l border-rule">
        {months.map((m, idx) => {
          const n = idx + 1;
          const { year } = parseDate(`${m.month}-01`);
          const current = year === t.year && n === t.month;
          const past = year < t.year || (year === t.year && n < t.month);
          const byDay = new Map<string, CalendarItem[]>();
          for (const i of m.items) if (i.date) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
          const slot = m.items.filter((i) => i.date == null);
          const len = daysInMonth(year, n);
          return (
            <div key={m.month} className={cx('min-w-0 border-r border-rule', current && 'shadow-[inset_0_0_0_2px_var(--k-verm)]')}>
              <button
                type="button"
                onClick={() => onOpen(n)}
                aria-label={`Apri ${MONTHS_LONG[idx]} ${year}${m.heavy ? ', mese pesante' : ''}`}
                className={cx(
                  'block h-[80px] w-full cursor-pointer overflow-hidden border-none px-1.5 pt-2 pb-1.5 text-left font-sans',
                  m.heavy ? 'bg-inv text-inv-ink' : 'bg-transparent text-ink',
                  !m.heavy && current && 'shadow-[inset_0_-4px_0_var(--k-verm)]',
                  past && 'opacity-70',
                )}
              >
                <span className="block truncate font-display text-base leading-[1.1] font-bold min-[1400px]:text-lg">{MONTHS_LONG[idx]}</span>
                <span className="mt-1 line-clamp-3 text-[11px] leading-[1.25] opacity-90">{monthWeight(m)}</span>
              </button>
              <div className="flex h-[92px] flex-col gap-[3px] overflow-hidden border-y border-ink px-1.5 pt-1.5 pb-1">
                <span className="text-[10px] tracking-[0.08em] text-ink-2 uppercase">nel mese</span>
                {slot.length === 0 && <span className="text-[11.5px] text-ink-2">—</span>}
                {slot.map((i) => (
                  <span
                    key={i.key}
                    title={specialText(i)}
                    className={cx('block w-fit max-w-full truncate text-[11.5px] leading-[1.3]', specialClass(i), i.type === 'event' && 'text-[14.5px]', past && 'opacity-55')}
                  >
                    {specialText(i)}
                    {i.type === 'deadline' && (i.amountCents != null ? ` ${money(i.amountCents)}` : ' ?')}
                  </span>
                ))}
              </div>
              {Array.from({ length: 31 }, (_, k) => {
                const d = k + 1;
                if (d > len)
                  return <div key={d} aria-hidden="true" className="h-[25px] border-b border-rule-2 bg-[repeating-linear-gradient(135deg,var(--k-rule-2)_0_1px,transparent_1px_5px)]" />;
                const date = formatDate(year, n, d);
                const wd = weekdayIndex(date);
                const items = byDay.get(date) ?? [];
                const dots = items.filter((i) => i.type === 'expense' || i.type === 'income').slice(0, 3);
                const label = items.find((i) => SPECIAL.has(i.type));
                const isToday = date === today;
                const dim = date < today && label?.type !== 'debt';
                return (
                  <div
                    key={d}
                    title={items.length ? items.map((i) => i.name).join(', ') : undefined}
                    className={cx('grid h-[25px] grid-cols-[24px_minmax(0,1fr)] items-center border-b border-rule-2', wd >= 5 && 'bg-wk', dim && 'opacity-60')}
                  >
                    <span className="flex flex-col items-center font-mono leading-none">
                      <span className={cx('text-[10.5px]', isToday ? 'rounded-full bg-verm px-0.5 py-px font-semibold text-seal-ink' : 'text-ink')}>{d}</span>
                      <span className="text-[8px] text-ink-2">{WD_LETTER[wd]}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-[3px] pr-[3px]">
                      {dots.map((i) => (
                        <span
                          key={i.key}
                          className={cx('size-[5px] flex-none rounded-full', i.type === 'expense' ? 'bg-ink-2' : 'shadow-[inset_0_0_0_1.5px_var(--k-ink-2)]')}
                        />
                      ))}
                      {label && (
                        <span className={cx('ml-0.5 min-w-0 truncate text-[10.5px]', specialClass(label), label.type === 'event' && 'text-[13px]')}>
                          {specialText(label)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- month ----------

function itemLine(i: CalendarItem, accounts: Map<string, AccountRecord>): { text: string; amount: string; textClass: string; amountClass: string } {
  const amt = i.amountCents;
  switch (i.type) {
    case 'transfer':
      return {
        text: `${i.done ? '済 ' : ''}Bonifico ${accounts.get(i.accountId!)?.name ?? '?'} → ${accounts.get(i.toAccountId!)?.name ?? '?'}`,
        amount: money(amt ?? 0),
        textClass: i.done ? 'italic text-ink-2' : 'bg-verm-bg px-1 font-bold italic',
        amountClass: i.done ? 'text-ink-2' : 'text-ink',
      };
    case 'income':
      return { text: i.name, amount: amt == null ? '?' : money(amt, true), textClass: 'text-ink-2', amountClass: 'text-ink-2' };
    case 'expense':
      return { text: i.name, amount: amt == null ? '?' : money(-amt), textClass: '', amountClass: 'text-verm' };
    case 'deadline':
      return {
        text: i.name,
        amount: amt == null ? 'importo ?' : money(-amt),
        textClass: specialClass(i),
        amountClass: amt == null ? 'text-ink-2' : 'text-verm',
      };
    case 'event':
      return { text: specialText(i), amount: '', textClass: cx(specialClass(i), 'text-[15px]'), amountClass: '' };
    case 'debt':
      return { text: specialText(i, false), amount: money(amt ?? 0), textClass: specialClass(i), amountClass: 'text-verm' };
  }
}

function cycleFlags(cycles: CycleRecord[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const c of cycles) {
    if (c.status !== 'confirmed') continue;
    flags.set(c.endsOn, 'fine ciclo');
    flags.set(c.plannedOn, 'inizio ciclo');
  }
  return flags;
}

function MonthGrid({
  summary,
  accounts,
  cycles,
  today,
}: {
  summary: MonthSummary;
  accounts: Map<string, AccountRecord>;
  cycles: CycleRecord[];
  today: ISODate;
}) {
  const { year, month } = parseDate(`${summary.month}-01`);
  const len = daysInMonth(year, month);
  const lead = weekdayIndex(`${summary.month}-01`);
  const cells = Math.ceil((lead + len) / 7) * 7;
  const flags = cycleFlags(cycles);
  const slot = summary.items.filter((i) => i.date == null);
  return (
    <>
      {slot.length > 0 && <Slot items={slot} accounts={accounts} />}
      <div className="mt-[18px] grid grid-cols-7 border-t-2 border-l border-t-ink border-l-rule">
        {WD_LONG.map((w) => (
          <div key={w} className="border-r border-b border-r-rule border-b-ink px-2.5 py-2 text-xs tracking-[0.08em] text-ink-2 uppercase">
            {w}
          </div>
        ))}
        {Array.from({ length: cells }, (_, k) => {
          const d = k - lead + 1;
          if (d < 1 || d > len) return <div key={k} className="border-r border-b border-rule bg-wk" />;
          const date = formatDate(year, month, d);
          const items = summary.items.filter((i) => i.date === date);
          const isToday = date === today;
          return (
            <div
              key={k}
              className={cx(
                'flex min-h-[132px] min-w-0 flex-col gap-1 border-r border-b border-rule px-[9px] py-2',
                isToday ? 'shadow-[inset_0_0_0_2px_var(--k-verm)]' : k % 7 >= 5 && 'bg-wk',
              )}
            >
              <span className="flex items-center justify-between">
                <span className={cx('font-display text-xl leading-none font-bold', isToday && 'text-verm')}>{d}</span>
                <span className="text-[11px] text-verm">{flags.get(date)}</span>
              </span>
              {items.map((i) => {
                const l = itemLine(i, accounts);
                return (
                  <span
                    key={i.key}
                    title={`${l.text} ${l.amount}`.trim()}
                    className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-1.5 text-xs leading-[1.3]', date < today && 'opacity-60')}
                  >
                    <span className={cx('min-w-0 truncate', l.textClass)}>{l.text}</span>
                    <span className={cx('font-mono text-[11.5px]', l.amountClass)}>{l.amount}</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Slot({ items, accounts }: { items: CalendarItem[]; accounts: Map<string, AccountRecord> }) {
  return (
    <div className="mt-4 border border-rule bg-page px-3 py-2.5">
      <span className="text-[11px] tracking-[0.08em] text-ink-2 uppercase">nel mese, senza giorno fisso</span>
      {items.map((i) => {
        const l = itemLine(i, accounts);
        return (
          <span key={i.key} className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-[15px]">
            <span className={l.textClass}>{l.text}</span>
            {l.amount && <span className={cx('font-mono text-sm', l.amountClass)}>{l.amount}</span>}
          </span>
        );
      })}
    </div>
  );
}

// ---------- phone ----------

function MonthTiles({
  months,
  selected,
  today,
  onSelect,
}: {
  months: MonthSummary[];
  selected: number;
  today: ISODate;
  onSelect: (m: number) => void;
}) {
  const t = parseDate(today);
  return (
    <div className="mt-4 grid grid-cols-4 gap-1.5">
      {months.map((m, idx) => {
        const n = idx + 1;
        const sel = n === selected;
        const current = m.month === `${t.year}-${String(t.month).padStart(2, '0')}`;
        const text = m.heavy
          ? 'pesante'
          : m.openDebts
            ? m.openDebts === 1
              ? '1 debito'
              : `${m.openDebts} debiti`
            : current
              ? 'adesso'
              : m.events + m.deadlines
                ? `${m.events + m.deadlines} da ricordare`
                : 'tranquillo';
        return (
          <button
            key={m.month}
            type="button"
            onClick={() => onSelect(n)}
            aria-label={`${MONTHS_LONG[idx]}${m.heavy ? ', mese pesante' : ''}`}
            aria-pressed={sel}
            className={cx(
              'min-h-16 cursor-pointer rounded-[2px] p-2 text-left font-sans',
              m.heavy ? 'bg-inv text-inv-ink' : 'bg-transparent text-ink',
              sel ? 'border-2 border-verm' : m.heavy ? 'border-2 border-inv' : 'border border-rule',
            )}
          >
            <span className="block font-display text-base font-bold">{MONTHS_SHORT[idx]}</span>
            <span className="mt-0.5 block text-[11px] leading-[1.2] opacity-90">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

function MonthAgenda({ summary, accounts, today }: { summary: MonthSummary; accounts: Map<string, AccountRecord>; today: ISODate }) {
  const slot = summary.items.filter((i) => i.date == null);
  const days = [...new Set(summary.items.flatMap((i) => (i.date ? [i.date] : [])))];
  return (
    <>
      {slot.length > 0 && <Slot items={slot} accounts={accounts} />}
      <div className="mt-2.5 border-t-2 border-ink">
        {days.length === 0 && <p className="m-0 border-b border-rule py-3 text-[15px] text-ink-2">Niente in questo mese.</p>}
        {days.map((date) => {
          const isToday = date === today;
          return (
            <div
              key={date}
              className={cx('grid grid-cols-[54px_minmax(0,1fr)] gap-x-3 border-b border-rule py-[9px]', isToday && '-mx-4 bg-verm-bg px-4', date < today && 'opacity-60')}
            >
              <div className="leading-[1.1]">
                <span className="block text-[11px] text-ink-2">{isToday ? 'oggi' : WD_SHORT[weekdayIndex(date)]}</span>
                <span className={cx('font-display text-[22px] font-bold', isToday && 'text-verm')}>{Number(date.slice(8))}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                {summary.items
                  .filter((i) => i.date === date)
                  .map((i) => {
                    const l = itemLine(i, accounts);
                    return (
                      <span key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-[14.5px]">
                        <span className={cx('w-fit', l.textClass)}>{l.text}</span>
                        <span className={cx('font-mono text-sm', l.amountClass)}>{l.amount}</span>
                      </span>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- dates to remember ----------

function EventList({
  title,
  phoneTitle,
  all,
  month,
  showAll,
  editing,
  onEdit,
}: {
  title: string;
  phoneTitle: string;
  all: CalendarEvent[];
  month: CalendarEvent[];
  showAll: boolean;
  editing: string | null;
  onEdit: (id: string | null) => void;
}) {
  const row = (e: CalendarEvent, withMonth: boolean) =>
    editing === e.id ? (
      <div key={e.id} className="mt-2">
        <EventEditor event={e} defaultMonth={e.month} onClose={() => onEdit(null)} />
      </div>
    ) : (
      <div key={e.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-rule py-2">
        <span className="font-mono text-sm text-ink-2">
          {e.day ?? '—'}
          {withMonth && ` ${MONTHS_SHORT[e.month - 1]}`}
        </span>
        <span className="min-w-0">
          <span className={cx(e.type === 'other' ? 'text-base' : 'font-hand text-lg')}>{e.title}</span>
          <span className="ml-2 text-xs text-ink-2">{EVENT_TYPE_LABELS[e.type]}</span>
          {e.note && <span className="block text-[13px] text-ink-2">{e.note}</span>}
        </span>
        <Button variant="quiet" aria-label={`Modifica ${e.title}`} onClick={() => onEdit(e.id)}>
          modifica
        </Button>
      </div>
    );

  const empty = (
    <p className="m-0 border-b border-rule py-3 text-[15px] text-ink-2">
      Nessuna data. Compleanni, anniversari e feste si aggiungono con “+ Aggiungi data”: compaiono nel calendario, ma non entrano nella programmazione.
    </p>
  );

  return (
    <section aria-label="Date da ricordare" className="mt-10 max-w-[760px]">
      <h2 className="m-0 border-b-2 border-ink pb-2 font-display text-xl font-bold">
        <span className="hidden md:inline">{title}</span>
        <span className="md:hidden">{phoneTitle}</span>
      </h2>
      {/* phone: always the chosen month */}
      <div className="md:hidden">{month.length ? month.map((e) => row(e, false)) : empty}</div>
      <div className="hidden md:block">
        {showAll ? (all.length ? all.map((e) => row(e, true)) : empty) : month.length ? month.map((e) => row(e, false)) : empty}
      </div>
    </section>
  );
}

function EventEditor({ event, defaultMonth, onClose }: { event?: CalendarEvent; defaultMonth: number; onClose: () => void }) {
  const [type, setType] = useState<CalendarEventType>(event?.type ?? 'birthday');
  const [title, setTitle] = useState(event?.title ?? '');
  const [month, setMonth] = useState(event?.month ?? defaultMonth);
  const [day, setDay] = useState(event?.day != null ? String(event.day) : '');
  const [note, setNote] = useState(event?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const del = useDeleteCalendarEvent();
  const ref = useRef<HTMLInputElement>(null);
  const pending = create.isPending || update.isPending || del.isPending;

  useEffect(() => ref.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = day ? Number(day) : null;
    if (!title.trim()) return setProblem('scrivi cosa ricordare');
    if (d != null && (d < 1 || d > daysInMonth(2024, month))) return setProblem(`a ${MONTHS_LONG[month - 1]} quel giorno non c’è`);
    setProblem(null);
    const value = { type, title: title.trim(), month, day: d, note: note.trim() || null };
    if (event) update.mutate({ id: event.id, patch: value }, { onSuccess: onClose });
    else create.mutate(value, { onSuccess: onClose });
  };

  return (
    <form
      aria-label={event ? `Modifica ${event.title}` : 'Nuova data da ricordare'}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="mb-1.5 max-w-[760px] animate-open border-[1.5px] border-ink bg-page px-4 pt-5 pb-[18px] md:px-[22px]"
    >
      <Segmented
        label="Tipo"
        size="sm"
        options={CALENDAR_EVENT_TYPES.map((t) => [t, EVENT_TYPE_LABELS[t]] as const)}
        value={type}
        onChange={setType}
      />
      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-4">
        <Field label="cosa" className="flex-[3_1_220px]">
          <input
            ref={ref}
            className={inputClass}
            value={title}
            maxLength={120}
            placeholder={type === 'birthday' ? 'Compleanno di…' : type === 'anniversary' ? 'Anniversario…' : 'Natale'}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="giorno" className="flex-[0_1_80px]">
          <input
            className={monoInputClass}
            inputMode="numeric"
            value={day}
            placeholder="?"
            aria-describedby="day-hint"
            onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </Field>
      </div>
      <fieldset className="m-0 mt-4 border-none p-0">
        <legend className="p-0 text-xs text-ink-2">mese</legend>
        <div role="group" aria-label="Mese" className="mt-1.5 grid max-w-[360px] grid-cols-6 gap-1">
          {MONTHS_SHORT.map((m, i) => (
            <button
              key={m}
              type="button"
              aria-pressed={month === i + 1}
              onClick={() => setMonth(i + 1)}
              className={cx(
                'min-h-9 cursor-pointer rounded-[2px] border font-sans text-[13px]',
                month === i + 1 ? 'border-inv bg-inv text-inv-ink' : 'border-rule bg-transparent text-ink',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>
      <p id="day-hint" className="mt-2 mb-0 text-[13px] text-ink-2">
        Senza giorno, la data resta “nel mese”. Torna ogni anno.
      </p>
      <Field label="nota (facoltativa)" className="mt-3.5">
        <input className={cx(inputClass, 'text-[15px]')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-3">
        <ErrorNote error={problem ?? create.error ?? update.error ?? del.error} />
      </div>
      <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
        <Button variant="primary" type="submit" disabled={pending} className="min-h-[46px] px-5">
          {pending ? 'Salvo…' : 'Salva'}
        </Button>
        <Button onClick={onClose} className="min-h-[46px]">
          Annulla
        </Button>
        <span className="flex-1" />
        {event && (
          <Button
            variant="danger"
            className="min-h-[46px]"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Elimino “${event.title}” dal calendario?`)) del.mutate(event.id, { onSuccess: onClose });
            }}
          >
            Elimina
          </Button>
        )}
      </div>
    </form>
  );
}
