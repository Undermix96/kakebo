import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  PlanInputError,
  cycleBounds,
  cycleMonthFor,
  defaultEntryState,
  envelopeSpent,
  envelopeStatus,
  fixedTransfersOf,
  generateCycleEntries,
  isYearMonth,
  planCycle,
  todayInRome,
  type AccountRecord,
  type CycleEntry,
  type CycleRecord,
  type ISODate,
  type PlanResult,
  type Transfer,
  type YearMonth,
} from '@kakebo/core';
import { useCatalog, useConfirmCycle, useCycles, useReopenCycle, useSaveDraft, type Catalog } from '../api.ts';
import { navigate, Link } from '../router.tsx';
import { AmountField, Button, ErrorNote, Hand, Loading, Seal, Segmented, cx, inputClass, readAmount } from '../ui/kit.tsx';
import { Glyph } from '../ui/cycle.tsx';
import { formatDay, formatDayWeek, money, monthName, weekdayShort, fromDay, toDay, theDay } from '../format.ts';
import { CycleResult, type LeftoverChoice, type ViewTransfer } from './plan/Result.tsx';
import { EmptyNotebook } from './EmptyNotebook.tsx';

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS = ['Saldi', 'Già successo?', 'Voci del ciclo', 'Risultato'] as const;

/** The monthly ritual: balances → already happened? → the cycle's entries → result. */
export function PlanPage() {
  const catalog = useCatalog();
  const cycles = useCycles();
  const today = todayInRome();

  if (catalog.isPending || cycles.isPending)
    return (
      <Shell>
        <div className="px-4 md:px-12">
          <Loading />
        </div>
      </Shell>
    );
  if (catalog.isError || cycles.isError)
    return (
      <Shell>
        <div className="flex flex-col items-start gap-4 px-4 py-8 md:px-12">
          <ErrorNote error={catalog.error ?? cycles.error} />
          <Button onClick={() => (catalog.refetch(), cycles.refetch())}>Riprova</Button>
        </div>
      </Shell>
    );
  if (catalog.data.accounts.length === 0)
    return (
      <Shell>
        <div className="px-4 md:px-12">
          <EmptyNotebook />
        </div>
      </Shell>
    );

  // ?mese=AAAA-MM resumes a draft of another month; otherwise the cycle of today.
  const asked = new URLSearchParams(window.location.search).get('mese');
  const month = asked && isYearMonth(asked) ? asked : cycleMonthFor(today, catalog.data.settings.cycleEndDay);
  const existing = cycles.data.find((c) => c.month === month);
  if (existing?.status === 'confirmed') return <AlreadyConfirmed cycle={existing} />;
  if (existing && existing.endsOn < today)
    return (
      <Shell>
        <p className="px-4 md:px-12">Questa bozza riguarda un ciclo già finito: scartala dalla pagina Oggi.</p>
      </Shell>
    );
  const previous = cycles.data.find((c) => c.month < month && c.status === 'confirmed');
  return <Wizard key={existing?.id ?? 'new'} month={month} today={today} catalog={catalog.data} existing={existing} previous={previous} />;
}

function Shell({ children, sub, onExit, exitLabel = 'Esci' }: { children: ReactNode; sub?: string; onExit?: () => void; exitLabel?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-2 border-ink px-4 py-3.5 md:px-12 md:py-5">
        <div className="flex items-center gap-3">
          <Seal size={40} />
          <div>
            <div className="font-display text-[19px] leading-[1.05] font-extrabold md:text-2xl">Programmazione del ciclo</div>
            {sub && <div className="mt-[3px] text-[13px] text-ink-2">{sub}</div>}
          </div>
        </div>
        {onExit ? (
          <button type="button" onClick={onExit} className="inline-flex min-h-11 cursor-pointer items-center border-none bg-transparent px-1 text-sm text-ink-2 underline">
            {exitLabel}
          </button>
        ) : (
          <Link href="/" className="inline-flex min-h-11 items-center px-1 text-sm text-ink-2">
            {exitLabel}
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}

function AlreadyConfirmed({ cycle }: { cycle: CycleRecord }) {
  const reopen = useReopenCycle();
  return (
    <Shell sub={`${formatDayWeek(cycle.plannedOn)} → ${formatDayWeek(cycle.endsOn)}`}>
      <main className="box-border w-full max-w-[760px] px-4 py-8 md:px-12 md:py-12">
        <h1 className="m-0 font-display text-[34px] leading-none font-bold md:text-5xl">{monthName(cycle.month)} è già programmato.</h1>
        <p className="mt-3 text-base leading-normal text-ink-2">
          Se qualcosa è cambiato (un saldo, una spesa nuova) puoi riaprirlo: i bonifici già timbrati restano, gli altri li ricalcolo.
        </p>
        <ErrorNote error={reopen.error} />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" disabled={reopen.isPending} onClick={() => reopen.mutate(cycle.month)}>
            Riapri e rifai la programmazione
          </Button>
          <Button onClick={() => navigate('/')}>Torna a oggi</Button>
        </div>
      </main>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

interface BalanceInput {
  text: string;
  asOf: ISODate;
}

/** Stable sort by day. */
const byDate = (list: CycleEntry[]) => [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function Wizard({
  month,
  today,
  catalog,
  existing,
  previous,
}: {
  month: YearMonth;
  today: ISODate;
  catalog: Catalog;
  existing: CycleRecord | undefined;
  previous: CycleRecord | undefined;
}) {
  const { settings, items } = catalog;
  const [init] = useState(() => {
    if (existing) {
      const used = new Set(existing.balances.map((b) => b.accountId));
      return {
        accounts: catalog.accounts.filter((a) => used.has(a.id)),
        endsOn: existing.endsOn,
        balances: Object.fromEntries(existing.balances.map((b) => [b.accountId, { text: money(b.amountCents), asOf: b.asOf }])),
        entries: existing.entries,
        step: 3 as Step,
      };
    }
    const bounds = cycleBounds(month, today, settings.cycleEndDay);
    const accounts = catalog.accounts.filter((a) => a.active);
    return {
      accounts,
      endsOn: bounds.end,
      balances: Object.fromEntries(accounts.map((a) => [a.id, { text: '', asOf: today }])),
      entries: generateCycleEntries(items, bounds).entries,
      step: 1 as Step,
    };
  });
  const accounts: AccountRecord[] = init.accounts;
  const endsOn = init.endsOn;
  const [step, setStep] = useState<Step>(init.step);
  const [balances, setBalances] = useState<Record<string, BalanceInput>>(init.balances);
  const [entries, setEntries] = useState<CycleEntry[]>(init.entries);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(init.entries.map((e) => [e.id, e.amountCents == null ? '' : money(e.amountCents)])),
  );
  const touched = useRef(new Set<string>(existing ? init.entries.map((e) => e.id) : []));
  const [stamps, setStamps] = useState<Record<string, ISODate>>({});
  const [leftoverOn, setLeftoverOn] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<unknown>(null);
  const [pendingStep, setPendingStep] = useState<Step | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const save = useSaveDraft();
  const confirm = useConfirmCycle();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const stored = existing?.transfers.filter((t) => t.doneOn) ?? [];

  // ---- derived ----
  const parsedBalances = accounts.map((a) => {
    const b = balances[a.id]!;
    return { accountId: a.id, amountCents: readAmount(b.text), asOf: b.asOf };
  });
  const balanceErrors = Object.fromEntries(
    parsedBalances.map((b) => [
      b.accountId,
      b.amountCents == null ? 'scrivi il saldo (anche 0)' : !b.asOf || b.asOf > today ? 'la data non può essere nel futuro' : null,
    ]),
  );
  const balancesOk = Object.values(balanceErrors).every((e) => !e);
  const asOfOf = (accountId: string) => balances[accountId]?.asOf ?? today;
  const start = parsedBalances.reduce((d, b) => (b.asOf && b.asOf < d ? b.asOf : d), today);
  /** First day an entry of this cycle can have happened on (brought forward or already spent). */
  const cycleStart = [cycleBounds(month, today, settings.cycleEndDay).start, start].reduce((a, b) => (a < b ? a : b));

  const deferred = useDeferredValue(entries);
  const options = { roundingCents: settings.roundingCents, leadDays: settings.leadDays };
  const engine = useMemo(() => {
    if (!balancesOk) return null;
    const input = {
      accounts,
      balances: parsedBalances as { accountId: string; amountCents: number; asOf: ISODate }[],
      entries: deferred,
      today,
      end: endsOn,
    };
    try {
      const fixed = fixedTransfersOf(stored, start);
      const plan = planCycle({ ...input, fixedTransfers: fixed, options });
      const bare = planCycle({ ...input, options: { ...options, suggest: false } });
      return { plan, bare, fixed, error: null };
    } catch (err) {
      if (err instanceof PlanInputError) return { plan: null, bare: null, fixed: [], error: err.message };
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balancesOk, JSON.stringify(parsedBalances), deferred, today, endsOn, settings.roundingCents, settings.leadDays]);

  // ---- persistence ----
  const draft = () => ({
    plannedOn: today,
    endsOn,
    balances: parsedBalances as { accountId: string; amountCents: number; asOf: ISODate }[],
    entries,
  });

  async function persistThen(next: Step | 'exit') {
    setSaveError(null);
    try {
      await save.mutateAsync({ month, draft: draft() });
    } catch (err) {
      setSaveError(err);
      setPendingStep(next === 'exit' ? null : next);
      return;
    }
    if (next === 'exit') navigate('/');
    else setStep(next);
  }

  function applyDefaultStates() {
    const bals = parsedBalances as { accountId: string; amountCents: number; asOf: ISODate }[];
    setEntries((list) =>
      list.map((e) =>
        touched.current.has(e.id) || e.origin !== 'catalog' || e.state === 'excluded' ? e : { ...e, state: defaultEntryState(e, bals) },
      ),
    );
  }

  const textErrors = entries.filter((e) => {
    const t = texts[e.id] ?? '';
    const v = readAmount(t);
    return t.trim() !== '' && (v == null || v < 0);
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (step === 1) {
      if (!balancesOk) {
        setShowErrors(true);
        const first = accounts.find((a) => balanceErrors[a.id]);
        if (first) document.getElementById(`saldo-${first.id}`)?.focus();
        return;
      }
      setShowErrors(false);
      applyDefaultStates();
      void persistThen(2);
    } else if (step === 2) {
      void persistThen(3);
    } else if (step === 3) {
      if (textErrors.length) {
        setShowErrors(true);
        document.getElementById(`voce-${textErrors[0]!.id}`)?.focus();
        return;
      }
      setShowErrors(false);
      void persistThen(4);
    }
  }

  const exit = () => (step === 1 && !existing ? navigate('/') : void persistThen('exit'));

  // ---- entry editing ----
  const setEntry = (id: string, patch: Partial<CycleEntry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const setAmount = (id: string, text: string) => {
    setTexts((t) => ({ ...t, [id]: text }));
    const v = readAmount(text);
    setEntry(id, { amountCents: v != null && v >= 0 ? v : null });
  };
  const addEntry = (e: Omit<CycleEntry, 'id' | 'state'>) => {
    const entry: CycleEntry = { ...e, id: newId(e.origin === 'past_movement' ? 'mov' : 'spor'), state: 'pending' };
    touched.current.add(entry.id);
    setEntries((list) => byDate([...list, entry]));
    setTexts((t) => ({ ...t, [entry.id]: entry.amountCents == null ? '' : money(entry.amountCents) }));
  };
  const removeEntry = (id: string) => setEntries((list) => list.filter((e) => e.id !== id));
  // ---- envelopes ("buste"): expenses already made out of them ----
  const isEnvelope = (e: CycleEntry) => !!e.recurringItemId && !!itemById.get(e.recurringItemId)?.envelope;
  const envelopes = entries.filter((e) => isEnvelope(e) && e.state !== 'excluded');
  const spent = envelopeSpent(entries);
  const addSpend = (s: { envelopeEntryId: string; name: string; accountId: string; date: ISODate; amountCents: number }) => {
    const entry: CycleEntry = {
      id: newId('busta'),
      name: s.name,
      kind: 'expense',
      accountId: s.accountId,
      date: s.date,
      amountCents: s.amountCents,
      state: s.date < asOfOf(s.accountId) ? 'included_in_balance' : 'pending',
      origin: 'past_movement',
      recurringItemId: null,
      envelopeEntryId: s.envelopeEntryId,
    };
    touched.current.add(entry.id);
    setEntries((list) => byDate([...list, entry]));
    setTexts((t) => ({ ...t, [entry.id]: money(s.amountCents) }));
  };

  /** An entry planned later in the cycle already happened: it moves to the real day (and amount). */
  const beforeAnticipate = useRef(new Map<string, number | null>());
  const anticipate = (id: string, date: ISODate, amountCents: number) => {
    touched.current.add(id);
    const prev = entries.find((e) => e.id === id);
    if (prev && !beforeAnticipate.current.has(id)) beforeAnticipate.current.set(id, prev.amountCents);
    setTexts((t) => ({ ...t, [id]: money(amountCents) }));
    setEntries((list) =>
      byDate(
        list.map((e) =>
          e.id !== id
            ? e
            : {
                ...e,
                date,
                amountCents,
                plannedDate: e.plannedDate ?? e.date,
                state: date < asOfOf(e.accountId) ? 'included_in_balance' : 'pending',
              },
        ),
      ),
    );
  };
  /** Puts a moved or brought-forward entry back on its planned day, still to be paid. */
  const restore = (id: string) => {
    touched.current.add(id);
    // The amount it had before being brought forward, when known (same session).
    if (beforeAnticipate.current.has(id)) {
      const cents = beforeAnticipate.current.get(id)!;
      beforeAnticipate.current.delete(id);
      setAmount(id, cents == null ? '' : money(cents));
    }
    setEntries((list) =>
      byDate(list.map((e) => (e.id === id && e.plannedDate ? { ...e, date: e.plannedDate, plannedDate: null, state: 'pending' } : e))),
    );
  };
  /** Moves an entry to another day of this cycle only; remembers the day it was planned on. */
  const moveEntry = (id: string, date: ISODate) => {
    touched.current.add(id);
    setEntries((list) =>
      byDate(
        list.map((e) => {
          if (e.id !== id || e.date === date) return e;
          const planned = e.plannedDate ?? e.date;
          return { ...e, date, plannedDate: planned === date ? null : planned };
        }),
      ),
    );
  };

  // ---- result ----
  const plan = engine?.plan ?? null;
  const viewTransfers: ViewTransfer[] = [];
  const leftover: LeftoverChoice[] = [];
  let finalPlan: PlanResult | null = null;
  if (plan && engine) {
    for (const t of stored) viewTransfers.push({ ...t, key: t.id, locked: true });
    plan.transfers.forEach((t, i) => {
      const key = `${t.fromAccountId}>${t.toAccountId}#${i}`;
      viewTransfers.push({ ...t, key, doneOn: stamps[key] ?? null });
    });
    for (const s of plan.leftover.suggestions) {
      const key = `resto>${s.fromAccountId}`;
      leftover.push({ key, fromAccountId: s.fromAccountId, toAccountId: s.toAccountId, amountCents: s.amountCents, date: s.date, chosen: leftoverOn.has(key) });
    }
    const chosen: Transfer[] = leftover.filter((l) => l.chosen).map((l) => ({ ...l, dueDate: endsOn }));
    finalPlan = planCycle({
      accounts,
      balances: parsedBalances as { accountId: string; amountCents: number; asOf: ISODate }[],
      entries: deferred,
      today,
      end: endsOn,
      fixedTransfers: [...engine.fixed, ...plan.transfers, ...chosen],
      options: { ...options, suggest: false },
    });
  }

  async function doConfirm() {
    if (!plan) return;
    setSaveError(null);
    try {
      await save.mutateAsync({ month, draft: draft() });
      const transfers = [
        ...viewTransfers.filter((t) => !t.locked),
        ...leftover.filter((l) => l.chosen).map((l) => ({ ...l, dueDate: endsOn, doneOn: stamps[l.key] ?? null, coversEntryIds: [] })),
      ].map((t) => ({
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amountCents: t.amountCents,
        date: t.date,
        dueDate: t.dueDate,
        doneOn: t.doneOn,
        coversEntryIds: t.coversEntryIds,
      }));
      await confirm.mutateAsync({ month, body: { transfers } });
      navigate('/');
    } catch (err) {
      setSaveError(err);
    }
  }

  const sub = `${formatDayWeek(start)} → ${formatDayWeek(endsOn)}${step < 4 ? ' · ci vogliono cinque minuti' : ''}`;
  const busy = save.isPending || confirm.isPending;

  return (
    <Shell sub={sub} onExit={exit} exitLabel="Esci, riprendo dopo">
      <nav aria-label="Passi" className="grid grid-cols-4 border-b border-rule">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const cur = n === step;
          const done = n < step;
          return (
            <button
              key={label}
              type="button"
              aria-current={cur ? 'step' : undefined}
              disabled={n > step || busy}
              onClick={() => setStep(n)}
              className={cx(
                'flex min-h-14 items-center gap-2.5 border-0 border-r border-solid border-rule px-2.5 text-left font-sans md:px-[22px]',
                cur ? 'bg-inv text-inv-ink' : done ? 'cursor-pointer bg-transparent text-ink' : 'bg-transparent text-ink-2',
              )}
            >
              <span
                className={cx(
                  'grid size-[26px] flex-none place-items-center rounded-full border-[1.5px] text-[13px] font-semibold',
                  done ? '-rotate-10 border-verm font-display text-verm' : cur ? 'border-inv-ink font-mono' : 'border-rule font-mono',
                )}
              >
                {done ? '済' : n}
              </span>
              <span className={cx('overflow-hidden text-[15px] font-bold text-ellipsis whitespace-nowrap', !cur && 'hidden md:inline')}>{label}</span>
            </button>
          );
        })}
      </nav>

      {saveError != null && (
        <div role="alert" className="mx-4 mt-5 max-w-[760px] border-[1.5px] border-verm px-4 py-3.5 md:mx-12">
          <strong className="font-display text-lg">Non riesco a salvare la programmazione.</strong>
          <p className="mt-1.5 mb-0 text-[15px] leading-normal">
            Non ho perso niente: saldi e importi che hai scritto sono ancora qui. Dettaglio:{' '}
            {saveError instanceof Error ? saveError.message : String(saveError)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => (step === 4 ? void doConfirm() : void persistThen(pendingStep ?? step))}
            >
              Riprova adesso
            </Button>
            {pendingStep && (
              <Button
                onClick={() => {
                  setSaveError(null);
                  setStep(pendingStep);
                }}
              >
                Continua senza salvare
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 4 ? (
        <main className="box-border w-full px-4 md:px-12">
          {engine?.error && <ErrorNote error={engine.error} />}
          {plan && finalPlan && engine?.bare && (
            <CycleResult
              month={month}
              plan={finalPlan}
              bare={engine.bare}
              accounts={accounts}
              entries={deferred}
              transfers={viewTransfers}
              today={today}
              onStamp={(t) =>
                setStamps((s) => {
                  const n = { ...s };
                  if (n[t.key]) delete n[t.key];
                  else n[t.key] = today;
                  return n;
                })
              }
              leftover={leftover}
              onLeftover={(key) =>
                setLeftoverOn((s) => {
                  const n = new Set(s);
                  if (n.has(key)) n.delete(key);
                  else n.add(key);
                  return n;
                })
              }
              status={
                <>
                  passo 4 di 4
                  <br />
                  <span className="font-bold text-ink">risultato</span>
                </>
              }
              actions={
                <>
                  <Button variant="primary" className="min-h-14 flex-[1_1_100%] px-[26px] text-[17px] md:flex-none" disabled={busy} onClick={() => void doConfirm()}>
                    {busy ? 'Salvo…' : 'Conferma programmazione'}
                  </Button>
                  <Button className="min-h-14 flex-[1_1_100%] text-base md:flex-none" disabled={busy} onClick={() => setStep(3)}>
                    Torna alle voci
                  </Button>
                </>
              }
            />
          )}
        </main>
      ) : (
        <main className="flex flex-1 flex-wrap items-start gap-x-14 gap-y-10 px-4 pt-[22px] md:px-12 md:pt-9 md:pb-16">
          <form onSubmit={submit} noValidate className="min-w-0 flex-[999_1_620px] motion-safe:animate-turn" key={step}>
            {step === 1 && (
              <StepBalances
                heading={heading}
                accounts={accounts}
                balances={balances}
                errors={showErrors ? balanceErrors : {}}
                today={today}
                previous={previous}
                onChange={(id, patch) => setBalances((b) => ({ ...b, [id]: { ...b[id]!, ...patch } }))}
              />
            )}
            {step === 2 && (
              <StepPast
                heading={heading}
                accounts={accounts}
                byId={byId}
                entries={entries}
                asOfOf={asOfOf}
                today={today}
                cycleStart={cycleStart}
                envelopes={envelopes}
                isEnvelope={isEnvelope}
                spent={spent}
                onAddSpend={addSpend}
                onAnticipate={anticipate}
                onRestore={restore}
                onToggle={(e) => {
                  touched.current.add(e.id);
                  setEntry(e.id, { state: e.state === 'included_in_balance' ? 'pending' : 'included_in_balance' });
                }}
                onAdd={addEntry}
                onRemove={removeEntry}
              />
            )}
            {step === 3 && (
              <StepEntries
                heading={heading}
                accounts={accounts}
                byId={byId}
                entries={entries}
                texts={texts}
                showErrors={showErrors}
                itemById={itemById}
                start={start}
                endsOn={endsOn}
                asOfOf={asOfOf}
                spent={spent}
                onAmount={setAmount}
                onMove={moveEntry}
                onExclude={(e) => {
                  touched.current.add(e.id);
                  if (e.origin === 'catalog') setEntry(e.id, { state: e.state === 'excluded' ? 'pending' : 'excluded' });
                  else removeEntry(e.id);
                }}
                onAdd={addEntry}
              />
            )}

            {/* phone: sticky summary and next */}
            <div className="sticky bottom-0 -mx-4 mt-6 border-t-2 border-ink bg-paper px-4 pt-3 pb-4 md:hidden">
              <PreviewTotal plan={engine?.bare ?? null} endsOn={endsOn} compact />
              <Button type="submit" variant="primary" className="mt-3 min-h-[54px] w-full text-[17px]" disabled={busy}>
                {busy ? 'Salvo…' : NEXT[step]}
              </Button>
            </div>
            <div className="mt-8 hidden flex-wrap items-center gap-x-[22px] gap-y-3.5 md:flex">
              <Button type="submit" variant="primary" className="min-h-14 px-6 text-[17px]" disabled={busy}>
                {busy ? 'Salvo…' : NEXT[step]}
                <span aria-hidden="true" className="rounded-field border border-inv-ink px-1.5 py-0.5 font-mono text-[13px] opacity-80">
                  ↵ Invio
                </span>
              </Button>
              {step > 1 && (
                <Button className="min-h-14 px-[18px] text-base" onClick={() => setStep((step - 1) as Step)} disabled={busy}>
                  Indietro
                </Button>
              )}
              <span className="text-[13px] text-ink-2">
                <span className="rounded-field border border-rule px-[5px] py-px font-mono">Tab</span> passa al campo dopo · la virgola è il
                separatore dei decimali
              </span>
            </div>
          </form>

          <aside
            aria-label="Anteprima del ciclo"
            className="sticky top-6 hidden max-w-[380px] flex-[1_1_300px] border border-rule bg-page px-6 pt-[22px] pb-5 shadow-fold md:block"
          >
            <div className="font-display text-[19px] font-bold">Se il ciclo andasse così</div>
            <div className="mt-1 text-[13px] text-ink-2">si aggiorna mentre scrivi · senza bonifici</div>
            {engine?.bare ? (
              <>
                <div className="mt-4 border-t border-ink">
                  {engine.bare.accounts.map((s) => {
                    const a = byId.get(s.accountId);
                    const w = s.withoutTransfers;
                    const neg = w.firstBelowMargin != null;
                    return (
                      <div key={s.accountId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 border-b border-rule py-2.5">
                        <span className="flex items-center gap-2 text-[15px] font-bold">
                          <Glyph account={a} />
                          {a?.name}
                        </span>
                        <span className={cx('text-right font-mono text-[15px] font-semibold', neg ? 'text-verm' : 'text-ink')}>
                          {neg ? `△ ${money(w.min.amountCents)}` : money(w.endCents)}
                        </span>
                        <span className="col-span-full mt-0.5 text-[12.5px] text-ink-2">
                          {neg
                            ? w.firstBelowMargin === w.min.date
                              ? `va sotto zero ${theDay(w.min.date)}`
                              : `va sotto zero ${fromDay(w.firstBelowMargin!)}, fino ${toDay(w.min.date)}`
                            : w.endCents > 0
                              ? `avanza ${toDay(endsOn)}`
                              : 'resta a zero'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <PreviewTotal plan={engine.bare} endsOn={endsOn} />
              </>
            ) : (
              <p className="mt-4 text-sm text-ink-2">{engine?.error ?? 'Scrivi i saldi di tutti i conti e vedrai come va il ciclo.'}</p>
            )}
            <p className="mt-3 mb-0 text-[13.5px] leading-normal text-ink-2">
              Il totale non cambia con i bonifici: spostano soldi, non ne creano. I bonifici li calcolo al passo 4.
            </p>
          </aside>
        </main>
      )}
    </Shell>
  );
}

const NEXT: Record<1 | 2 | 3, string> = {
  1: 'Avanti: già successo?',
  2: 'Avanti: le voci del ciclo',
  3: 'Calcola i bonifici',
};

function PreviewTotal({ plan, endsOn, compact }: { plan: PlanResult | null; endsOn: ISODate; compact?: boolean }) {
  if (!plan) return compact ? <div className="text-[13px] text-ink-2">scrivi i saldi per vedere il totale</div> : null;
  const tot = plan.leftover.totalCents;
  const neg = plan.accounts.filter((s) => s.withoutTransfers.firstBelowMargin != null).length;
  const warn = plan.warnings.some((w) => w.type === 'cash_shortfall')
    ? 'in tutto si va sotto zero: mancano soldi, non bonifici'
    : neg
      ? `${neg} ${neg === 1 ? 'conto andrebbe' : 'conti andrebbero'} sotto zero senza bonifici · li sistemo al passo 4`
      : 'nessun conto sotto zero';
  if (compact)
    return (
      <>
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="text-[13px] text-ink-2">{toDay(endsOn)}, in tutto</span>
          <span aria-live="polite" className={cx('font-display text-[26px] font-extrabold', tot < 0 && 'text-verm')}>
            {money(tot)} €
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">{warn}</div>
      </>
    );
  return (
    <>
      <div className="mt-[18px] text-sm text-ink-2">{toDay(endsOn)}, in tutto</div>
      <div aria-live="polite" className={cx('font-display text-[54px] leading-none font-extrabold', tot < 0 && 'text-verm')}>
        {money(tot)}
        <span className="ml-1.5 text-2xl">€</span>
      </div>
      <div className="mt-1.5 text-[13px] text-ink-2">{warn}</div>
    </>
  );
}

function StepIntro({ n, title, heading, children }: { n: number; title: string; heading: React.RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  return (
    <>
      <p className="m-0 text-[13px] tracking-[0.12em] text-ink-2 uppercase">Passo {n} di 4</p>
      <h1 ref={heading} tabIndex={-1} className="mt-1.5 mb-0 font-display text-[34px] leading-[1.05] font-bold outline-none md:text-5xl">
        {title}
      </h1>
      <p className="mt-3 mb-0 max-w-[58ch] text-base leading-[1.55] text-ink-2">{children}</p>
    </>
  );
}

// ---------- step 1 ----------

function StepBalances({
  heading,
  accounts,
  balances,
  errors,
  today,
  previous,
  onChange,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  accounts: AccountRecord[];
  balances: Record<string, BalanceInput>;
  errors: Record<string, string | null>;
  today: ISODate;
  previous: CycleRecord | undefined;
  onChange: (id: string, patch: Partial<BalanceInput>) => void;
}) {
  return (
    <>
      <StepIntro n={1} title="I saldi di oggi" heading={heading}>
        Apri le app delle banche e copia il saldo disponibile, uno per conto.
        {previous && ' Sotto ogni campo c’è il saldo del ciclo scorso, come riferimento.'}
      </StepIntro>
      <div className="mt-7 border-t-[1.5px] border-ink">
        {accounts.map((a) => {
          const b = balances[a.id]!;
          const ref = previous?.balances.find((x) => x.accountId === a.id);
          const err = errors[a.id];
          return (
            <div key={a.id} className="flex flex-wrap items-end gap-x-6 gap-y-2.5 border-b border-rule pt-[18px] pb-4">
              <div className="min-w-0 flex-[1_1_190px]">
                <label htmlFor={`saldo-${a.id}`} className="flex items-center gap-[9px] text-[19px] font-bold">
                  <Glyph account={a} />
                  {a.name}
                </label>
                {a.role && <div className="mt-[3px] text-[13px] text-ink-2">{a.role}</div>}
              </div>
              <div className="flex-[0_0_150px]">
                <label htmlFor={`data-${a.id}`} className="block text-xs text-ink-2">
                  data del saldo
                </label>
                <input
                  id={`data-${a.id}`}
                  type="date"
                  max={today}
                  value={b.asOf}
                  onChange={(e) => onChange(a.id, { asOf: e.target.value })}
                  className={cx(inputClass, 'border-b-rule font-mono text-base')}
                />
              </div>
              <div className="min-w-0 flex-[1_1_220px]">
                <div className="flex items-baseline gap-2 border-b-2 border-ink">
                  <AmountField
                    id={`saldo-${a.id}`}
                    allowNegative
                    value={b.text}
                    onChange={(text) => onChange(a.id, { text })}
                    aria-describedby={`rif-${a.id}`}
                    placeholder="0,00"
                    className="h-[58px] flex-1 text-[30px] font-semibold"
                  />
                  <span className="font-display text-xl text-ink-2">€</span>
                </div>
                <div id={`rif-${a.id}`} className="mt-1.5 flex justify-end gap-1.5 text-[13px] text-ink-2">
                  {err ? (
                    <span className="text-verm">{err}</span>
                  ) : ref ? (
                    <>
                      ciclo scorso <span className="font-mono text-ink">{money(ref.amountCents)}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- step 2 ----------

function StepPast({
  heading,
  accounts,
  byId,
  entries,
  asOfOf,
  today,
  cycleStart,
  envelopes,
  isEnvelope,
  spent,
  onAddSpend,
  onAnticipate,
  onRestore,
  onToggle,
  onAdd,
  onRemove,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  accounts: AccountRecord[];
  byId: Map<string, AccountRecord>;
  entries: CycleEntry[];
  asOfOf: (accountId: string) => ISODate;
  today: ISODate;
  cycleStart: ISODate;
  envelopes: CycleEntry[];
  isEnvelope: (e: CycleEntry) => boolean;
  spent: Map<string, number>;
  onAddSpend: (s: { envelopeEntryId: string; name: string; accountId: string; date: ISODate; amountCents: number }) => void;
  onAnticipate: (id: string, date: ISODate, amountCents: number) => void;
  onRestore: (id: string) => void;
  onToggle: (e: CycleEntry) => void;
  onAdd: (e: Omit<CycleEntry, 'id' | 'state'>) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState<false | 'movement' | 'entry'>(false);
  const [envelopeOpen, setEnvelopeOpen] = useState<string | null>(null);
  const past = entries.filter((e) => e.origin !== 'past_movement' && e.state !== 'excluded' && e.date <= asOfOf(e.accountId));
  // Entries still ahead in the cycle that may have happened already.
  const ahead = entries.filter((e) => e.origin !== 'past_movement' && e.state === 'pending' && e.date > asOfOf(e.accountId));
  const moves = entries.filter((e) => e.origin === 'past_movement' && !e.envelopeEntryId);
  const todayUnchecked = past.some((e) => e.date === asOfOf(e.accountId) && e.state !== 'included_in_balance');

  return (
    <>
      <StepIntro n={2} title="Già successo?" heading={heading}>
        Queste voci hanno una data uguale o precedente al saldo: se sono già passate dal conto, sono dentro il numero che hai scritto.
        Togli la spunta solo a quelle non ancora addebitate. Se una voce prevista più avanti è già passata, anticipala qui.
      </StepIntro>
      <div className="mt-[26px] border-t-[1.5px] border-ink">
        {past.length === 0 && (
          <p className="m-0 border-b border-rule py-4 text-[15px] text-ink-2">Nessuna voce cade prima dei saldi: qui non c’è niente da spuntare.</p>
        )}
        {past.map((e) => {
          const on = e.state === 'included_in_balance';
          const a = byId.get(e.accountId);
          const signed = e.kind === 'income' ? (e.amountCents ?? 0) : -(e.amountCents ?? 0);
          return (
            <label
              key={e.id}
              className="grid min-h-[60px] cursor-pointer grid-cols-[30px_64px_minmax(0,1fr)_auto] items-center gap-x-3.5 border-b border-rule py-2"
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(e)} className="m-0 size-6 accent-(--k-ink)" />
              <span className="font-mono text-sm text-ink-2">{formatDay(e.date)}</span>
              <span className="min-w-0">
                <span className="block text-base font-bold">{e.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
                  <Glyph account={a} />
                  {a?.name} · {on ? 'già nel saldo' : 'non ancora addebitata: la conto nel ciclo'}
                  {e.plannedDate && e.plannedDate > e.date && (
                    <>
                      {' · '}anticipata, era {theDay(e.plannedDate)}
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.preventDefault();
                          onRestore(e.id);
                        }}
                        aria-label={`Rimetti ${e.name} ${toDay(e.plannedDate)}`}
                        className="min-h-8 cursor-pointer border-none bg-transparent p-0 text-[13px] text-ink-2 underline"
                      >
                        rimetti
                      </button>
                    </>
                  )}
                </span>
              </span>
              <span className={cx('font-mono text-lg font-semibold', signed < 0 ? 'text-verm' : 'text-ink', on && 'opacity-45')}>
                {e.amountCents == null ? '—' : money(signed, true)}
              </span>
            </label>
          );
        })}
      </div>
      {todayUnchecked && (
        <p className="mt-3.5 mb-0 origin-left -rotate-1 font-hand text-[22px] leading-[1.15] text-verm">
          Le voci con la data del saldo restano senza spunta: se sono già passate dal conto, spuntale.
        </p>
      )}

      {moves.length > 0 && (
        <div className="mt-6">
          <h2 className="m-0 font-display text-lg font-bold">Aggiunti a mano</h2>
          <div className="mt-2 border-t border-ink">
            {moves.map((e) => (
              <div key={e.id} className="grid min-h-12 grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 border-b border-rule">
                <span className="font-mono text-sm text-ink-2">{formatDay(e.date)}</span>
                <span className="min-w-0">
                  <span className="block font-bold">{e.name}</span>
                  <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                    <Glyph account={byId.get(e.accountId)} />
                    {byId.get(e.accountId)?.name}
                  </span>
                </span>
                <span className={cx('font-mono font-semibold', e.kind === 'expense' && 'text-verm')}>
                  {money(e.kind === 'income' ? e.amountCents! : -e.amountCents!, true)}
                </span>
                <Button variant="danger" onClick={() => onRemove(e.id)} aria-label={`Togli ${e.name}`}>
                  togli
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding === 'entry' ? (
        <AnticipateForm
          entries={ahead}
          byId={byId}
          min={cycleStart}
          max={today}
          isEnvelope={isEnvelope}
          onEnvelope={(id) => {
            setAdding(false);
            setEnvelopeOpen(id);
          }}
          onAnticipate={(id, date, cents) => {
            onAnticipate(id, date, cents);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : adding === 'movement' ? (
        <EntryForm
          title="Uno stipendio o una spesa già avvenuti"
          accounts={accounts}
          defaultDate={today}
          minDate={(accountId) => asOfOf(accountId)}
          maxDate={() => today}
          dateHint={(accountId) => `${fromDay(asOfOf(accountId))} (data del saldo) a oggi`}
          origin="past_movement"
          onAdd={(e) => {
            onAdd(e);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="dashed" onClick={() => setAdding('entry')} disabled={ahead.length === 0}>
            + Una voce del ciclo è già passata
          </Button>
          <Button variant="dashed" onClick={() => setAdding('movement')}>
            + Aggiungi a mano uno stipendio o una spesa già avvenuti
          </Button>
        </div>
      )}

      <EnvelopeSection
        envelopes={envelopes}
        entries={entries}
        accounts={accounts}
        byId={byId}
        spent={spent}
        min={cycleStart}
        max={today}
        openFor={envelopeOpen}
        onOpen={setEnvelopeOpen}
        onAdd={onAddSpend}
        onRemove={onRemove}
      />
    </>
  );
}

/** Expenses already made out of the envelopes of the cycle (groceries and pharmacy), one by one. */
function EnvelopeSection({
  envelopes,
  entries,
  accounts,
  byId,
  spent,
  min,
  max,
  openFor,
  onOpen,
  onAdd,
  onRemove,
}: {
  envelopes: CycleEntry[];
  entries: CycleEntry[];
  accounts: AccountRecord[];
  byId: Map<string, AccountRecord>;
  spent: Map<string, number>;
  min: ISODate;
  max: ISODate;
  /** Envelope whose form is open, if any. */
  openFor: string | null;
  onOpen: (envelopeId: string | null) => void;
  onAdd: (spend: { envelopeEntryId: string; name: string; accountId: string; date: ISODate; amountCents: number }) => void;
  onRemove: (id: string) => void;
}) {
  if (envelopes.length === 0) return null;
  return (
    <div className="mt-7">
      <h2 className="m-0 font-display text-lg font-bold">Spese già fatte dalla busta</h2>
      <p className="mt-1 mb-0 text-[14px] leading-normal text-ink-2">
        Spesa e farmacia già pagate in questo ciclo, da qualsiasi conto: le tolgo dalla busta e copro solo quello che resta.
      </p>
      {envelopes.map((env) => {
        const status = envelopeStatus(env, spent);
        const list = entries.filter((e) => e.envelopeEntryId === env.id);
        const a = byId.get(env.accountId);
        return (
          <section key={env.id} aria-label={`Busta ${env.name}`} className="mt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink pb-1.5">
              <span className="flex items-center gap-2 font-bold">
                <Glyph account={a} />
                {env.name} · {a?.name}
              </span>
              <span className="font-mono text-[13px] text-ink-2">
                {env.amountCents == null
                  ? 'importo della busta da inserire al passo 3'
                  : status
                    ? status.overCents > 0
                      ? `busta ${money(env.amountCents)} · spesi ${money(status.spentCents)} · sforata di ${money(status.overCents)}`
                      : `busta ${money(env.amountCents)} · spesi ${money(status.spentCents)} · restano ${money(status.leftCents)}`
                    : `busta ${money(env.amountCents)} · niente speso finora`}
              </span>
            </div>
            {list.map((e) => (
              <div key={e.id} className="grid min-h-12 grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 border-b border-rule">
                <span className="font-mono text-sm text-ink-2">{formatDay(e.date)}</span>
                <span className="min-w-0">
                  <span className="block font-bold">{e.name}</span>
                  <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                    <Glyph account={byId.get(e.accountId)} />
                    {byId.get(e.accountId)?.name} · {e.state === 'included_in_balance' ? 'già nel saldo' : 'dopo il saldo: la conto nel ciclo'}
                  </span>
                </span>
                <span className="font-mono font-semibold text-verm">{money(-(e.amountCents ?? 0), true)}</span>
                <Button variant="danger" onClick={() => onRemove(e.id)} aria-label={`Togli ${e.name}`}>
                  togli
                </Button>
              </div>
            ))}
            {openFor === env.id ? (
              <EnvelopeSpendForm
                envelope={env}
                accounts={accounts}
                min={min}
                max={max}
                onAdd={(s) => onAdd({ ...s, envelopeEntryId: env.id })}
                onClose={() => onOpen(null)}
              />
            ) : (
              <Button variant="dashed" className="mt-3" onClick={() => onOpen(env.id)}>
                + Spesa già fatta dalla busta
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EnvelopeSpendForm({
  envelope,
  accounts,
  min,
  max,
  onAdd,
  onClose,
}: {
  envelope: CycleEntry;
  accounts: AccountRecord[];
  min: ISODate;
  max: ISODate;
  onAdd: (s: { name: string; accountId: string; date: ISODate; amountCents: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(envelope.accountId);
  const [date, setDate] = useState(max);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const add = () => {
    const cents = readAmount(amount);
    if (cents == null || cents <= 0) return setError('scrivi un importo maggiore di zero');
    if (!date || date < min || date > max) return setError(`la data va ${fromDay(min)} ${toDay(max)}`);
    onAdd({ name: name.trim() || envelope.name, accountId, date, amountCents: cents });
    // Ready for the next one.
    setName('');
    setAmount('');
    setError(null);
    first.current?.focus();
  };

  return (
    <div
      className="mt-3.5 rounded-field border-[1.5px] border-ink bg-page px-[18px] pt-[18px] pb-4 motion-safe:animate-open"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          add();
        }
      }}
    >
      <div className="font-display text-lg font-bold">Spesa già fatta dalla busta «{envelope.name}»</div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3.5">
        <label className="flex flex-[2_1_180px] flex-col gap-1 text-xs text-ink-2">
          cosa (facoltativo)
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Conad, farmacia" className={cx(inputClass, 'text-base')} />
        </label>
        <label className="flex flex-[1_1_130px] flex-col gap-1 text-xs text-ink-2">
          pagata con
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cx(inputClass, 'text-base')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-[0_1_150px] flex-col gap-1 text-xs text-ink-2">
          il giorno
          <input
            type="date"
            value={date}
            min={min}
            max={max}
            onChange={(e) => setDate(e.target.value)}
            className={cx(inputClass, 'font-mono text-base')}
          />
        </label>
        <label className="flex flex-[1_1_120px] flex-col gap-1 text-xs text-ink-2">
          importo
          <AmountField value={amount} onChange={setAmount} placeholder="0,00" className="h-11 border-b-[1.5px] border-solid border-ink text-lg" />
        </label>
        <Button variant="primary" onClick={add}>
          Aggiungi
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Fatto
        </Button>
      </div>
      {error && (
        <div className="mt-2.5">
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}


// ---------- step 3 ----------

function StepEntries({
  heading,
  accounts,
  byId,
  entries,
  texts,
  showErrors,
  itemById,
  start,
  endsOn,
  asOfOf,
  spent,
  onAmount,
  onMove,
  onExclude,
  onAdd,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  accounts: AccountRecord[];
  byId: Map<string, AccountRecord>;
  entries: CycleEntry[];
  texts: Record<string, string>;
  showErrors: boolean;
  itemById: Map<string, Catalog['items'][number]>;
  start: ISODate;
  endsOn: ISODate;
  asOfOf: (accountId: string) => ISODate;
  spent: Map<string, number>;
  onAmount: (id: string, text: string) => void;
  onMove: (id: string, date: ISODate) => void;
  onExclude: (e: CycleEntry) => void;
  onAdd: (e: Omit<CycleEntry, 'id' | 'state'>) => void;
}) {
  const [group, setGroup] = useState<'data' | 'conto'>('data');
  const [adding, setAdding] = useState(false);
  const rows = entries.filter((e) => e.state !== 'included_in_balance');

  const row = (e: CycleEntry) => {
    const a = byId.get(e.accountId);
    const item = e.recurringItemId ? itemById.get(e.recurringItemId) : undefined;
    const variable = item?.amountMode === 'last';
    const text = texts[e.id] ?? '';
    const v = readAmount(text);
    const invalid = text.trim() !== '' && (v == null || v < 0);
    const missing = e.amountCents == null && !invalid;
    const excluded = e.state === 'excluded';
    const was = item?.amountCents;
    const changed = e.origin === 'catalog' && was != null && e.amountCents != null && e.amountCents !== was;
    const envelope = envelopeStatus(e, spent);
    const tag = e.envelopeEntryId
      ? `dalla busta ${entries.find((x) => x.id === e.envelopeEntryId)?.name ?? ''}`.trim()
      : item?.envelope
        ? 'busta'
        : e.origin === 'sporadic'
        ? 'sporadica · solo questo ciclo'
        : e.origin === 'past_movement'
          ? 'già avvenuta'
          : item && item.day == null
            ? 'giorno da controllare: messa al 1°'
            : variable
              ? 'variabile'
              : '';
    return (
      <div
        key={e.id}
        className={cx(
          'grid min-h-[52px] grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-x-3.5 border-b border-rule py-1.5 md:grid-cols-[92px_minmax(0,1fr)_150px_170px]',
          excluded && 'opacity-50',
        )}
      >
        <EntryDay entry={e} min={asOfOf(e.accountId)} max={endsOn} disabled={excluded} onMove={(d) => onMove(e.id, d)} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <label htmlFor={`voce-${e.id}`} className={cx('text-base font-medium', excluded && 'line-through')}>
              {e.name}
            </label>
            {tag && <span className="text-[11px] tracking-[0.08em] text-ink-2 uppercase">{tag}</span>}
            <button
              type="button"
              onClick={() => onExclude(e)}
              className="min-h-8 cursor-pointer border-none bg-transparent p-0 text-xs text-ink-2 underline"
              aria-label={`${excluded ? 'Rimetti' : e.origin === 'catalog' ? 'Togli da questo ciclo' : 'Cancella'}: ${e.name}`}
            >
              {excluded ? 'rimetti' : e.origin === 'catalog' ? 'non questo mese' : 'togli'}
            </button>
          </span>
          {item?.note && <Hand className="mt-0.5 block text-lg">{item.note}</Hand>}
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2 md:hidden">
            <Glyph account={a} />
            {a?.name}
          </span>
        </span>
        <span className="hidden items-center gap-[7px] text-sm text-ink-2 md:flex">
          <Glyph account={a} />
          {a?.name}
        </span>
        <span className="flex flex-col items-end">
          <span
            className={cx(
              'flex items-baseline gap-1 border-b-[1.5px] px-1.5',
              invalid && showErrors ? 'border-verm' : missing && !excluded ? 'border-verm border-dashed' : 'border-rule',
              variable && !excluded && 'bg-hl',
            )}
          >
            <span className={cx('font-mono text-[15px]', e.kind === 'expense' ? 'text-verm' : 'text-ink')}>{e.kind === 'expense' ? '−' : '+'}</span>
            <AmountField
              id={`voce-${e.id}`}
              value={text}
              disabled={excluded}
              onChange={(t) => onAmount(e.id, t)}
              placeholder={missing ? 'importo?' : '0,00'}
              className="h-10 w-[92px] text-[17px] font-semibold md:w-[120px]"
            />
          </span>
          {invalid ? (
            <span className="mt-0.5 text-xs text-verm">importo non valido</span>
          ) : missing && !excluded ? (
            <span className="mt-0.5 text-xs text-verm">importo da inserire</span>
          ) : envelope && !excluded ? (
            <span className={cx('mt-0.5 text-right text-xs', envelope.overCents > 0 ? 'text-verm' : 'text-ink-2')}>
              già spesi {money(envelope.spentCents)} ·{' '}
              {envelope.overCents > 0 ? `sforata di ${money(envelope.overCents)}` : `restano ${money(envelope.leftCents)}`}
            </span>
          ) : changed ? (
            <span className="mt-0.5 text-xs text-ink-2">era {money(was!)}</span>
          ) : null}
        </span>
      </div>
    );
  };

  let body: ReactNode;
  if (group === 'conto') {
    body = accounts.map((a) => {
      const list = rows.filter((e) => e.accountId === a.id);
      const sum = list
        .filter((e) => e.state === 'pending')
        .reduce((s, e) => s + (e.kind === 'income' ? 1 : -1) * (e.amountCents ?? 0), 0);
      return (
        <section key={a.id} aria-label={a.name}>
          <div className="flex items-baseline justify-between border-b border-ink pt-3.5 pb-1.5">
            <span className="flex items-center gap-2 font-display text-[17px] font-bold">
              <Glyph account={a} />
              {a.name}
            </span>
            <span className="font-mono text-[13px] text-ink-2">
              {list.length} voci · {money(sum, true)}
            </span>
          </div>
          {list.map(row)}
        </section>
      );
    });
  } else body = rows.map(row);

  return (
    <>
      <StepIntro n={3} title="Le voci del ciclo" heading={heading}>
        Ti propongo l’importo dell’ultima volta. Quelli <span className="bg-hl px-[3px] text-ink">evidenziati</span> cambiano ogni mese: se
        sai già il numero giusto, scrivilo.
      </StepIntro>
      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Raggruppa le voci"
          size="sm"
          options={[
            ['data', 'per data'],
            ['conto', 'per conto'],
          ]}
          value={group}
          onChange={setGroup}
        />
        {!adding && (
          <Button variant="dashed" onClick={() => setAdding(true)} aria-expanded={adding}>
            + Aggiungi spesa sporadica
          </Button>
        )}
      </div>
      {adding && (
        <EntryForm
          title="Spesa sporadica"
          accounts={accounts}
          defaultDate={start}
          minDate={() => start}
          maxDate={() => endsOn}
          origin="sporadic"
          onAdd={(e) => {
            onAdd(e);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      <div className="mt-[18px] border-t-[1.5px] border-ink">{body}</div>
    </>
  );
}

/** Picks an entry planned later in the cycle that already happened, with its real day and amount. */
function AnticipateForm({
  entries,
  byId,
  min,
  max,
  isEnvelope,
  onEnvelope,
  onAnticipate,
  onClose,
}: {
  entries: CycleEntry[];
  byId: Map<string, AccountRecord>;
  min: ISODate;
  max: ISODate;
  isEnvelope: (e: CycleEntry) => boolean;
  onEnvelope: (id: string) => void;
  onAnticipate: (id: string, date: ISODate, amountCents: number) => void;
  onClose: () => void;
}) {
  const [entryId, setEntryId] = useState(entries[0]?.id ?? '');
  const entry = entries.find((e) => e.id === entryId);
  const [date, setDate] = useState(max);
  const [amount, setAmount] = useState(entry?.amountCents == null ? '' : money(entry.amountCents));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);

  const pick = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (e && isEnvelope(e)) return onEnvelope(id);
    setEntryId(id);
    setAmount(e?.amountCents == null ? '' : money(e.amountCents));
    setError(null);
  };
  const confirm = () => {
    if (!entry) return setError('scegli una voce');
    if (isEnvelope(entry)) return onEnvelope(entry.id);
    const cents = readAmount(amount);
    if (cents == null || cents <= 0) return setError('scrivi l’importo vero, maggiore di zero');
    if (!date || date < min || date > max) return setError(`la data va ${fromDay(min)} ${toDay(max)}`);
    onAnticipate(entry.id, date, cents);
  };

  return (
    <div
      className="mt-5 rounded-field border-[1.5px] border-ink bg-page px-[18px] pt-[18px] pb-4 motion-safe:animate-open"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          confirm();
        }
      }}
    >
      <div className="font-display text-lg font-bold">Una voce del ciclo è già passata</div>
      <p className="mt-1 mb-0 text-[13px] text-ink-2">
        La sposto al giorno in cui è successa: se è prima del saldo è già dentro il numero che hai scritto. Puoi rimetterla quando vuoi.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3.5">
        <label className="flex flex-[2_1_220px] flex-col gap-1 text-xs text-ink-2">
          voce
          <select ref={first} value={entryId} onChange={(e) => pick(e.target.value)} className={cx(inputClass, 'text-base')}>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {formatDay(e.date)} · {e.name} · {byId.get(e.accountId)?.name}
                {isEnvelope(e) ? ' · busta: segna le spese già fatte' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-[0_1_150px] flex-col gap-1 text-xs text-ink-2">
          è passata il
          <input
            type="date"
            value={date}
            min={min}
            max={max}
            onChange={(e) => setDate(e.target.value)}
            className={cx(inputClass, 'font-mono text-base')}
          />
        </label>
        <label className="flex flex-[1_1_120px] flex-col gap-1 text-xs text-ink-2">
          importo vero
          <AmountField value={amount} onChange={setAmount} placeholder="0,00" className="h-11 border-b-[1.5px] border-solid border-ink text-lg" />
        </label>
        <Button variant="primary" onClick={confirm}>
          Anticipa
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Annulla
        </Button>
      </div>
      {error && (
        <div className="mt-2.5">
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}

/** The day of an entry, as a button that opens the date picker; "era il 15" when moved. */
function EntryDay({
  entry: e,
  min,
  max,
  disabled,
  onMove,
}: {
  entry: CycleEntry;
  min: ISODate;
  max: ISODate;
  disabled?: boolean;
  onMove: (date: ISODate) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const low = e.date < min ? e.date : min;
  const open = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <span className="relative flex flex-col items-start">
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        aria-label={`Giorno di ${e.name}: ${formatDayWeek(e.date)}. Cambia il giorno`}
        className="min-h-9 cursor-pointer border-0 border-b border-dashed border-rule bg-transparent p-0 text-left font-mono text-[13px] text-ink-2 enabled:hover:text-ink disabled:cursor-default disabled:border-transparent"
      >
        <span className="hidden md:inline">{weekdayShort(e.date)} </span>
        {formatDay(e.date)}
      </button>
      {e.plannedDate && e.plannedDate !== e.date && (
        <button
          type="button"
          onClick={() => onMove(e.plannedDate!)}
          disabled={disabled || e.plannedDate < low || e.plannedDate > max}
          aria-label={`Rimetti ${e.name} ${toDay(e.plannedDate)}`}
          title="rimetti al giorno previsto"
          className="cursor-pointer border-none bg-transparent p-0 text-left text-[11px] text-ink-2 underline disabled:cursor-default disabled:no-underline"
        >
          era {theDay(e.plannedDate)}
        </button>
      )}
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={e.date}
        min={low}
        max={max}
        onChange={(ev) => {
          const d = ev.target.value;
          if (d && d >= low && d <= max) onMove(d);
        }}
      />
    </span>
  );
}

// ---------- shared: add an entry by hand ----------

function EntryForm({
  title,
  accounts,
  defaultDate,
  minDate,
  maxDate,
  dateHint,
  origin,
  onAdd,
  onClose,
}: {
  title: string;
  accounts: AccountRecord[];
  defaultDate: ISODate;
  minDate: (accountId: string) => ISODate;
  maxDate: (accountId: string) => ISODate;
  dateHint?: (accountId: string) => string;
  origin: 'sporadic' | 'past_movement';
  onAdd: (e: Omit<CycleEntry, 'id' | 'state'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const add = () => {
    const cents = readAmount(amount);
    if (!name.trim()) return setError('scrivi un nome');
    if (cents == null || cents <= 0) return setError('scrivi un importo maggiore di zero');
    if (!date || date < minDate(accountId) || date > maxDate(accountId))
      return setError(
        origin === 'past_movement' && date < minDate(accountId)
          ? 'è prima della data del saldo: è già dentro il numero che hai scritto'
          : `la data va ${fromDay(minDate(accountId))} ${toDay(maxDate(accountId))}`,
      );
    onAdd({ name: name.trim(), accountId, kind, date, amountCents: cents, origin, recurringItemId: null });
  };

  return (
    <div
      className="mt-3.5 rounded-field border-[1.5px] border-ink bg-page px-[18px] pt-[18px] pb-4 motion-safe:animate-open"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          add();
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-lg font-bold">{title}</div>
        <Segmented
          label="Tipo"
          size="sm"
          options={[
            ['expense', 'uscita'],
            ['income', 'entrata'],
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3.5">
        <label className="flex flex-[2_1_180px] flex-col gap-1 text-xs text-ink-2">
          nome
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Visita pediatra" className={cx(inputClass, 'text-base')} />
        </label>
        <label className="flex flex-[1_1_130px] flex-col gap-1 text-xs text-ink-2">
          conto
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cx(inputClass, 'text-base')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-[0_1_150px] flex-col gap-1 text-xs text-ink-2">
          data
          <input
            type="date"
            value={date}
            min={minDate(accountId)}
            max={maxDate(accountId)}
            onChange={(e) => setDate(e.target.value)}
            className={cx(inputClass, 'font-mono text-base')}
          />
        </label>
        <label className="flex flex-[1_1_120px] flex-col gap-1 text-xs text-ink-2">
          importo
          <AmountField value={amount} onChange={setAmount} placeholder="0,00" className="h-11 border-b-[1.5px] border-solid border-ink text-lg" />
        </label>
        <Button variant="primary" onClick={add}>
          Aggiungi
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Annulla
        </Button>
      </div>
      {dateHint && <p className="mt-2 mb-0 text-xs text-ink-2">{dateHint(accountId)}</p>}
      {error && (
        <div className="mt-2.5">
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}

