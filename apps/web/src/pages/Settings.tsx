import { useState, type FormEvent } from 'react';
import {
  ACCOUNT_COLORS,
  ACCOUNT_SHAPES,
  ROUNDING_OPTIONS,
  colorGroup,
  formatEuro,
  parseEuro,
  type AccountColor,
  type AccountRecord,
  type AccountShape,
  type Settings,
} from '@kakebo/core';
import { useCatalog, useCreateAccount, useUpdateAccount, useUpdateSettings } from '../api.ts';
import { AccountGlyph, Button, ErrorNote, Field, Loading, PageTitle, Segmented, accountColor, cx, inputClass } from '../ui/kit.tsx';
import { useTheme, type ThemeChoice } from '../theme.ts';
import { ImportCatalog } from './EmptyNotebook.tsx';

const smallInput = 'h-10 w-14 border-0 border-b-[1.5px] border-ink bg-transparent text-center font-mono text-[17px] text-ink';

const COLOR_NAME = Object.fromEntries(ACCOUNT_COLORS) as Record<AccountColor, string>;
const SHAPE_NAME: Record<AccountShape, string> = { square: 'quadrato', diamond: 'rombo', circle: 'cerchio', bar: 'barra' };

export function SettingsPage() {
  const catalog = useCatalog();
  return (
    <div className="max-w-[1100px]">
      <PageTitle>Impostazioni</PageTitle>
      {catalog.isPending && <Loading />}
      {catalog.isError && (
        <div className="mt-6 flex flex-col items-start gap-4">
          <ErrorNote error={catalog.error} />
          <Button onClick={() => catalog.refetch()}>Riprova</Button>
        </div>
      )}
      {catalog.isSuccess && (
        <>
          <AccountsSection accounts={catalog.data.accounts} />
          {catalog.data.accounts.length === 0 && (
            <section className="mt-9">
              <ImportCatalog />
            </section>
          )}
          <RoundingSection settings={catalog.data.settings} />
          <CycleSection settings={catalog.data.settings} />
        </>
      )}
      <ThemeSection />
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="m-0 border-b-2 border-ink pb-2 font-display text-[22px] font-bold">
      {children}
    </h2>
  );
}

// ---------- accounts ----------

function AccountsSection({ accounts }: { accounts: AccountRecord[] }) {
  const [adding, setAdding] = useState(false);
  const title = accounts.filter((a) => a.active).length === 4 ? 'I quattro conti' : 'I conti';
  return (
    <section aria-labelledby="conti" className="mt-7">
      <SectionTitle id="conti">{title}</SectionTitle>
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
      {adding ? (
        <NewAccount used={accounts} onClose={() => setAdding(false)} />
      ) : (
        <Button variant="dashed" className="mt-4" onClick={() => setAdding(true)}>
          + Aggiungi un conto
        </Button>
      )}
    </section>
  );
}

function AccountRow({ account: a }: { account: AccountRecord }) {
  const update = useUpdateAccount();
  const [name, setName] = useState(a.name);
  const [role, setRole] = useState(a.role);
  const [margin, setMargin] = useState(formatEuro(a.marginCents, { symbol: false }));
  const [problem, setProblem] = useState<string | null>(null);

  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) => {
    setProblem(null);
    update.mutate({ id: a.id, patch });
  };
  const saveMargin = () => {
    const cents = parseEuro(margin || '0');
    if (cents == null || cents < 0) return setProblem('margine non valido (es. 50,00)');
    setMargin(formatEuro(cents, { symbol: false }));
    if (cents !== a.marginCents) save({ marginCents: cents });
  };

  return (
    <div className={cx('border-b border-rule py-4', !a.active && 'opacity-60')}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3.5">
        <div className="flex-[0_0_170px]">
          <div className="flex items-center gap-[9px]">
            <AccountGlyph color={a.color} shape={a.shape} />
            <input
              aria-label="Nome del conto"
              className="h-9 w-full min-w-0 border-0 border-b border-transparent bg-transparent p-0 text-lg font-bold text-ink hover:border-rule focus:border-ink"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name.trim() !== a.name && save({ name: name.trim() })}
            />
          </div>
          <div role="radiogroup" aria-label={`Colore di ${a.name}`} className="mt-2.5 flex gap-1.5">
            {colorGroup(a.color).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === a.color}
                aria-label={COLOR_NAME[c]}
                title={COLOR_NAME[c]}
                onClick={() => c !== a.color && save({ color: c })}
                className={cx(
                  'size-8 cursor-pointer rounded-full border-[3px] border-paper p-0',
                  c === a.color ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'shadow-[0_0_0_1px_var(--color-rule)]',
                )}
                style={{ background: accountColor(c) }}
              />
            ))}
          </div>
        </div>
        <Field label="ruolo" className="flex-[2_1_220px]">
          <input
            className={cx(inputClass, 'text-base')}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onBlur={() => role.trim() !== a.role && save({ role: role.trim() })}
          />
        </Field>
        <Field label="margine di sicurezza" className="flex-[1_1_150px]">
          <span className="flex items-baseline gap-1.5 border-b-[1.5px] border-ink">
            <input
              className="h-11 w-full min-w-0 flex-1 border-none bg-transparent text-right font-mono text-[17px] text-ink"
              inputMode="decimal"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              onBlur={saveMargin}
            />
            <span className="text-[15px] text-ink-2">€</span>
          </span>
        </Field>
        <label className="flex min-h-11 flex-none cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="avanzi"
            checked={a.receivesLeftover}
            disabled={!a.active}
            onChange={() => save({ receivesLeftover: true })}
            className="m-0 size-5 accent-ink"
          />
          riceve gli avanzi
        </label>
        <Button variant="danger" className="min-h-11" onClick={() => save({ active: !a.active })}>
          {a.active ? 'Chiudi il conto' : 'Riapri'}
        </Button>
      </div>
      <div className="mt-2">
        <ErrorNote error={problem ?? update.error} />
      </div>
    </div>
  );
}

function NewAccount({ used, onClose }: { used: AccountRecord[]; onClose: () => void }) {
  const create = useCreateAccount();
  const usedColors = new Set(used.map((a) => a.color));
  const usedShapes = new Set(used.map((a) => a.shape));
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [color, setColor] = useState<AccountColor>(ACCOUNT_COLORS.find(([c]) => !usedColors.has(c))?.[0] ?? 'indaco');
  const [shape, setShape] = useState<AccountShape>(ACCOUNT_SHAPES.find((s) => !usedShapes.has(s)) ?? 'square');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setProblem('scrivi il nome del conto');
    setProblem(null);
    create.mutate({ name: name.trim(), role: role.trim(), color, shape }, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} aria-label="Nuovo conto" className="mt-4 animate-open border-[1.5px] border-ink bg-page p-4 md:p-[22px]">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <Field label="nome" className="flex-[1_1_200px]">
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="ruolo" className="flex-[2_1_260px]">
          <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
      </div>
      <fieldset className="m-0 mt-4 border-none p-0">
        <legend className="p-0 text-xs text-ink-2">segno</legend>
        <div className="mt-1.5 flex gap-1.5">
          {ACCOUNT_SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === shape}
              aria-label={SHAPE_NAME[s]}
              title={SHAPE_NAME[s]}
              onClick={() => setShape(s)}
              className={cx(
                'grid size-10 cursor-pointer place-items-center rounded-field border-[1.5px] bg-transparent',
                s === shape ? 'border-ink' : 'border-rule',
              )}
            >
              <AccountGlyph color={color} shape={s} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 mt-4 border-none p-0">
        <legend className="p-0 text-xs text-ink-2">colore</legend>
        <div role="radiogroup" aria-label="Colore" className="mt-1.5 flex flex-wrap gap-1.5">
          {ACCOUNT_COLORS.map(([c, label]) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={label}
              title={label}
              onClick={() => setColor(c)}
              className={cx(
                'size-8 cursor-pointer rounded-full border-[3px] border-page p-0',
                c === color ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'shadow-[0_0_0_1px_var(--color-rule)]',
              )}
              style={{ background: accountColor(c) }}
            />
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        <ErrorNote error={problem ?? create.error} />
      </div>
      <div className="mt-4 flex gap-2.5">
        <Button variant="primary" type="submit" disabled={create.isPending}>
          Aggiungi
        </Button>
        <Button onClick={onClose}>Annulla</Button>
      </div>
    </form>
  );
}

// ---------- transfers and cycle ----------

const ROUNDING_LABEL: Record<(typeof ROUNDING_OPTIONS)[number], string> = {
  0: 'al centesimo',
  100: 'all’euro',
  500: 'a 5 €',
  1000: 'a 10 €',
};

function RoundingSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const value = (update.isPending ? update.variables.roundingCents : undefined) ?? settings.roundingCents;
  const examples = [31207, 98000, 12545];
  const up = (v: number) => (value ? Math.ceil(v / value) * value : v);
  return (
    <section aria-labelledby="bonifici" className="mt-9">
      <SectionTitle id="bonifici">Arrotondamento dei bonifici</SectionTitle>
      <p className="mt-3 mb-0 text-[15px] text-ink-2">Arrotondo sempre per eccesso: meglio un euro in più sul conto che uno in meno.</p>
      <div className="mt-3">
        <Segmented
          label="Arrotondamento"
          options={ROUNDING_OPTIONS.map((r) => [r, ROUNDING_LABEL[r]] as const)}
          value={value as (typeof ROUNDING_OPTIONS)[number]}
          onChange={(roundingCents) => update.mutate({ roundingCents })}
        />
      </div>
      <p className="mt-3.5 mb-0 flex flex-wrap gap-x-7 gap-y-2 text-sm text-ink-2">
        {examples.map((v) => (
          <span key={v}>
            {formatEuro(v, { symbol: false })} diventa <span className="font-mono text-ink">{formatEuro(up(v), { symbol: false })}</span>
          </span>
        ))}
      </p>
      <div className="mt-2">
        <ErrorNote error={update.error} />
      </div>
    </section>
  );
}

function CycleSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [endDay, setEndDay] = useState(String(settings.cycleEndDay));
  const [lead, setLead] = useState(String(settings.leadDays));
  const [problem, setProblem] = useState<string | null>(null);

  const saveNumber = (raw: string, key: 'cycleEndDay' | 'leadDays', min: number, max: number, msg: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) return setProblem(msg);
    setProblem(null);
    if (n !== settings[key]) update.mutate({ [key]: n });
  };

  return (
    <section aria-labelledby="ciclo" className="mt-9">
      <SectionTitle id="ciclo">Il ciclo</SectionTitle>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 text-[15px]">
        <label className="flex flex-wrap items-center gap-2">
          finisce il giorno
          <input
            className={smallInput}
            inputMode="numeric"
            value={endDay}
            onChange={(e) => setEndDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => saveNumber(endDay, 'cycleEndDay', 1, 28, 'il giorno di fine ciclo va da 1 a 28')}
          />
          del mese dopo
        </label>
        <label className="flex flex-wrap items-center gap-2">
          bonifici entro
          <input
            className={smallInput}
            inputMode="numeric"
            value={lead}
            onChange={(e) => setLead(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => saveNumber(lead, 'leadDays', 0, 10, 'l’anticipo va da 0 a 10 giorni')}
          />
          {lead === '1' ? 'giorno' : 'giorni'} prima della spesa
        </label>
      </div>
      <div className="mt-2">
        <ErrorNote error={problem ?? update.error} />
      </div>
    </section>
  );
}

// ---------- appearance ----------

const THEMES: [ThemeChoice, string, string][] = [
  ['light', 'Chiaro', 'bg-[linear-gradient(90deg,var(--k-swatch-light)_0_60%,var(--k-swatch-light-page)_60%)] shadow-[inset_0_-10px_0_var(--k-swatch-light-ink)]'],
  ['dark', 'Scuro', 'bg-[linear-gradient(90deg,var(--k-swatch-dark)_0_60%,var(--k-swatch-dark-page)_60%)] shadow-[inset_0_-10px_0_var(--k-swatch-dark-ink)]'],
  ['system', 'Come il sistema', 'bg-[linear-gradient(135deg,var(--k-swatch-light)_0_50%,var(--k-swatch-dark)_50%)]'],
];

function ThemeSection() {
  const [theme, setTheme] = useTheme();
  return (
    <section aria-labelledby="aspetto" className="mt-9">
      <SectionTitle id="aspetto">Aspetto</SectionTitle>
      <p className="mt-3 mb-0 text-sm text-ink-2">La scelta resta su questo dispositivo.</p>
      <div role="radiogroup" aria-label="Tema" className="mt-3.5 flex flex-wrap gap-2.5">
        {THEMES.map(([key, label, preview]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === theme}
            onClick={() => setTheme(key)}
            className={cx(
              'flex w-[150px] cursor-pointer flex-col items-start gap-2 rounded-field bg-transparent p-2.5 font-sans text-sm text-ink',
              key === theme ? 'border-2 border-ink' : 'border border-rule',
            )}
          >
            <span aria-hidden="true" className={cx('h-14 w-full border border-rule', preview)} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
