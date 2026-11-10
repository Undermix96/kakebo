import { useState, type ReactNode } from 'react';
import {
  addDays,
  cycleTotals,
  type AccountRecord,
  type CycleEntry,
  type ISODate,
  type PlanResult,
  type YearMonth,
} from '@kakebo/core';
import { Hand, Segmented, cx } from '../../ui/kit.tsx';
import {
  DayCells,
  DayLabels,
  Glyph,
  Notice,
  Route,
  Stamp,
  accountInk,
  inkScale,
  transferWhy,
} from '../../ui/cycle.tsx';
import { formatDay, money, monthName, relativeDay, fromDay, ofDay, toDay, theDay } from '../../format.ts';

/** A transfer as shown: stored (with an id) or just suggested by the engine. */
export interface ViewTransfer {
  key: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: ISODate;
  dueDate: ISODate;
  doneOn: ISODate | null;
  coversEntryIds: string[];
  /** Stamped in an earlier confirmation: it cannot be changed here. */
  locked?: boolean;
}

export interface LeftoverChoice {
  key: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: ISODate;
  chosen: boolean;
}

/** Is the cycle tight? Less than a tenth of its expenses left at the end. */
export function isTight(plan: PlanResult, entries: CycleEntry[]): boolean {
  const { expenseCents } = cycleTotals(entries);
  return plan.leftover.totalCents < expenseCents / 10;
}

export function CycleResult({
  month,
  plan,
  bare,
  accounts,
  entries,
  transfers,
  today,
  onStamp,
  stampBusy,
  leftover,
  onLeftover,
  status,
  actions,
}: {
  month: YearMonth;
  /** With all the transfers. */
  plan: PlanResult;
  /** Without any transfer. */
  bare: PlanResult;
  accounts: AccountRecord[];
  entries: CycleEntry[];
  transfers: ViewTransfer[];
  today: ISODate;
  onStamp?: (t: ViewTransfer) => void;
  stampBusy?: boolean;
  leftover?: LeftoverChoice[];
  onLeftover?: (key: string) => void;
  status: ReactNode;
  actions?: ReactNode;
}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const end = plan.end;
  const nextIdx = transfers.findIndex((t) => !t.doneOn);
  const left = transfers.filter((t) => !t.doneOn).length;
  const cash = plan.warnings.filter((w) => w.type === 'cash_shortfall');
  const short = plan.warnings.filter((w) => w.type === 'account_shortfall');
  const missing = plan.warnings.filter((w) => w.type === 'missing_amount');
  const entryName = (id: string) => entries.find((e) => e.id === id)?.name ?? id;
  const truth = plan.leftover.totalCents;

  // Accounts that end up exactly at their margin after an expense: they hold, but with no slack.
  const tight = plan.accounts.filter((s) => {
    const a = byId.get(s.accountId);
    return a && s.withoutTransfers.needCents > 0 && s.withTransfers.min.amountCents === a.marginCents;
  });

  return (
    <div className="-mx-4 flex flex-wrap md:-mx-12">
      <section aria-labelledby="dafare" className="box-border min-w-0 flex-[5_1_440px] overflow-x-clip px-4 pt-6 pb-8 md:pt-10 md:pr-12 md:pb-14 md:pl-14">
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 border-b-2 border-ink pb-3">
          <h1 id="dafare" tabIndex={-1} className="m-0 font-display text-[46px] leading-none font-bold outline-none md:text-[60px]">
            {monthName(month)}
          </h1>
          <div className="text-right text-sm leading-normal text-ink-2">{status}</div>
        </div>

        <div className="mt-[26px] flex items-baseline justify-between gap-4">
          <h2 className="m-0 font-display text-2xl font-bold">I bonifici da fare</h2>
          {transfers.length > 0 && (
            <Hand className="-rotate-3 text-[21px]">{left === 0 ? 'tutti timbrati!' : onStamp ? 'timbra quando l’hai fatto ↓' : ''}</Hand>
          )}
        </div>
        <div className="mt-2 border-t border-ink">
          {transfers.length === 0 && (
            <p className="m-0 border-b border-rule py-4 text-[15px] text-ink-2">Nessun bonifico: ogni conto ce la fa da solo.</p>
          )}
          {transfers.map((t, i) => {
            const from = byId.get(t.fromAccountId);
            const to = byId.get(t.toAccountId);
            const label = `${from?.name} verso ${to?.name}, ${money(t.amountCents)} euro`;
            const why = transferWhy(t.coversEntryIds, entries);
            const done = !!t.doneOn;
            return (
              <div
                key={t.key}
                className="grid grid-cols-[58px_minmax(0,1fr)_58px] items-center gap-x-3.5 gap-y-1 border-b border-rule py-3.5 md:grid-cols-[62px_minmax(0,1fr)_auto_58px]"
              >
                <div className="font-mono leading-tight">
                  <div className="text-xs text-ink-2">entro</div>
                  <div className="text-base font-semibold">{formatDay(t.dueDate)}</div>
                </div>
                <div className={cx('min-w-0', done && 'opacity-55')}>
                  <Route from={from} to={to} className="text-[17px]" />
                  <div className="mt-[3px] text-sm leading-snug text-ink-2">
                    {why}
                    {t.date < t.dueDate && !done && <> · si può fare {fromDay(t.date)}</>}
                    {done && <> · fatto {theDay(t.doneOn!)}</>}
                    {i === nextIdx && onStamp && (
                      <Hand className="ml-2 text-[19px]">{t.dueDate <= addDays(today, 1) ? relativeDay(t.dueDate, today) + '!' : 'il prossimo'}</Hand>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-[21px] font-semibold md:hidden">{money(t.amountCents)} €</div>
                </div>
                <div className={cx('hidden text-right font-mono text-[21px] font-semibold whitespace-nowrap md:block', done && 'opacity-55')}>
                  {money(t.amountCents)}
                </div>
                <Stamp
                  done={done}
                  label={label}
                  {...(onStamp && !t.locked ? { onToggle: () => onStamp(t) } : {})}
                  disabled={stampBusy}
                />
              </div>
            );
          })}
        </div>

        {leftover && leftover.length > 0 && (
          <div className="mt-5">
            <h3 className="m-0 font-display text-lg font-bold">Il resto, se vuoi</h3>
            <p className="mt-1 mb-0 text-sm text-ink-2">Spostarlo non cambia il totale: lo mette dove lo usi tutti i giorni.</p>
            {leftover.map((l) => (
              <label key={l.key} className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 border-b border-rule py-1.5">
                <input
                  type="checkbox"
                  checked={l.chosen}
                  onChange={() => onLeftover?.(l.key)}
                  className="size-5 flex-none accent-(--k-ink)"
                />
                <span className="min-w-0 flex-1">
                  <Route from={byId.get(l.fromAccountId)} to={byId.get(l.toAccountId)} className="text-[15px]" />
                  <span className="block text-[13px] text-ink-2">{fromDay(l.date)}, entro {theDay(end)}</span>
                </span>
                <span className="font-mono text-[17px] font-semibold">{money(l.amountCents)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-[18px] flex flex-col gap-2.5">
          {cash.map((w) => (
            <Notice key={w.from} tone="filled" role="alert">
              <strong className="block font-display text-lg">Questo mese non basta.</strong>
              Dal {formatDay(w.from)}, sommando tutti i conti, si va sotto zero fino a −{money(w.maxDeficitCents)} € (fino al{' '}
              {formatDay(w.to)}). Spostare soldi tra i conti non serve: mancano soldi, non bonifici. Per chiudere il ciclo servono{' '}
              {money(w.maxDeficitCents)} € in più, oppure una spesa da spostare dopo {theDay(end)}.
            </Notice>
          ))}
          {short.map((w) =>
            w.type === 'account_shortfall' ? (
              <Notice key={w.accountId + w.from}>
                <strong>
                  {byId.get(w.accountId)?.name} resta sotto di {money(w.maxDeficitCents)} €
                </strong>{' '}
                {fromDay(w.from)} {toDay(w.to)}, anche con i bonifici.
              </Notice>
            ) : null,
          )}
          {tight.map((s) => (
            <Notice key={s.accountId}>
              <strong>
                {byId.get(s.accountId)?.name} arriva a {money(s.withTransfers.min.amountCents)} € {theDay(s.withTransfers.min.date)}
              </strong>
              . Non va sotto, ma non ha margine: se una spesa arriva più alta, aggiungi qualcosa al bonifico.
            </Notice>
          ))}
          {missing.length > 0 && (
            <Notice>
              <strong>
                {missing.length === 1 ? 'Una voce è senza importo' : `${missing.length} voci sono senza importo`}
              </strong>{' '}
              e non le ho contate: {missing.map((w) => (w.type === 'missing_amount' ? entryName(w.entryId) : '')).join(', ')}.
            </Notice>
          )}
        </div>

        <div className="relative mt-[34px]">
          <div className="text-base text-ink-2">Il {formatDay(end)}, in tutto, restano</div>
          <div className="relative mt-1 inline-block pt-1.5 pr-[18px] pl-1.5">
            <svg
              viewBox="0 0 400 160"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="absolute -top-2 -left-3.5 h-[calc(100%+18px)] w-[calc(100%+28px)] overflow-visible"
            >
              <path
                d="M34 96 C 20 44, 132 10, 236 14 C 336 18, 396 52, 384 100 C 370 146, 226 160, 120 148 C 52 140, 10 114, 46 66"
                fill="none"
                stroke="var(--k-verm)"
                strokeWidth="3.2"
                strokeLinecap="round"
                opacity="0.85"
              />
            </svg>
            <span
              aria-live="polite"
              className={cx(
                'relative font-display text-[84px] leading-none font-extrabold tracking-[-0.02em] md:text-[118px]',
                truth < 0 && 'text-verm',
              )}
            >
              {money(truth)}
            </span>
            <span className="relative ml-2.5 font-display text-[32px] font-bold md:text-[44px]">€</span>
          </div>
          {truth >= 0 && (
            <p className="mt-3.5 mb-0 max-w-[24ch] origin-left -rotate-[1.5deg] font-hand text-[28px] leading-[1.08] text-verm">
              {isTight(plan, entries)
                ? 'È poco. È tutto quello che c’è per vivere fino al prossimo stipendio.'
                : 'È quello che c’è per vivere fino al prossimo stipendio.'}
            </p>
          )}
        </div>

        <h2 className="mt-[34px] mb-0 font-display text-xl font-bold">Senza e con i bonifici</h2>
        <div role="table" aria-label="Saldi senza e con i bonifici" className="mt-2 text-[15px]">
          <div
            role="row"
            className="grid grid-cols-[minmax(0,1fr)_120px_92px] gap-x-3 border-b border-ink py-1.5 text-xs tracking-[0.06em] text-ink-2 uppercase md:grid-cols-[minmax(0,1fr)_170px_110px]"
          >
            <span role="columnheader">conto</span>
            <span role="columnheader" className="text-right">
              senza
            </span>
            <span role="columnheader" className="text-right">
              con · {toDay(end)}
            </span>
          </div>
          {plan.accounts.map((s) => {
            const a = byId.get(s.accountId);
            const w = s.withoutTransfers;
            const neg = w.min.amountCents < 0;
            return (
              <div
                key={s.accountId}
                role="row"
                className="grid grid-cols-[minmax(0,1fr)_120px_92px] items-baseline gap-x-3 border-b border-rule py-2 md:grid-cols-[minmax(0,1fr)_170px_110px]"
              >
                <span role="cell" className="flex items-center gap-2 font-bold">
                  <Glyph account={a} />
                  {a?.name}
                </span>
                <span role="cell" className={cx('text-right font-mono', neg && 'text-verm')}>
                  <span className="block">{neg ? `△ ${money(w.min.amountCents)}` : money(w.endCents, true)}</span>
                  <span className="block font-sans text-xs text-ink-2">
                    {neg ? (w.firstBelowMargin === w.min.date ? `${theDay(w.min.date)}` : `${fromDay(w.firstBelowMargin ?? w.min.date)}, fino ${toDay(w.min.date)}`) : w.endCents > 0 ? 'avanza' : 'resta a zero'}
                  </span>
                </span>
                <span role="cell" className={cx('text-right font-mono', s.withTransfers.endCents < 0 && 'text-verm')}>
                  {money(s.withTransfers.endCents)}
                </span>
              </div>
            );
          })}
          <div className="mt-1.5 font-hand text-lg text-verm">△ = sotto zero, come nei libri dei conti giapponesi</div>
        </div>

        {actions && <div className="mt-[30px] flex flex-wrap gap-3">{actions}</div>}
      </section>

      <section
        aria-labelledby="proiezione"
        className="box-border min-w-0 flex-[7_1_640px] border-l border-rule bg-page px-4 pt-6 pb-10 shadow-fold md:pt-10 md:pr-12 md:pb-14 md:pl-11"
      >
        <Projection plan={plan} bare={bare} accounts={accounts} transfers={transfers} today={today} />
      </section>
    </div>
  );
}

function Projection({
  plan,
  bare,
  accounts,
  transfers,
  today,
}: {
  plan: PlanResult;
  bare: PlanResult;
  accounts: AccountRecord[];
  transfers: ViewTransfer[];
  today: ISODate;
}) {
  const [mode, setMode] = useState<'con' | 'senza'>('con');
  const [picked, setPicked] = useState<string>(accounts[0]?.id ?? 'total');
  const view = mode === 'con' ? plan : bare;
  const dates = view.daily.map((d) => d.date);
  const series = (id: string) => view.daily.map((d) => (id === 'total' ? d.totalCents : d.balances[id] ?? 0));
  const scale = inkScale(accounts.map((a) => series(a.id)));
  const rows = [...accounts.map((a) => ({ id: a.id, name: a.name, account: a as AccountRecord | undefined })), { id: 'total', name: 'In tutto', account: undefined }];
  const months = dates.map((d, i) => ({ d, i })).filter(({ d, i }) => i === 0 || d.endsWith('-01'));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h2 id="proiezione" className="m-0 font-display text-2xl font-bold">
          Proiezione, un quadretto al giorno
        </h2>
        <Segmented
          label="Mostra la proiezione"
          size="sm"
          options={[
            ['con', 'con i bonifici'],
            ['senza', 'senza'],
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {/* desktop: one row per account */}
      <div className="mt-5 hidden md:block">
        <div className="grid grid-cols-[108px_minmax(0,1fr)_86px] items-end gap-x-2.5">
          <div className="text-[11px] tracking-[0.06em] text-ink-2 uppercase">conto</div>
          <DayLabels dates={dates} today={today} />
          <div className="text-right text-[11px] tracking-[0.06em] text-ink-2 uppercase">{toDay(plan.end)}</div>
        </div>
        <div className="relative mt-[3px] mr-24 mb-1 ml-[118px] h-4 text-[11px] text-ink-2">
          {months.map(({ d, i }) => (
            <span key={d} className="absolute" style={{ left: `${(i / dates.length) * 100}%` }}>
              {monthName(d.slice(0, 7)).toLowerCase()}
            </span>
          ))}
        </div>
        {rows.map((r) => {
          const s = series(r.id);
          const endV = s.at(-1) ?? 0;
          return (
            <div
              key={r.id}
              className={cx('mt-1.5 grid grid-cols-[108px_minmax(0,1fr)_86px] items-center gap-x-2.5', r.id === 'total' && 'border-t border-dashed border-rule pt-2')}
            >
              <div className="flex items-center gap-[7px] text-sm font-bold">
                <Glyph account={r.account} />
                {r.name}
              </div>
              <DayCells key={mode} values={s} dates={dates} color={accountInk(r.account)} scale={r.id === 'total' ? inkScale([s]) : scale} label={r.name} animate />
              <div className={cx('text-right font-mono text-[15px] font-semibold', endV < 0 && 'text-verm')}>{money(endV)}</div>
            </div>
          );
        })}
      </div>

      {/* phone: one account at a time */}
      <div className="md:hidden">
        <div role="tablist" aria-label="Conto" className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={r.id === picked}
              onClick={() => setPicked(r.id)}
              className={cx(
                'flex min-h-11 flex-none cursor-pointer items-center gap-[7px] rounded-[22px] border-[1.5px] px-3 font-sans text-sm font-bold',
                r.id === picked ? 'border-inv bg-inv text-inv-ink' : 'border-rule bg-transparent text-ink',
              )}
            >
              <Glyph account={r.account} />
              {r.name}
            </button>
          ))}
        </div>
        <PhoneAccount
          view={view}
          accounts={accounts}
          id={picked}
          account={accounts.find((a) => a.id === picked)}
          dates={dates}
          series={series(picked)}
          today={today}
          withTransfers={mode === 'con'}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-xs text-ink-2 md:ml-[118px]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 bg-ink opacity-85" />
          più inchiostro = più saldo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3" style={{ background: 'radial-gradient(circle, var(--k-zero) 1.5px, transparent 2px)', boxShadow: 'inset 0 0 0 1px var(--k-rule)' }} />
          zero
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3"
            style={{ background: 'repeating-linear-gradient(135deg, var(--k-verm) 0 2px, transparent 2px 5px)', boxShadow: 'inset 0 0 0 1.5px var(--k-verm)' }}
          />
          sotto zero
        </span>
      </div>
      <p className="mt-2.5 mb-0 hidden font-hand text-[21px] leading-[1.1] text-verm md:ml-[118px] md:block">{heatNote(view, accounts, mode)}</p>

      <div className="hidden md:block">
        <Ledger plan={plan} accounts={accounts} transfers={transfers} />
      </div>
    </>
  );
}

function heatNote(view: PlanResult, accounts: AccountRecord[], mode: 'con' | 'senza'): string {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  if (mode === 'senza') {
    const below = view.accounts.filter((s) => s.withoutTransfers.firstBelowMargin);
    if (below.length === 0) return 'Anche senza bonifici nessun conto va sotto zero.';
    return (
      'Senza bonifici: ' +
      below
        .map((s) => `${name(s.accountId)} sotto ${fromDay(s.withoutTransfers.firstBelowMargin!)}, fino a ${money(s.withoutTransfers.min.amountCents)} ${theDay(s.withoutTransfers.min.date)}`)
        .join('; ') +
      '.'
    );
  }
  const neg = view.accounts.filter((s) => s.withTransfers.min.amountCents < 0);
  if (neg.length) return `Anche con i bonifici ${neg.map((s) => name(s.accountId)).join(' e ')} va sotto zero.`;
  const zero = view.accounts.filter((s) => s.withTransfers.min.amountCents === 0 && s.withoutTransfers.needCents > 0);
  if (zero.length) return `Con i bonifici nessun conto va sotto: ${zero.map((s) => `${name(s.accountId)} arriva a zero ${theDay(s.withTransfers.min.date)}`).join(', ')}.`;
  return 'Con i bonifici nessun conto va sotto zero.';
}

function PhoneAccount({
  view,
  accounts,
  id,
  account,
  dates,
  series,
  today,
  withTransfers,
}: {
  view: PlanResult;
  accounts: AccountRecord[];
  id: string;
  account: AccountRecord | undefined;
  dates: ISODate[];
  series: number[];
  today: ISODate;
  withTransfers: boolean;
}) {
  const name = account?.name ?? 'In tutto';
  const endV = series.at(-1) ?? 0;
  let minI = 0;
  series.forEach((v, i) => {
    if (v < series[minI]!) minI = i;
  });
  const note =
    series[minI]! < 0
      ? `Va sotto zero: fino a ${money(series[minI]!)} ${theDay(dates[minI]!)}.`
      : series[minI] === 0
        ? `Tocca 0,00 ${theDay(dates[minI]!)}: nessun margine.`
        : `Il punto più basso è ${money(series[minI]!)} ${theDay(dates[minI]!)}.`;
  const rows = view.projection.filter((r) =>
    id === 'total' ? r.type !== 'transfer' : r.type === 'transfer' ? withTransfers && (r.fromAccountId === id || r.toAccountId === id) : r.accountId === id,
  );
  const half = Math.ceil(dates.length / 2);
  return (
    <>
      <div className="mt-3.5 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-2">
          {name} · {toDay(view.end)}
        </span>
        <span className={cx('font-mono text-[22px] font-semibold', endV < 0 && 'text-verm')}>{money(endV)} €</span>
      </div>
      {[0, half].map((from) => (
        <div key={from} className="mt-2.5 flex flex-col gap-0.5">
          <DayLabels dates={dates.slice(from, from + half)} today={today} small />
          <DayCells
            values={series.slice(from, from + half)}
            dates={dates.slice(from, from + half)}
            color={accountInk(account)}
            scale={inkScale([series])}
            label={name}
            height={22}
          />
        </div>
      ))}
      <div className="mt-2.5 font-hand text-[19px] leading-[1.1] text-verm">{note}</div>
      <div className="mt-4 border-t-2 border-ink">
        {rows.map((r, i) => {
          const isT = r.type === 'transfer';
          const amount = isT ? (r.fromAccountId === id ? -r.amountCents : r.amountCents) : r.amountCents;
          const bal = id === 'total' ? r.totalCents : r.balances[id] ?? 0;
          const other = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? '';
          const label = isT
            ? r.fromAccountId === id
              ? `Bonifico verso ${other(r.toAccountId)}`
              : `Bonifico da ${other(r.fromAccountId)}`
            : id === 'total'
              ? `${r.name} · ${other(r.accountId)}`
              : r.name;
          return (
            <div key={i} className="grid grid-cols-[50px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 border-b border-rule py-[9px]">
              <span className="font-mono text-xs text-ink-2">{formatDay(r.date)}</span>
              <span className={cx('min-w-0 text-[14.5px]', isT && 'italic')}>{label}</span>
              <span className="text-right font-mono">
                <span className={cx('block text-[14.5px]', amount < 0 && !isT && 'text-verm')}>{money(amount, true)}</span>
                <span className="block text-xs text-ink-2">saldo {money(bal)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Ledger({ plan, accounts, transfers }: { plan: PlanResult; accounts: AccountRecord[]; transfers: ViewTransfer[] }) {
  const cols = `52px minmax(0,1fr) repeat(${accounts.length}, 84px) 90px`;
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const stamped = (r: { fromAccountId: string; toAccountId: string; amountCents: number }) =>
    transfers.some((t) => t.doneOn && t.fromAccountId === r.fromAccountId && t.toAccountId === r.toAccountId && t.amountCents === r.amountCents);
  const rows = plan.projection;
  const start = plan.accounts.map((s) => s.startCents);

  return (
    <>
      <div className="mt-[34px] flex items-baseline justify-between gap-4">
        <h2 className="m-0 font-display text-2xl font-bold">Registro del ciclo</h2>
        <span className="text-[13px] text-ink-2">importi in euro</span>
      </div>
      <div role="table" aria-label="Registro del ciclo" className="mt-2.5 text-sm">
        <div role="row" className="grid items-end border-b-2 border-ink pb-1.5 text-xs font-bold" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader" className="font-normal text-ink-2">
            data
          </span>
          <span role="columnheader" className="pl-2 font-normal text-ink-2">
            voce
          </span>
          {accounts.map((a) => (
            <span key={a.id} role="columnheader" className="flex items-center justify-end gap-[5px] pr-2">
              <Glyph account={a} />
              {a.name}
            </span>
          ))}
          <span role="columnheader" className="pr-0.5 text-right">
            totale
          </span>
        </div>
        <div role="row" className="grid min-h-[29px] items-baseline border-b border-rule" style={{ gridTemplateColumns: cols }}>
          <span role="cell" className="pt-1.5 font-mono text-xs text-ink-2">
            {formatDay(plan.start)}
          </span>
          <span role="cell" className="px-2 pt-1.5 pb-1 font-bold">
            Saldo di partenza
          </span>
          {start.map((v, i) => (
            <span key={i} role="cell" className="self-stretch border-l border-rule pt-1.5 pr-2 pb-1 text-right font-mono">
              {money(v)}
            </span>
          ))}
          <span role="cell" className="self-stretch border-l-[3px] border-double border-rule pt-1.5 pr-0.5 pb-1 text-right font-mono font-semibold">
            {money(plan.total.startCents)}
          </span>
        </div>
        {rows.map((r, i) => {
          const first = i === 0 || rows[i - 1]!.date !== r.date;
          const last = i === rows.length - 1 || rows[i + 1]!.date !== r.date;
          const isT = r.type === 'transfer';
          return (
            <div
              key={i}
              role="row"
              className={cx('grid min-h-[29px] items-baseline border-b border-rule', isT && 'bg-verm-bg')}
              style={{ gridTemplateColumns: cols }}
            >
              <span role="cell" className="pt-1.5 font-mono text-xs text-ink-2">
                {first ? formatDay(r.date) : ''}
              </span>
              <span role="cell" className={cx('min-w-0 px-2 pt-1.5 pb-1', isT && 'italic')}>
                {isT ? `Bonifico ${name(r.fromAccountId)} → ${name(r.toAccountId)}` : r.name}
                {isT && stamped(r) && (
                  <span
                    aria-label="fatto"
                    className="ml-1.5 inline-grid size-[18px] -rotate-12 place-items-center rounded-full border-[1.5px] border-verm font-display text-[10px] font-extrabold text-verm not-italic"
                  >
                    済
                  </span>
                )}
                {!isT && r.originalDate && <span className="text-xs text-ink-2"> · era {ofDay(r.originalDate)}</span>}
              </span>
              {accounts.map((a) => {
                let v: number | null = null;
                if (isT) v = r.fromAccountId === a.id ? -r.amountCents : r.toAccountId === a.id ? r.amountCents : null;
                else if (r.accountId === a.id) v = r.amountCents;
                return (
                  <span
                    key={a.id}
                    role="cell"
                    className={cx('self-stretch border-l border-rule pt-1.5 pr-2 pb-1 text-right font-mono', v != null && v < 0 && !isT && 'text-verm')}
                  >
                    {v == null ? '' : money(v, true)}
                  </span>
                );
              })}
              <span role="cell" className="self-stretch border-l-[3px] border-double border-rule pt-1.5 pr-0.5 pb-1 text-right font-mono font-semibold">
                {last ? money(r.totalCents) : ''}
              </span>
            </div>
          );
        })}
        <div
          role="row"
          className="grid items-baseline border-t border-b-4 border-double border-t-ink border-b-ink pt-2 pb-1.5 font-mono text-[15px] font-semibold"
          style={{ gridTemplateColumns: cols }}
        >
          <span role="cell" className="text-xs font-normal text-ink-2">
            {formatDay(plan.end)}
          </span>
          <span role="cell" className="pl-2 font-sans">
            Restano
          </span>
          {plan.accounts.map((s) => (
            <span key={s.accountId} role="cell" className={cx('pr-2 text-right', s.withTransfers.endCents < 0 && 'text-verm')}>
              {money(s.withTransfers.endCents)}
            </span>
          ))}
          <span role="cell" className="pr-0.5 text-right text-verm">
            {money(plan.leftover.totalCents)}
          </span>
        </div>
      </div>
    </>
  );
}
