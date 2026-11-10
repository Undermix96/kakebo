import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatEuro, openDebts, todayInRome, type Debt, type ISODate } from '@kakebo/core';
import { useCatalog, useCreateDebt, useCycles, useDebts, useDeleteDebt, useUpdateDebt } from '../api.ts';
import { AmountField, Button, ErrorNote, Field, Hand, Loading, cx, inputClass, readAmount } from '../ui/kit.tsx';
import { debtAge, formatDay, fromDay, money } from '../format.ts';
import { currentCycle, storedPlan } from '../cycles.ts';

/** Debts: reminders to pay when a cycle has some room. Never planned automatically. */
export function DebtsPage() {
  const debts = useDebts();
  const today = todayInRome();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (debts.isPending) return <Loading />;
  if (debts.isError)
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <ErrorNote error={debts.error} />
        <Button onClick={() => debts.refetch()}>Riprova</Button>
      </div>
    );

  const open = openDebts(debts.data);
  const paid = debts.data.filter((d) => d.paidOn).sort((a, b) => (a.paidOn! < b.paidOn! ? 1 : -1));
  const total = open.reduce((s, d) => s + d.amountCents, 0);

  return (
    <div className="flex flex-wrap gap-x-16 gap-y-8 md:pt-4 md:pl-6">
      <Summary open={open} total={total} today={today} />

      <section aria-label="Elenco dei debiti" className="min-w-0 flex-[999_1_560px]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink pb-2">
          <h2 className="m-0 font-display text-xl font-bold">Da saldare</h2>
          {!adding && (
            <Button variant="dashed" onClick={() => (setAdding(true), setEditing(null))}>
              + Aggiungi debito
            </Button>
          )}
        </div>
        {adding && (
          <div className="mt-3">
            <DebtEditor today={today} onClose={() => setAdding(false)} />
          </div>
        )}
        {open.map((d) =>
          editing === d.id ? (
            <div key={d.id} className="mt-3">
              <DebtEditor debt={d} today={today} onClose={() => setEditing(null)} />
            </div>
          ) : (
            <OpenRow key={d.id} debt={d} today={today} onEdit={() => (setEditing(d.id), setAdding(false))} />
          ),
        )}
        {open.length === 0 && (
          <p className="m-0 border-b border-rule py-[22px] font-display text-[22px]">
            {debts.data.length === 0 ? 'Nessun debito segnato.' : 'Niente in sospeso. Bel lavoro.'}
          </p>
        )}

        {paid.length > 0 && (
          <>
            <h2 className="mt-[30px] mb-0 border-b border-ink pb-2 font-display text-lg font-bold text-ink-2">Saldati</h2>
            {paid.map((d) =>
              editing === d.id ? (
                <div key={d.id} className="mt-3">
                  <DebtEditor debt={d} today={today} onClose={() => setEditing(null)} />
                </div>
              ) : (
                <PaidRow key={d.id} debt={d} onEdit={() => (setEditing(d.id), setAdding(false))} />
              ),
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Summary({ open, total, today }: { open: Debt[]; total: number; today: ISODate }) {
  const catalog = useCatalog();
  const cycles = useCycles();
  const overdue = open.filter((d) => d.date < today);
  const oldest = open[0];

  // What the current cycle leaves at the end: is there room for the oldest debt?
  let room: string | null = null;
  const current = cycles.data && currentCycle(cycles.data, today);
  if (oldest && current && catalog.data && today <= current.endsOn) {
    const sp = storedPlan(current, catalog.data.accounts, catalog.data.settings);
    if (sp) {
      const left = sp.plan.leftover.totalCents;
      room =
        left >= oldest.amountCents
          ? `Questo ciclo chiude con ${money(left)} €: c’è margine per saldare ${oldest.description} (${money(oldest.amountCents)} €).`
          : `Questo ciclo chiude con ${money(left)} €: meglio aspettare il prossimo stipendio prima di saldarne uno.`;
    }
  }

  return (
    <div className="max-w-[380px] flex-[1_1_300px]">
      <h1 className="m-0 font-display text-[36px] leading-[1.02] font-bold md:text-[52px]">Conti in sospeso</h1>
      <p className="mt-3.5 mb-0 text-[17px] leading-[1.55]">
        {open.length === 0
          ? 'Qui si segnano le cose da pagare che non entrano nella programmazione: si ricordano, e si timbrano quando sono saldate.'
          : overdue.length === open.length
            ? `${open.length === 1 ? 'È scaduto' : 'Sono tutti scaduti'}, ma non scappano. Quando un ciclo chiude con un po’ di margine, ne togli uno e lo timbri.`
            : 'Non scappano: quando un ciclo chiude con un po’ di margine, ne togli uno e lo timbri.'}
      </p>
      {room && <p className="mt-3.5 mb-0 text-[15px] leading-normal text-ink-2">{room}</p>}
      <div className="mt-[26px] border-t border-ink pt-3">
        <div className="text-sm text-ink-2">in sospeso</div>
        <div className="mt-1 inline-block border-b-4 border-double border-ink pb-1 font-mono text-[36px] font-semibold md:text-[44px]">
          {money(total)} €
        </div>
        <div className="mt-2 text-sm text-ink-2">
          {open.length === 0
            ? 'nessun debito aperto'
            : `${open.length === 1 ? '1 debito' : `${open.length} debiti`}, il più vecchio ${fromDay(oldest!.date)}`}
          {overdue.length > 0 && overdue.length < open.length && ` · ${overdue.length} ${overdue.length === 1 ? 'scaduto' : 'scaduti'}`}
        </div>
      </div>
      {open.length > 1 && <Hand className="mt-[22px] block origin-left -rotate-[1.5deg] text-[22px]">uno alla volta, partendo dal più vecchio.</Hand>}
    </div>
  );
}

const ROW = 'grid grid-cols-[86px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-rule md:grid-cols-[120px_minmax(0,1fr)_110px_190px]';

function OpenRow({ debt: d, today, onEdit }: { debt: Debt; today: ISODate; onEdit: () => void }) {
  const update = useUpdateDebt();
  const late = d.date < today;
  return (
    <div className={cx(ROW, 'gap-y-2 py-3.5')}>
      <span className="font-mono leading-tight">
        <span className="block text-[15px] font-semibold">{formatDay(d.date)}</span>
        <span className={cx('block font-sans text-xs', late ? 'text-ink-2' : 'text-verm')}>{debtAge(d.date, today)}</span>
      </span>
      <span className="min-w-0">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Modifica ${d.description}`}
          className="cursor-pointer border-none bg-transparent p-0 text-left font-sans text-[17px] font-medium text-ink hover:underline"
        >
          {d.description}
        </button>
        {d.note && <span className="block text-[13px] text-ink-2">{d.note}</span>}
      </span>
      <span className="text-right font-mono text-lg font-semibold">{money(d.amountCents)}</span>
      <Button
        className="col-span-full justify-self-stretch md:col-span-1 md:justify-self-end"
        disabled={update.isPending}
        aria-label={`Segna come saldato: ${d.description} del ${formatDay(d.date)}, ${money(d.amountCents)} euro`}
        onClick={() => update.mutate({ id: d.id, patch: { paidOn: today } })}
      >
        Segna come saldato
      </Button>
      {update.error && (
        <div className="col-span-full">
          <ErrorNote error={update.error} />
        </div>
      )}
    </div>
  );
}

function PaidRow({ debt: d, onEdit }: { debt: Debt; onEdit: () => void }) {
  const update = useUpdateDebt();
  return (
    <div className={cx(ROW, 'gap-y-1.5 py-3')}>
      <span className="font-mono text-sm leading-tight text-ink-2">
        {formatDay(d.date)}
        <span className="block font-sans text-xs">saldato {formatDay(d.paidOn!)}</span>
      </span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Modifica ${d.description}, saldato`}
        className="min-w-0 cursor-pointer border-none bg-transparent p-0 text-left font-sans text-base text-ink-2 line-through"
      >
        {d.description}
      </button>
      <span className="text-right font-mono text-base text-ink-2 line-through">{money(d.amountCents)}</span>
      <span className="col-span-full flex items-center justify-end gap-3 md:col-span-1">
        <span
          aria-hidden="true"
          className="flex size-[50px] flex-col items-center justify-center rounded-full border-[3px] border-verm bg-verm-bg font-display leading-none font-extrabold text-verm motion-safe:animate-hanko motion-reduce:-rotate-12"
        >
          <span className="text-xl">済</span>
          <span className="mt-0.5 text-[8px] tracking-[0.06em]">SALDATO</span>
        </span>
        <Button
          variant="danger"
          className="px-1.5 text-[13.5px] text-ink-2"
          disabled={update.isPending}
          aria-label={`Annulla il saldo di ${d.description}`}
          onClick={() => update.mutate({ id: d.id, patch: { paidOn: null } })}
        >
          annulla
        </Button>
      </span>
    </div>
  );
}

function DebtEditor({ debt, today, onClose }: { debt?: Debt; today: ISODate; onClose: () => void }) {
  const [date, setDate] = useState(debt?.date ?? today);
  const [description, setDescription] = useState(debt?.description ?? '');
  const [amount, setAmount] = useState(debt ? formatEuro(debt.amountCents, { symbol: false }) : '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateDebt();
  const update = useUpdateDebt();
  const del = useDeleteDebt();
  const ref = useRef<HTMLInputElement>(null);
  const pending = create.isPending || update.isPending || del.isPending;

  useEffect(() => ref.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = readAmount(amount);
    if (!description.trim()) return setProblem('scrivi di cosa si tratta');
    if (!date) return setProblem('manca la data');
    if (cents == null || cents <= 0) return setProblem('scrivi l’importo: un debito senza importo non si segna');
    setProblem(null);
    const value = { date, description: description.trim(), amountCents: cents, note: note.trim() || null };
    if (debt) update.mutate({ id: debt.id, patch: value }, { onSuccess: onClose });
    else create.mutate(value, { onSuccess: onClose });
  };

  return (
    <form
      aria-label={debt ? `Modifica ${debt.description}` : 'Nuovo debito'}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="mb-1.5 animate-open border-[1.5px] border-ink bg-page px-4 pt-5 pb-[18px] md:px-[22px]"
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <Field label="cosa" className="flex-[3_1_220px]">
          <input ref={ref} className={inputClass} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="scaduto il" className="flex-[0_1_180px]">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="importo" className="flex-[0_1_150px]">
          <span className="flex items-baseline gap-1.5 border-b-[1.5px] border-ink">
            <AmountField value={amount} onChange={setAmount} aria-label="Importo" className="h-11 w-full text-[17px]" />
            <span className="text-[15px] text-ink-2">€</span>
          </span>
        </Field>
      </div>
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
        {debt && (
          <Button
            variant="danger"
            className="min-h-[46px]"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Elimino “${debt.description}”? Non resta traccia, nemmeno tra i saldati.`))
                del.mutate(debt.id, { onSuccess: onClose });
            }}
          >
            Elimina
          </Button>
        )}
      </div>
    </form>
  );
}
