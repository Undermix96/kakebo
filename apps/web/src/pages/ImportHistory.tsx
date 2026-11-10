import { useState, type ChangeEvent } from 'react';
import { historyImportSchema, type AccountRecord, type HistoryImport } from '@kakebo/core';
import { useCycles, useImportHistory } from '../api.ts';
import { Button, ErrorNote } from '../ui/kit.tsx';
import { formatDay, money, monthTitle, toDay } from '../format.ts';

/**
 * Loads the past cycles, debts and dates exported from the old spreadsheet
 * (tools/import-xlsx). The file is checked and summarised here first: nothing is
 * written before the user has seen what is in it and what does not match.
 */
export function ImportHistory({ accounts }: { accounts: AccountRecord[] }) {
  const [file, setFile] = useState<{ name: string; data: HistoryImport } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const imp = useImportHistory();
  const cycles = useCycles();

  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    setFile(null);
    setProblem(null);
    imp.reset();
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      return setProblem('il file non è un JSON valido');
    }
    const parsed = historyImportSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setProblem(`il file non è uno storico valido: ${issue?.message}${issue?.path.length ? ` (${issue.path.join('.')})` : ''}`);
    }
    setFile({ name: f.name, data: parsed.data });
  };

  const known = new Set(accounts.map((a) => a.name.toLowerCase()));
  const names = file
    ? file.data.cycles.flatMap((c) => [...c.balances.map((b) => b.account), ...c.entries.map((e) => e.account), ...c.transfers.flatMap((t) => [t.from, t.to])])
    : [];
  const unknown = [...new Set(names.filter((n) => !known.has(n.toLowerCase())))];
  const taken = file ? file.data.cycles.filter((c) => cycles.data?.some((x) => x.month === c.month)).map((c) => c.month) : [];
  const blocked = unknown.length > 0 || taken.length > 0;

  return (
    <div className="border-[1.5px] border-ink bg-page p-4 md:p-[22px]">
      <h3 className="m-0 font-display text-xl font-bold">Carica lo storico dal vecchio Excel</h3>
      <p className="mt-1.5 mb-0 max-w-[62ch] text-sm leading-normal text-ink-2">
        Il file JSON preparato da <span className="font-mono">tools/import-xlsx</span>: i cicli passati, i debiti e le date del calendario. I conti
        si abbinano per nome; un mese già presente blocca tutto il caricamento.
      </p>
      <label className="mt-3.5 inline-flex min-h-11 cursor-pointer items-center rounded-field border-[1.5px] border-ink px-4 text-[15px]">
        Scegli il file…
        <input type="file" accept="application/json,.json" className="sr-only" onChange={read} />
      </label>
      <div className="mt-3">
        <ErrorNote error={problem ?? imp.error} />
      </div>

      {file && !imp.isSuccess && (
        <div className="mt-2">
          <p className="m-0 text-[15px]">
            <span className="font-mono text-sm text-ink-2">{file.name}</span>
            {file.data.source && <> · {file.data.source}</>}: {file.data.cycles.length} cicli, {file.data.debts.length} debiti,{' '}
            {file.data.calendarEvents.length} date.
          </p>
          <ul className="mt-2 mb-0 pl-5 text-sm leading-relaxed">
            {file.data.cycles.map((c) => {
              const out = c.entries.filter((e) => e.kind === 'expense' && e.state === 'pending').reduce((s, e) => s + (e.amountCents ?? 0), 0);
              return (
                <li key={c.month}>
                  <strong>{monthTitle(c.month)}</strong> ({c.status === 'draft' ? 'bozza' : 'confermato'}) · saldi {toDay(c.plannedOn)} ·{' '}
                  {c.entries.length} voci, escono {money(out)} € · {c.transfers.length} bonifici
                  {c.notes && <span className="block text-ink-2">{c.notes}</span>}
                </li>
              );
            })}
          </ul>
          {file.data.debts.length > 0 && (
            <p className="mt-2 mb-0 text-sm text-ink-2">
              Debiti: {money(file.data.debts.reduce((s, d) => s + d.amountCents, 0))} € in tutto.
            </p>
          )}
          {unknown.length > 0 && (
            <p className="mt-2 mb-0 font-hand text-lg leading-tight text-verm">
              Conti che non trovo nel quaderno: {unknown.join(', ')}. Correggi il file o rinomina i conti, poi riprova.
            </p>
          )}
          {taken.length > 0 && (
            <p className="mt-2 mb-0 font-hand text-lg leading-tight text-verm">
              Ci sono già: {taken.map(monthTitle).join(', ')}. Toglili dal file per caricare il resto.
            </p>
          )}
          <Button
            variant="primary"
            className="mt-4 min-h-[50px] px-[22px]"
            disabled={imp.isPending || blocked}
            onClick={() => imp.mutate(file.data)}
          >
            {imp.isPending ? 'Carico…' : 'Carica nel quaderno'}
          </Button>
        </div>
      )}
      {imp.isSuccess && (
        <p role="status" className="mt-2 mb-0 text-[15px]">
          Fatto: {imp.data.cycles} cicli, {imp.data.debts} debiti e {imp.data.calendarEvents} date.
        </p>
      )}
    </div>
  );
}
