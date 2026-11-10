import { cycleTotals, todayInRome, type CycleRecord } from '@kakebo/core';
import { useCatalog, useCycles } from '../api.ts';
import { Link } from '../router.tsx';
import { Button, ErrorNote, Loading, PageTitle, cx } from '../ui/kit.tsx';
import { Glyph } from '../ui/cycle.tsx';
import { formatDay, formatDayWeek, money, monthTitle, toDay } from '../format.ts';
import { currentCycle, storedPlan } from '../cycles.ts';
import { CycleResult } from './plan/Result.tsx';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function HistoryPage() {
  const catalog = useCatalog();
  const cycles = useCycles();
  const today = todayInRome();
  if (catalog.isPending || cycles.isPending) return <Loading />;
  if (catalog.isError || cycles.isError)
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <ErrorNote error={catalog.error ?? cycles.error} />
        <Button onClick={() => (catalog.refetch(), cycles.refetch())}>Riprova</Button>
      </div>
    );

  const list = cycles.data.filter((c) => c.status === 'confirmed' || c.imported);
  const current = currentCycle(cycles.data, today);
  const byId = new Map(catalog.data.accounts.map((a) => [a.id, a]));

  return (
    <div className="max-w-[1100px]">
      <PageTitle sub="Ogni programmazione confermata resta qui così com’era, in sola lettura. Serve a ricordare, non a correggere.">
        Storico dei cicli
      </PageTitle>
      {list.map((c) => {
        const sp = storedPlan(c, catalog.data.accounts, catalog.data.settings);
        const totals = cycleTotals(c.entries);
        const state =
          c.status === 'draft'
            ? 'bozza, non confermata'
            : c.id === current?.id && today <= c.endsOn
              ? 'ciclo in corso'
              : c.imported
                ? 'dal vecchio Excel'
                : null;
        return (
          <article key={c.id} className="mt-7 border-t-2 border-ink">
            <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5 border-b border-rule pt-4 pb-3">
              <div>
                <h2 className="m-0 font-display text-[28px] font-bold">{cap(monthTitle(c.month))}</h2>
                <div className="mt-1 text-sm text-ink-2">
                  {formatDay(sp?.plan.start ?? c.plannedOn)} → {formatDay(c.endsOn)}
                  {c.confirmedAt && !c.imported && ` · confermato ${formatDayWeek(c.confirmedAt.slice(0, 10))}`}
                  {state && ` · ${state}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="border border-rule px-2 py-1 text-xs tracking-[0.08em] text-ink-2 uppercase">sola lettura</span>
                {sp && <span className="font-mono text-[22px] font-semibold">{money(sp.plan.leftover.totalCents)} €</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6 pt-[18px]">
              <section aria-label="Saldi di partenza" className="flex-[1_1_260px]">
                <h3 className="mt-0 mb-2 text-[13px] font-medium tracking-[0.08em] text-ink-2 uppercase">
                  saldi di partenza · {formatDay(c.plannedOn)}
                </h3>
                {[...c.balances].sort((x, y) => (byId.get(x.accountId)?.sort ?? 0) - (byId.get(y.accountId)?.sort ?? 0)).map((b) => (
                  <div key={b.accountId} className="flex items-center justify-between border-b border-dotted border-rule py-[7px] text-[15px]">
                    <span className="flex items-center gap-2">
                      <Glyph account={byId.get(b.accountId)} />
                      {byId.get(b.accountId)?.name ?? 'conto chiuso'}
                    </span>
                    <span className="font-mono">{money(b.amountCents)}</span>
                  </div>
                ))}
              </section>
              <section aria-label="Bonifici" className="flex-[1_1_300px]">
                <h3 className="mt-0 mb-2 text-[13px] font-medium tracking-[0.08em] text-ink-2 uppercase">bonifici</h3>
                {c.transfers.length === 0 && <p className="m-0 py-[7px] text-sm text-ink-2">nessuno</p>}
                {c.transfers.map((t) => (
                  <div key={t.id} className="grid grid-cols-[56px_minmax(0,1fr)_auto_26px] items-center gap-x-2.5 border-b border-dotted border-rule py-[7px] text-[14.5px]">
                    <span className="font-mono text-[13px] text-ink-2">{formatDay(t.dueDate)}</span>
                    <span>
                      {byId.get(t.fromAccountId)?.name} → {byId.get(t.toAccountId)?.name}
                    </span>
                    <span className="font-mono">{money(t.amountCents)}</span>
                    <span
                      aria-label={t.doneOn ? 'fatto' : 'non ancora fatto'}
                      className={cx(
                        'grid size-[22px] place-items-center rounded-full font-display text-[11px] font-extrabold',
                        t.doneOn ? '-rotate-12 border-[1.5px] border-verm text-verm' : 'border-[1.5px] border-dashed border-ink-2',
                      )}
                    >
                      {t.doneOn ? '済' : ''}
                    </span>
                  </div>
                ))}
              </section>
              <section aria-label="Il ciclo in tre righe" className="flex-[1_1_240px]">
                <h3 className="mt-0 mb-2 text-[13px] font-medium tracking-[0.08em] text-ink-2 uppercase">il ciclo in tre righe</h3>
                <div className="flex justify-between border-b border-dotted border-rule py-[7px] text-[15px]">
                  <span>entrate · {totals.incomes} voci</span>
                  <span className="font-mono">{money(totals.incomeCents, true)}</span>
                </div>
                <div className="flex justify-between border-b border-dotted border-rule py-[7px] text-[15px]">
                  <span>uscite · {totals.expenses} voci</span>
                  <span className="font-mono text-verm">{money(-totals.expenseCents)}</span>
                </div>
                {sp && (
                  <div className="flex justify-between border-b-4 border-double border-ink pt-[7px] pb-[5px] text-[15px] font-bold">
                    <span>restano {toDay(c.endsOn)}</span>
                    <span className="font-mono">{money(sp.plan.leftover.totalCents)}</span>
                  </div>
                )}
                <Link href={`/storico/${c.month}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-ink">
                  Apri il registro completo
                </Link>
              </section>
            </div>
          </article>
        );
      })}
      <div className="mt-9 flex items-center gap-4 border-y border-rule py-[22px]">
        <span aria-hidden="true" className="size-11 flex-none rounded-full border-[1.5px] border-dashed border-ink-2" />
        <p className="m-0 text-[15px] leading-normal text-ink-2">
          {list.length === 0
            ? 'Ancora nessun ciclo confermato. Il primo arriverà qui appena confermi una programmazione.'
            : list.length === 1
              ? 'È il primo ciclo del quaderno. I prossimi arriveranno qui uno per mese, il più recente in alto.'
              : 'Il più recente in alto. I cicli del vecchio Excel si caricano da Impostazioni.'}
        </p>
      </div>
    </div>
  );
}

export function CycleDetailPage({ month }: { month: string }) {
  const catalog = useCatalog();
  const cycles = useCycles();
  const today = todayInRome();
  if (catalog.isPending || cycles.isPending) return <Loading />;
  if (catalog.isError || cycles.isError) return <ErrorNote error={catalog.error ?? cycles.error} />;
  const cycle: CycleRecord | undefined = cycles.data.find((c) => c.month === month);
  if (!cycle)
    return (
      <div className="py-8">
        <p>Nessuna programmazione per {monthTitle(month)}.</p>
        <Link href="/storico">Torna allo storico</Link>
      </div>
    );
  const sp = storedPlan(cycle, catalog.data.accounts, catalog.data.settings);
  if (!sp) return <ErrorNote error="questo ciclo ha dati che non tornano (un saldo dopo la fine del ciclo?)" />;
  return (
    <div className="-mt-5 md:-mt-[30px]">
      <CycleResult
        month={cycle.month}
        plan={sp.plan}
        bare={sp.bare}
        accounts={sp.accounts}
        entries={cycle.entries}
        transfers={sp.transfers}
        today={today}
        status={
          <>
            {cycle.status === 'confirmed' ? 'confermato' : 'bozza'}
            <br />
            <span className="font-bold text-ink">sola lettura</span>
          </>
        }
        actions={
          <>
            <Link href="/storico" className="inline-flex min-h-14 items-center rounded-field border-[1.5px] border-ink px-[18px] text-base text-ink no-underline">
              Torna allo storico
            </Link>
            {cycle.status === 'draft' && (
              <Link href={`/programmazione?mese=${cycle.month}`} className="inline-flex min-h-14 items-center rounded-field bg-inv px-6 font-bold text-inv-ink no-underline">
                Riprendi la programmazione
              </Link>
            )}
          </>
        }
      />
    </div>
  );
}
