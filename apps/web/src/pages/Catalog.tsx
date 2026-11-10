import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  MONTHS_SHORT,
  addMonths,
  describeSchedule,
  formatEuro,
  monthOf,
  parseEuro,
  todayInRome,
  type AccountRecord,
  type CatalogItem,
  type ItemCreate,
  type Schedule,
} from '@kakebo/core';
import { useCatalog, useCreateItem, useUpdateItem } from '../api.ts';
import { AccountGlyph, Button, ErrorNote, Field, Hand, Loading, PageTitle, Segmented, cx, inputClass, monoInputClass } from '../ui/kit.tsx';
import { formatDay } from '../format.ts';
import { EmptyNotebook } from './EmptyNotebook.tsx';

type Group = 'account' | 'day';

/** Day column: the day for monthly items, the month (and day) for the others. */
function dayLabel(item: CatalogItem): string {
  const s = item.schedule;
  const day = item.day == null ? '' : String(item.day);
  if (s.type === 'monthly') return day || '—';
  const month =
    s.type === 'yearly' ? s.month : s.type === 'months' ? Math.min(...s.months) : Number(s.startMonth.slice(5, 7));
  return `${day} ${MONTHS_SHORT[month - 1]}`.trim();
}

/** Sort key inside the year: first month, then day. */
const yearKey = (item: CatalogItem) => {
  const s = item.schedule;
  const m = s.type === 'yearly' ? s.month : s.type === 'months' ? Math.min(...s.months) : s.type === 'every_n_months' ? Number(s.startMonth.slice(5, 7)) : 0;
  return m * 100 + (item.day ?? 0);
};

function status(item: CatalogItem, today: string): { muted: boolean; text: string | null } {
  if (item.activeFrom && item.activeFrom > today) return { muted: true, text: `sospesa, riprende il ${formatDay(item.activeFrom)}` };
  if (item.activeTo && item.activeTo < today) return { muted: true, text: `finita il ${formatDay(item.activeTo)}` };
  if (item.activeTo) return { muted: false, text: `fino al ${formatDay(item.activeTo)}` };
  return { muted: false, text: null };
}

const isActiveNow = (i: CatalogItem, today: string) =>
  !(i.activeFrom && i.activeFrom > today) && !(i.activeTo && i.activeTo < today);

function amountText(item: CatalogItem) {
  if (item.amountCents == null) return '—';
  return formatEuro(item.kind === 'expense' ? -item.amountCents : item.amountCents, { symbol: false, plus: true });
}

export function CatalogPage() {
  const catalog = useCatalog();
  const [group, setGroup] = useState<Group>('account');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayInRome();

  if (catalog.isPending) return <Loading />;
  if (catalog.isError)
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <ErrorNote error={catalog.error} />
        <Button onClick={() => catalog.refetch()}>Riprova</Button>
      </div>
    );

  const { accounts, items } = catalog.data;
  if (accounts.length === 0) return <EmptyNotebook />;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const live = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);

  const row = (item: CatalogItem) => (
    <Fragment key={item.id}>
      <ItemRow
        item={item}
        account={byId.get(item.accountId)}
        open={editing === item.id}
        today={today}
        onToggle={() => setEditing(editing === item.id ? null : item.id)}
      />
      {editing === item.id && <ItemEditor item={item} accounts={accounts} onClose={() => setEditing(null)} />}
    </Fragment>
  );

  let body: ReactNode;
  if (group === 'account') {
    body = accounts
      .filter((a) => a.active || live.some((i) => i.accountId === a.id))
      .map((a) => {
        const list = live.filter((i) => i.accountId === a.id).sort((x, y) => (x.day ?? 0) - (y.day ?? 0) || yearKey(x) - yearKey(y));
        const monthly = list.filter((i) => i.schedule.type === 'monthly' && isActiveNow(i, today));
        const out = monthly.filter((i) => i.kind === 'expense').reduce((s, i) => s + (i.amountCents ?? 0), 0);
        const inn = monthly.filter((i) => i.kind === 'income').reduce((s, i) => s + (i.amountCents ?? 0), 0);
        const sub = [
          `${list.length} ${list.length === 1 ? 'voce' : 'voci'}`,
          out ? `ogni mese escono ${formatEuro(out, { symbol: false })}` : null,
          inn ? `entrano ${formatEuro(inn, { symbol: false })}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <section key={a.id} aria-label={a.name}>
            <GroupHead title={a.name} sub={sub} glyph={<AccountGlyph color={a.color} shape={a.shape} />} />
            {list.map(row)}
          </section>
        );
      });
  } else {
    const monthly = live.filter((i) => i.schedule.type === 'monthly').sort((x, y) => (x.day ?? 0) - (y.day ?? 0));
    const yearly = live.filter((i) => i.schedule.type !== 'monthly').sort((x, y) => yearKey(x) - yearKey(y));
    body = (
      <>
        <section aria-label="Ogni mese">
          <GroupHead title="Ogni mese" sub={`${monthly.length} voci, in ordine di giorno`} />
          {monthly.map(row)}
        </section>
        <section aria-label="Nell’anno">
          <GroupHead title="Nell’anno" sub={`${yearly.length} scadenze`} />
          {yearly.map(row)}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3.5">
        <PageTitle sub="Le spese e le entrate che tornano. Ogni programmazione parte da qui: cambia una voce e la ritrovi già giusta il mese dopo.">
          Catalogo
        </PageTitle>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            label="Raggruppa"
            size="sm"
            options={[
              ['account', 'per conto'],
              ['day', 'per giorno'],
            ]}
            value={group}
            onChange={setGroup}
          />
          <Button variant="primary" onClick={() => setEditing('new')} aria-expanded={editing === 'new'}>
            + Nuova voce
          </Button>
        </div>
      </div>

      {editing === 'new' && (
        <div className="mt-5">
          <ItemEditor accounts={accounts} onClose={() => setEditing(null)} />
        </div>
      )}

      <div className="mt-[22px] hidden grid-cols-[64px_minmax(0,1fr)_130px_190px_150px_108px] gap-x-3.5 border-b-2 border-ink pb-1.5 text-[11.5px] tracking-[.08em] text-ink-2 uppercase md:grid">
        <span>giorno</span>
        <span>voce</span>
        <span>conto</span>
        <span>quando</span>
        <span className="text-right">importo</span>
        <span />
      </div>

      {body}

      {archived.length > 0 && (
        <section aria-label="Archiviate" className="mt-10">
          <button
            type="button"
            className="flex min-h-11 cursor-pointer items-center gap-2 border-none bg-transparent p-0 font-display text-lg font-bold text-ink-2"
            aria-expanded={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            <span aria-hidden="true">{showArchived ? '▾' : '▸'}</span>
            Archiviate ({archived.length})
          </button>
          {showArchived && archived.map((item) => <ArchivedRow key={item.id} item={item} account={byId.get(item.accountId)} />)}
        </section>
      )}
    </>
  );
}

function GroupHead({ title, sub, glyph }: { title: string; sub: string; glyph?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink pt-[22px] pb-1.5">
      <h2 className="m-0 flex items-center gap-[9px] font-display text-xl font-bold">
        {glyph}
        {title}
      </h2>
      <span className="text-right text-[13px] text-ink-2">{sub}</span>
    </div>
  );
}

const ROW_GRID = 'grid grid-cols-[38px_minmax(0,1fr)_auto] md:grid-cols-[64px_minmax(0,1fr)_130px_190px_150px_108px]';

function ItemRow({
  item,
  account,
  open,
  today,
  onToggle,
}: {
  item: CatalogItem;
  account: AccountRecord | undefined;
  open: boolean;
  today: string;
  onToggle: () => void;
}) {
  const st = status(item, today);
  const freq = describeSchedule(item.schedule);
  const mode = item.amountMode === 'last' ? 'proponi l’ultimo' : 'fisso';
  return (
    <div
      className={cx(
        ROW_GRID,
        'min-h-[52px] items-center gap-x-3.5 gap-y-0.5 border-b border-rule py-1.5',
        open && 'border-b-transparent bg-page px-3 shadow-[inset_0_0_0_1.5px_var(--color-ink)]',
        st.muted && !open && 'opacity-60',
      )}
    >
      <span className="self-start pt-[3px] font-mono text-sm text-ink-2 md:self-auto md:pt-0">{dayLabel(item)}</span>
      <span className="min-w-0">
        {/* On the phone the whole name opens the editor; on desktop the button does. */}
        <button
          type="button"
          onClick={onToggle}
          className="block w-full cursor-pointer border-none bg-transparent p-0 text-left font-sans text-base font-medium text-ink md:pointer-events-none md:cursor-default"
          aria-expanded={open}
          tabIndex={-1}
        >
          {item.name}
        </button>
        {item.note && <Hand className="block">{item.note}</Hand>}
        {item.amountCents == null && <Hand className="block">importo da inserire</Hand>}
        {item.day == null && <Hand className="block">giorno da decidere: conto il 1° del mese</Hand>}
        {st.text && <span className="block text-[12.5px] text-ink-2">{st.text}</span>}
        <span className="mt-[3px] block text-[12.5px] text-ink-2 md:hidden">
          {account && (
            <span className="mr-2 inline-flex align-middle">
              <AccountGlyph color={account.color} shape={account.shape} />
            </span>
          )}
          {account?.name} · {freq} · {mode}
        </span>
      </span>
      <span className="hidden items-center gap-[7px] text-sm text-ink-2 md:flex">
        {account && <AccountGlyph color={account.color} shape={account.shape} />}
        {account?.name ?? '?'}
      </span>
      <span className="hidden text-sm text-ink-2 md:block">{freq}</span>
      <span className="text-right">
        <span
          className={cx(
            'block font-mono text-base font-semibold',
            item.amountCents == null ? 'text-ink-2' : item.kind === 'expense' ? 'text-verm' : 'text-ink',
          )}
        >
          {amountText(item)}
        </span>
        <span className="hidden text-[11.5px] text-ink-2 md:block">{mode}</span>
      </span>
      <span className="hidden justify-self-end md:block">
        <Button
          variant="quiet"
          className="min-h-10 px-3"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Chiudi' : 'Modifica'} ${item.name}`}
        >
          {open ? 'Chiudi' : 'Modifica'}
        </Button>
      </span>
    </div>
  );
}

function ArchivedRow({ item, account }: { item: CatalogItem; account: AccountRecord | undefined }) {
  const update = useUpdateItem();
  return (
    <div className={cx(ROW_GRID, 'min-h-[52px] items-center gap-x-3.5 border-b border-rule py-1.5 text-ink-2')}>
      <span className="font-mono text-sm">{dayLabel(item)}</span>
      <span className="min-w-0">
        <span className="block text-base">{item.name}</span>
        <ErrorNote error={update.error} />
      </span>
      <span className="hidden items-center gap-[7px] text-sm md:flex">
        {account && <AccountGlyph color={account.color} shape={account.shape} />}
        {account?.name}
      </span>
      <span className="hidden text-sm md:block">{describeSchedule(item.schedule)}</span>
      <span className="hidden text-right font-mono md:block">{amountText(item)}</span>
      <Button
        variant="quiet"
        className="min-h-10 justify-self-end px-3"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: item.id, patch: { archived: false } })}
        aria-label={`Ripristina ${item.name}`}
      >
        Ripristina
      </Button>
    </div>
  );
}

// ---------- editor ----------

type Freq = Schedule['type'];
const FREQS: [Freq, string][] = [
  ['monthly', 'ogni mese'],
  ['every_n_months', 'ogni N mesi'],
  ['yearly', 'una volta l’anno'],
  ['months', 'mesi precisi'],
];

interface Draft {
  kind: 'expense' | 'income';
  name: string;
  day: string;
  accountId: string;
  freq: Freq;
  n: string;
  startMonth: string; // YYYY-MM
  yearlyMonth: number;
  months: number[];
  amountMode: 'fixed' | 'last';
  amount: string;
  note: string;
  activeFrom: string;
  activeTo: string;
}

function toDraft(item: CatalogItem | undefined, accounts: AccountRecord[]): Draft {
  const s = item?.schedule ?? { type: 'monthly' };
  const thisMonth = monthOf(todayInRome());
  return {
    kind: item?.kind ?? 'expense',
    name: item?.name ?? '',
    day: item?.day == null ? '' : String(item.day),
    accountId: item?.accountId ?? accounts.find((a) => a.active)?.id ?? '',
    freq: s.type,
    n: s.type === 'every_n_months' ? String(s.n) : '2',
    startMonth: s.type === 'every_n_months' ? s.startMonth : thisMonth,
    yearlyMonth: s.type === 'yearly' ? s.month : Number(thisMonth.slice(5)),
    months: s.type === 'months' ? s.months : [],
    amountMode: item?.amountMode ?? 'fixed',
    amount: item?.amountCents == null ? '' : formatEuro(item.amountCents, { symbol: false }),
    note: item?.note ?? '',
    activeFrom: item?.activeFrom ?? '',
    activeTo: item?.activeTo ?? '',
  };
}

/** Validates the draft; returns the payload or the first problem (Italian). */
function fromDraft(d: Draft): { ok: true; value: ItemCreate } | { ok: false; error: string } {
  if (!d.name.trim()) return { ok: false, error: 'scrivi il nome della voce' };
  if (!d.accountId) return { ok: false, error: 'scegli il conto' };
  let day: number | null = null;
  if (d.day.trim()) {
    day = Number(d.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) return { ok: false, error: 'il giorno va da 1 a 31' };
  }
  let schedule: Schedule;
  switch (d.freq) {
    case 'monthly':
      schedule = { type: 'monthly' };
      break;
    case 'yearly':
      schedule = { type: 'yearly', month: d.yearlyMonth };
      break;
    case 'months':
      if (d.months.length === 0) return { ok: false, error: 'scegli almeno un mese' };
      schedule = { type: 'months', months: [...d.months].sort((a, b) => a - b) };
      break;
    case 'every_n_months': {
      const n = Number(d.n);
      if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, error: 'ogni quanti mesi? da 1 a 12' };
      if (!/^\d{4}-\d{2}$/.test(d.startMonth)) return { ok: false, error: 'scegli il mese da cui parte' };
      schedule = { type: 'every_n_months', n, startMonth: d.startMonth };
      break;
    }
  }
  let amountCents: number | null = null;
  if (d.amount.trim()) {
    amountCents = parseEuro(d.amount);
    if (amountCents == null) return { ok: false, error: 'importo non valido (es. 1.234,56)' };
    if (amountCents < 0) return { ok: false, error: 'l’importo va scritto senza segno: spesa o entrata lo decide il tipo' };
  }
  if (d.activeFrom && d.activeTo && d.activeFrom > d.activeTo) return { ok: false, error: 'la data di fine viene prima di quella di inizio' };
  return {
    ok: true,
    value: {
      kind: d.kind,
      name: d.name.trim(),
      accountId: d.accountId,
      day,
      schedule,
      amountMode: d.amountMode,
      amountCents,
      note: d.note.trim() || null,
      activeFrom: d.activeFrom || null,
      activeTo: d.activeTo || null,
    },
  };
}

function ItemEditor({ item, accounts, onClose }: { item?: CatalogItem; accounts: AccountRecord[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(item, accounts));
  const [problem, setProblem] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [resumeMonth, setResumeMonth] = useState(() => addMonths(monthOf(todayInRome()), 1));
  const create = useCreateItem();
  const update = useUpdateItem();
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const pending = create.isPending || update.isPending;
  const today = todayInRome();
  const suspended = !!item?.activeFrom && item.activeFrom > today;

  useEffect(() => nameRef.current?.focus(), []);

  const selectable = useMemo(
    () => accounts.filter((a) => a.active || a.id === item?.accountId),
    [accounts, item?.accountId],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = fromDraft(d);
    if (!r.ok) return setProblem(r.error);
    setProblem(null);
    const done = { onSuccess: onClose };
    if (item) update.mutate({ id: item.id, patch: r.value }, done);
    else create.mutate(r.value, done);
  };

  const patchNow = (patch: Parameters<typeof update.mutate>[0]['patch']) => item && update.mutate({ id: item.id, patch }, { onSuccess: onClose });

  return (
    <form
      aria-label={item ? `Modifica ${item.name}` : 'Nuova voce'}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className={cx(
        'mb-1.5 animate-open border-[1.5px] border-ink bg-page px-4 pt-5 pb-[18px] md:px-[22px]',
        item && 'border-t-0',
      )}
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <Segmented
          label="Tipo"
          size="sm"
          options={[
            ['expense', 'spesa'],
            ['income', 'entrata'],
          ]}
          value={d.kind}
          onChange={(kind) => set({ kind })}
        />
        <Field label="nome" className="flex-[3_1_220px]">
          <input ref={nameRef} className={inputClass} value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="giorno" className="flex-[0_1_90px]">
          <input
            className={monoInputClass}
            inputMode="numeric"
            value={d.day}
            placeholder="?"
            onChange={(e) => set({ day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          />
        </Field>
      </div>

      <fieldset className="m-0 mt-4 border-none p-0">
        <legend className="p-0 text-xs text-ink-2">conto</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selectable.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === d.accountId}
              onClick={() => set({ accountId: a.id })}
              className={cx(
                'flex min-h-10 cursor-pointer items-center gap-[7px] rounded-[20px] border-[1.5px] px-3 font-sans text-sm',
                a.id === d.accountId ? 'border-inv bg-inv text-inv-ink' : 'border-rule bg-transparent text-ink',
              )}
            >
              <AccountGlyph color={a.color} shape={a.shape} />
              {a.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-[18px] flex flex-wrap gap-x-7 gap-y-4">
        <fieldset className="m-0 flex-[1_1_320px] border-none p-0">
          <legend className="p-0 text-xs text-ink-2">quando torna</legend>
          <div className="mt-1.5">
            <Segmented label="Frequenza" size="sm" options={FREQS} value={d.freq} onChange={(freq) => set({ freq })} />
          </div>
          {d.freq === 'every_n_months' && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
              ogni
              <input
                className="h-[38px] w-12 border-0 border-b-[1.5px] border-ink bg-transparent text-center font-mono text-base text-ink"
                inputMode="numeric"
                aria-label="Numero di mesi"
                value={d.n}
                onChange={(e) => set({ n: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              />
              mesi, a partire da
              <input
                type="month"
                aria-label="Primo mese"
                className="h-[38px] border-0 border-b-[1.5px] border-ink bg-transparent text-base text-ink"
                value={d.startMonth}
                onChange={(e) => set({ startMonth: e.target.value })}
              />
            </div>
          )}
          {(d.freq === 'months' || d.freq === 'yearly') && (
            <div role="group" aria-label="Mesi" className="mt-2.5 grid max-w-[360px] grid-cols-6 gap-1">
              {MONTHS_SHORT.map((m, i) => {
                const month = i + 1;
                const sel = d.freq === 'yearly' ? d.yearlyMonth === month : d.months.includes(month);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={sel}
                    onClick={() =>
                      d.freq === 'yearly'
                        ? set({ yearlyMonth: month })
                        : set({ months: sel ? d.months.filter((x) => x !== month) : [...d.months, month] })
                    }
                    className={cx(
                      'min-h-9 cursor-pointer rounded-[2px] border font-sans text-[13px]',
                      sel ? 'border-inv bg-inv text-inv-ink' : 'border-rule bg-transparent text-ink',
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        <fieldset className="m-0 flex-[1_1_300px] border-none p-0">
          <legend className="p-0 text-xs text-ink-2">importo</legend>
          <div className="mt-1.5 flex items-baseline gap-1.5 border-b-[1.5px] border-ink">
            <input
              className="h-10 w-full min-w-0 border-none bg-transparent text-right font-mono text-[17px] text-ink"
              inputMode="decimal"
              aria-label="Importo"
              placeholder="non lo so ancora"
              value={d.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
            <span className="text-[15px] text-ink-2">€</span>
          </div>
          <label className="mt-1.5 flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px]">
            <input
              type="radio"
              name="mode"
              checked={d.amountMode === 'last'}
              onChange={() => set({ amountMode: 'last' })}
              className="m-0 size-5 accent-ink"
            />
            proponi l’ultimo usato
            {item?.amountMode === 'last' && item.amountCents != null && (
              <span className="font-mono text-ink-2">· l’ultima volta {formatEuro(item.amountCents, { symbol: false })}</span>
            )}
          </label>
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px]">
            <input
              type="radio"
              name="mode"
              checked={d.amountMode === 'fixed'}
              onChange={() => set({ amountMode: 'fixed' })}
              className="m-0 size-5 accent-ink"
            />
            sempre lo stesso
          </label>
        </fieldset>
      </div>

      <Field label="nota, compare come promemoria nella programmazione" className="mt-3.5">
        <textarea
          rows={2}
          className="resize-y border-0 border-b-[1.5px] border-ink bg-transparent px-0 py-2 font-sans text-[15px] text-ink"
          value={d.note}
          onChange={(e) => set({ note: e.target.value })}
          maxLength={500}
        />
      </Field>

      <details className="mt-3.5" open={!!(d.activeFrom || d.activeTo)}>
        <summary className="cursor-pointer text-sm text-ink-2">quando vale (facoltativo)</summary>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">
          <Field label="dal" className="flex-[0_1_180px]">
            <input type="date" className={inputClass} value={d.activeFrom} onChange={(e) => set({ activeFrom: e.target.value })} />
          </Field>
          <Field label="fino al" className="flex-[0_1_180px]">
            <input type="date" className={inputClass} value={d.activeTo} onChange={(e) => set({ activeTo: e.target.value })} />
          </Field>
        </div>
      </details>

      <div className="mt-3 flex flex-col gap-1">
        <ErrorNote error={problem ?? create.error ?? update.error} />
      </div>

      <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
        <Button variant="primary" type="submit" disabled={pending} className="min-h-[46px] px-5">
          {pending ? 'Salvo…' : 'Salva'}
        </Button>
        <Button onClick={onClose} className="min-h-[46px]">
          Annulla
        </Button>
        <span className="flex-1" />
        {item && !suspended && !suspending && (
          <Button variant="dashed" className="min-h-[46px]" onClick={() => setSuspending(true)}>
            Sospendi per un po’
          </Button>
        )}
        {item && suspending && (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            riprende da
            <input
              type="month"
              aria-label="Mese in cui riprende"
              className="h-10 border-0 border-b-[1.5px] border-ink bg-transparent text-base text-ink"
              value={resumeMonth}
              min={addMonths(monthOf(today), 1)}
              onChange={(e) => setResumeMonth(e.target.value)}
            />
            <Button variant="dashed" className="min-h-10" disabled={!resumeMonth} onClick={() => patchNow({ activeFrom: `${resumeMonth}-01` })}>
              Sospendi
            </Button>
          </span>
        )}
        {item && suspended && (
          <Button variant="dashed" className="min-h-[46px]" onClick={() => patchNow({ activeFrom: null })}>
            Riattiva da subito
          </Button>
        )}
        {item && (
          <Button variant="danger" className="min-h-[46px]" onClick={() => patchNow({ archived: true })}>
            Archivia
          </Button>
        )}
      </div>
    </form>
  );
}
