import {
  addDays,
  daysBetween,
  todayInRome,
  type AccountRecord,
  type CycleRecord,
  type Debt,
  type ISODate,
  type PlanResult,
} from '@kakebo/core';
import { useCatalog, useCycles, useDebts, useDeleteDraft, useStampTransfer } from '../api.ts';
import { Link } from '../router.tsx';
import { Button, ErrorNote, Hand, Loading, cx } from '../ui/kit.tsx';
import { DayCells, Glyph, Notice, Route, Stamp, accountInk, datesBetween, inkScale } from '../ui/cycle.tsx';
import { formatDay, formatDayLong, formatDayWeek, money, monthName, relativeDay, weekdayLong, fromDay, toDay, theDay } from '../format.ts';
import { currentCycle, storedPlan, type StoredPlan } from '../cycles.ts';
import { EmptyNotebook } from './EmptyNotebook.tsx';
import { isTight } from './plan/Result.tsx';

export function HomePage() {
  const catalog = useCatalog();
  const cycles = useCycles();
  const debts = useDebts();
  const today = todayInRome();

  if (catalog.isPending || cycles.isPending) return <Loading />;
  if (catalog.isError || cycles.isError)
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <ErrorNote error={catalog.error ?? cycles.error} />
        <Button onClick={() => (catalog.refetch(), cycles.refetch())}>Riprova</Button>
      </div>
    );
  if (catalog.data.accounts.length === 0) return <EmptyNotebook />;

  const current = currentCycle(cycles.data, today);
  const draft = cycles.data.find((c) => c.status === 'draft');
  const sp = current ? storedPlan(current, catalog.data.accounts, catalog.data.settings) : null;
  const overdue = (debts.data ?? []).filter((d) => !d.paidOn && d.date < today);

  return (
    <div className="-mx-4 -mt-5 flex flex-wrap md:-mx-12 md:-mt-[30px]">
      <section aria-labelledby="verdetto" className="box-border min-w-0 flex-[5_1_440px] px-4 pt-6 pb-2 md:pt-10 md:pr-12 md:pb-14 md:pl-14">
        {draft && <DraftBanner draft={draft} />}
        {current && sp ? (
          <Verdict cycle={current} sp={sp} today={today} />
        ) : (
          <FirstCycle today={today} hasDraft={!!draft} />
        )}
        <div className="hidden md:block">{overdue.length > 0 && <Debts debts={overdue} />}</div>
      </section>

      <section
        aria-labelledby="prossimi"
        className="box-border min-w-0 flex-[7_1_640px] border-l border-rule bg-page px-4 pt-6 pb-8 shadow-fold md:pt-10 md:pr-12 md:pb-14 md:pl-11"
      >
        {current && sp ? (
          <>
            <Agenda plan={sp.plan} accounts={sp.accounts} cycle={current} today={today} />
            <div className="md:hidden">{overdue.length > 0 && <Debts debts={overdue} compact />}</div>
            <Accounts plan={sp.plan} accounts={sp.accounts} today={today} />
          </>
        ) : (
          <>
            <h2 id="prossimi" className="m-0 font-display text-2xl font-bold">
              Prossimi 14 giorni
            </h2>
            <p className="mt-3 text-[15px] leading-normal text-ink-2">
              Dopo la prima programmazione qui vedrai le uscite dei prossimi giorni, con i bonifici da fare in mezzo.
            </p>
            <div className="md:hidden">{overdue.length > 0 && <Debts debts={overdue} compact />}</div>
          </>
        )}
      </section>
    </div>
  );
}

function DraftBanner({ draft }: { draft: CycleRecord }) {
  const del = useDeleteDraft();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-[1.5px] border-dashed border-ink-2 px-4 py-3">
      <span className="min-w-0 flex-1 text-[15px]">
        <strong>La programmazione di {monthName(draft.month).toLowerCase()} è a metà.</strong>{' '}
        <span className="text-ink-2">salvata {formatDayWeek(draft.updatedAt.slice(0, 10))}</span>
      </span>
      <Link href={`/programmazione?mese=${draft.month}`} className="inline-flex min-h-11 items-center rounded-field bg-inv px-4 text-[15px] font-bold text-inv-ink no-underline">
        Riprendi
      </Link>
      {draft.transfers.length === 0 && (
        <Button
          variant="danger"
          disabled={del.isPending}
          onClick={() => {
            if (window.confirm(`Scarto la bozza di ${monthName(draft.month).toLowerCase()}? Saldi e importi scritti si perdono.`)) del.mutate(draft.month);
          }}
        >
          Scarta
        </Button>
      )}
      <ErrorNote error={del.error} />
    </div>
  );
}

function FirstCycle({ today, hasDraft }: { today: ISODate; hasDraft: boolean }) {
  return (
    <>
      <div className="text-[15px] text-ink-2">{formatDayLong(today)}</div>
      <h1 id="verdetto" className="mt-2.5 mb-0 font-display text-[40px] leading-[1.02] font-bold tracking-[-0.01em] text-balance md:text-[58px]">
        Il quaderno aspetta il primo ciclo.
      </h1>
      <p className="mt-3.5 mb-0 max-w-[40ch] text-lg leading-normal">
        Servono i saldi dei conti e le voci del catalogo: la prima volta ci vogliono dieci minuti, dopo cinque.
      </p>
      {!hasDraft && (
        <Link
          href="/programmazione"
          className="mt-6 inline-flex min-h-14 items-center rounded-field bg-inv px-6 text-[17px] font-bold text-inv-ink no-underline"
        >
          Inizia la prima programmazione
        </Link>
      )}
    </>
  );
}

function Verdict({ cycle, sp, today }: { cycle: CycleRecord; sp: StoredPlan; today: ISODate }) {
  const stamp = useStampTransfer();
  const { plan, accounts, transfers } = sp;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ended = today > cycle.endsOn;
  const cash = plan.warnings.some((w) => w.type === 'cash_shortfall');
  const todo = transfers.filter((t) => !t.doneOn);
  const next = todo[0];
  const late = todo.filter((t) => t.dueDate < today);
  const title = ended
    ? `Il ciclo di ${monthName(cycle.month).toLowerCase()} è finito.`
    : cash
      ? 'Questo mese non basta.'
      : isTight(plan, cycle.entries)
        ? 'Siamo in piedi, ma stretti.'
        : 'Siamo in piedi.';
  const dates = datesBetween(plan.start, plan.end);
  const left = Math.max(0, daysBetween(today, plan.end));

  return (
    <>
      <div className="text-[15px] text-ink-2">
        {formatDayLong(today)} · ciclo di {monthName(cycle.month).toLowerCase()}
      </div>
      <h1 id="verdetto" className="mt-2.5 mb-0 font-display text-[40px] leading-[1.02] font-bold tracking-[-0.01em] text-balance md:text-[58px]">
        {title}
      </h1>
      <p className="mt-3.5 mb-0 max-w-[40ch] text-lg leading-normal">
        Al {formatDay(plan.end)} restano <strong className="font-mono font-semibold">{money(plan.leftover.totalCents)} €</strong> in tutto.{' '}
        {transfers.length === 0 ? (
          'Nessun bonifico da fare.'
        ) : todo.length === 0 ? (
          'Tutti i bonifici sono timbrati.'
        ) : (
          <>
            {todo.length === 1 ? 'Manca ' : 'Mancano '}
            <strong>
              {todo.length} {todo.length === 1 ? 'bonifico' : 'bonifici'}
            </strong>
            : il prossimo entro{' '}
            <strong>
              {weekdayLong(next!.dueDate)} {formatDay(next!.dueDate)}
            </strong>
            .
          </>
        )}
      </p>
      {ended && (
        <Link href="/programmazione" className="mt-5 inline-flex min-h-12 items-center rounded-field bg-inv px-5 font-bold text-inv-ink no-underline">
          Programma il prossimo ciclo
        </Link>
      )}

      <div className="mt-[22px]">
        <div className="flex justify-between text-xs text-ink-2">
          <span>{ended ? formatDay(plan.start) : `${formatDay(today)} · oggi`}</span>
          <span>{ended ? formatDay(plan.end) : `${left} ${left === 1 ? 'giorno' : 'giorni'} ${toDay(plan.end)}`}</span>
        </div>
        <div aria-hidden="true" className="mt-1.5 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}>
          {dates.map((d) => (
            <div
              key={d}
              className={cx('h-3.5 rounded-[1px]', d === today ? 'bg-verm' : d < today ? 'bg-rule' : d.endsWith('-01') ? 'shadow-[inset_0_0_0_1px_var(--k-ink),inset_2px_0_0_var(--k-ink)]' : 'shadow-[inset_0_0_0_1px_var(--k-rule)]')}
            />
          ))}
        </div>
      </div>

      {late.map((t) => {
        const label = `${byId.get(t.fromAccountId)?.name} → ${byId.get(t.toAccountId)?.name}`;
        return (
          <div key={t.key} className="mt-5">
            <Notice>
              <strong>
                {label}, {money(t.amountCents)} €, era entro {relativeDay(t.dueDate, today) === 'ieri' ? 'ieri' : `${theDay(t.dueDate)}`}.
              </strong>{' '}
              Se l’hai già fatto, timbralo; se no, fallo adesso.
              <div className="mt-2.5">
                <Button variant="primary" disabled={stamp.isPending} onClick={() => stamp.mutate({ id: t.key, doneOn: today })}>
                  L’ho fatto, timbra
                </Button>
              </div>
            </Notice>
          </div>
        );
      })}

      <div className="mt-[34px] flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-[22px] font-bold">Bonifici del ciclo</h2>
        <Link href={`/storico/${cycle.month}`} className="text-sm text-ink-2">
          la programmazione
        </Link>
      </div>
      <div className="mt-2 border-t border-ink">
        {transfers.length === 0 && <p className="m-0 border-b border-rule py-3 text-[15px] text-ink-2">Questo ciclo non ne ha bisogno.</p>}
        {transfers.map((t) => {
          const done = !!t.doneOn;
          const from = byId.get(t.fromAccountId);
          const to = byId.get(t.toAccountId);
          return (
            <div key={t.key} className="grid grid-cols-[60px_minmax(0,1fr)_auto_50px] items-center gap-x-3 border-b border-rule py-[11px]">
              <div className={cx('font-mono text-sm leading-tight font-semibold', done && 'opacity-55')}>
                {formatDay(t.dueDate)}
                <span className="block font-sans text-xs font-normal text-ink-2">{done ? 'fatto' : relativeDay(t.dueDate, today)}</span>
              </div>
              <Route from={from} to={to} className={cx('text-[15px]', done && 'opacity-55')} />
              <div className={cx('text-right font-mono text-[17px] font-semibold', done && 'opacity-55')}>{money(t.amountCents)}</div>
              <Stamp
                size="md"
                done={done}
                label={`${from?.name} verso ${to?.name}, ${money(t.amountCents)} euro`}
                onToggle={() => stamp.mutate({ id: t.key, doneOn: done ? null : today })}
              />
            </div>
          );
        })}
      </div>
      <ErrorNote error={stamp.error} />
    </>
  );
}

function Debts({ debts, compact }: { debts: Debt[]; compact?: boolean }) {
  const total = debts.reduce((s, d) => s + d.amountCents, 0);
  return (
    <div className={compact ? 'mt-[30px]' : 'mt-[34px]'}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-[22px] font-bold">Conti in sospeso</h2>
        <Link href="/debiti" className="text-sm text-ink-2">
          i debiti
        </Link>
      </div>
      <div className={cx('relative mt-2.5 rounded-[2px] border border-rule px-[18px] pt-4 pb-3.5', compact ? 'bg-paper' : 'bg-page')}>
        <span
          aria-hidden="true"
          className="absolute top-3 right-3.5 grid size-[38px] rotate-8 place-items-center rounded-full border-2 border-verm font-display text-lg font-extrabold text-verm opacity-85"
        >
          未
        </span>
        <div className="flex items-baseline gap-2.5 pr-12">
          <span className="font-mono text-[26px] font-semibold">{money(total)} €</span>
          <span className="text-sm text-ink-2">
            {debts.length} {debts.length === 1 ? 'debito scaduto' : 'debiti scaduti'}
            {compact && ` · il più vecchio ${fromDay(debts[0]!.date)}`}
          </span>
        </div>
        {!compact && (
          <div className="mt-2">
            {debts.map((d) => (
              <div key={d.id} className="grid grid-cols-[56px_minmax(0,1fr)_auto] gap-x-2.5 border-t border-dotted border-rule py-[5px] text-sm">
                <span className="font-mono text-[12.5px] text-ink-2">{formatDay(d.date)}</span>
                <span>{d.description}</span>
                <span className="font-mono">{money(d.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
        <Hand className="mt-2 block text-[19px]">non scappano: si chiudono uno alla volta, quando c’è margine.</Hand>
      </div>
    </div>
  );
}

function Agenda({ plan, accounts, cycle, today }: { plan: PlanResult; accounts: AccountRecord[]; cycle: CycleRecord; today: ISODate }) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const until = addDays(today, 13);
  const rows = plan.projection.filter((r) => r.date >= today && r.date <= until);
  const days = [...new Set(rows.map((r) => r.date))];
  const out = rows.reduce((s, r) => s + (r.type === 'expense' ? r.amountCents : 0), 0);
  const stampedKey = (from: string, to: string, amount: number) =>
    cycle.transfers.find((t) => t.fromAccountId === from && t.toAccountId === to && t.amountCents === amount);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="prossimi" className="m-0 font-display text-2xl font-bold">
          Prossimi 14 giorni
        </h2>
        {rows.length > 0 && (
          <span className="text-sm text-ink-2">
            escono <span className="font-mono text-verm">{money(out)}</span> fino {toDay(days.at(-1)!)}
          </span>
        )}
      </div>
      <div className="mt-3 border-t-2 border-ink">
        {days.length === 0 && <p className="m-0 border-b border-rule py-4 text-[15px] text-ink-2">Niente in uscita nei prossimi due settimane.</p>}
        {days.map((d) => {
          const [, , dd] = d.split('-');
          return (
            <div key={d} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3.5 border-b border-rule py-2.5 md:grid-cols-[92px_minmax(0,1fr)]">
              <div className="leading-[1.1]">
                <span className="block text-xs text-ink-2">{d === today ? 'oggi' : weekdayLong(d)}</span>
                <span className="font-display text-2xl font-bold">{Number(dd)}</span>
                <span className="text-xs text-ink-2"> {formatDay(d).split(' ')[1]}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                {rows
                  .filter((r) => r.date === d)
                  .map((r, i) => {
                    if (r.type === 'transfer') {
                      const t = stampedKey(r.fromAccountId, r.toAccountId, r.amountCents);
                      const done = !!t?.doneOn;
                      return (
                        <div
                          key={i}
                          className={cx('-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-1', !done && 'bg-verm-bg')}
                        >
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-bold italic">
                            Bonifico {byId.get(r.fromAccountId)?.name} → {byId.get(r.toAccountId)?.name}
                            {done ? (
                              <span
                                aria-label="fatto"
                                className="inline-grid size-[18px] -rotate-12 place-items-center rounded-full border-[1.5px] border-verm font-display text-[10px] font-extrabold text-verm not-italic"
                              >
                                済
                              </span>
                            ) : (
                              <span className="text-xs font-normal text-ink-2 not-italic">da fare</span>
                            )}
                          </span>
                          <span className="text-right font-mono text-[15px]">{money(r.amountCents)}</span>
                        </div>
                      );
                    }
                    const a = byId.get(r.accountId);
                    const isOut = r.type === 'expense';
                    return (
                      <div key={i} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3', !isOut && 'text-sm')}>
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
                          <Glyph account={a} />
                          <span className={isOut ? 'font-medium' : 'text-ink-2'}>{r.name}</span>
                          <span className="text-xs text-ink-2">{a?.name}</span>
                        </span>
                        <span className={cx('text-right font-mono text-[15px]', isOut ? 'text-verm' : 'text-ink-2')}>{money(r.amountCents, true)}</span>
                      </div>
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

function Accounts({ plan, accounts, today }: { plan: PlanResult; accounts: AccountRecord[]; today: ISODate }) {
  const dates = plan.daily.map((d) => d.date);
  const at = Math.min(Math.max(0, daysBetween(plan.start, today)), dates.length - 1);
  const series = (id: string) => plan.daily.map((d) => d.balances[id] ?? 0);
  const scale = inkScale(accounts.map((a) => series(a.id)));
  const note = (id: string) => {
    const s = series(id);
    const endV = s.at(-1)!;
    const minV = Math.min(...s.slice(at));
    if (minV < 0) return `sotto zero ${theDay(dates[s.findIndex((v, i) => i >= at && v < 0)]!)}`;
    if (endV === 0) {
      let i = s.length - 1;
      while (i > 0 && s[i - 1] === 0) i--;
      return i <= at ? 'vuoto' : `vuoto ${fromDay(dates[i]!)}`;
    }
    if (minV === 0) return `a zero ${theDay(dates[s.findIndex((v, i) => i >= at && v === 0)]!)}`;
    return 'avanza';
  };
  return (
    <>
      <div className="mt-[34px] flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-[22px] font-bold">{accounts.length === 4 ? 'I quattro conti' : 'I conti'}</h2>
        <span className="text-[13px] text-ink-2">oggi → {formatDay(plan.end)}, con i bonifici</span>
      </div>
      <div className="mt-2.5 border-t border-ink">
        {accounts.map((a) => {
          const s = series(a.id);
          return (
            <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-b border-rule py-3 md:grid-cols-[150px_minmax(0,1fr)_120px]">
              <div>
                <span className="flex items-center gap-2 text-base font-bold">
                  <Glyph account={a} />
                  {a.name}
                </span>
                <span className="mt-0.5 block font-mono text-[13px] text-ink-2">oggi {money(s[at]!)}</span>
              </div>
              <div aria-hidden="true" className="col-span-full row-start-2 md:col-span-1 md:row-start-auto">
                <DayCells values={s} dates={dates} color={accountInk(a)} scale={scale} today={today} label={a.name} height={16} gap={2} />
              </div>
              <div className={cx('text-right font-mono text-[15px] font-semibold', s.at(-1)! < 0 && 'text-verm')}>
                {money(s.at(-1)!)}
                <span className="block font-sans text-xs font-normal text-ink-2">{note(a.id)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
