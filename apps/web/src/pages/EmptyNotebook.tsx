import { useState, type ChangeEvent } from 'react';
import { catalogImportSchema, describeSchedule, formatEuro, type CatalogImport } from '@kakebo/core';
import { useImportCatalog } from '../api.ts';
import { Link } from '../router.tsx';
import { Button, ErrorNote, Seal } from '../ui/kit.tsx';

/** First start: nothing in the database yet. */
export function EmptyNotebook() {
  return (
    <div className="flex flex-col items-start py-6 md:py-12">
      <Seal size={72} />
      <h2 className="mt-[22px] mb-0 font-display text-[34px] leading-[1.1] font-bold">Il quaderno è nuovo.</h2>
      <p className="mt-2.5 mb-0 max-w-[48ch] text-base leading-[1.55] text-ink-2">
        Per cominciare servono i conti e le spese che tornano ogni mese. Puoi caricarli da un file del catalogo, oppure
        creare i conti nelle impostazioni e aggiungere le voci a mano.
      </p>
      <div className="mt-[22px] w-full max-w-2xl">
        <ImportCatalog />
      </div>
      <Link
        href="/impostazioni"
        className="mt-5 inline-flex min-h-[52px] items-center rounded-field border-[1.5px] border-ink px-4 text-[15px] text-ink no-underline"
      >
        Crea i conti a mano
      </Link>
    </div>
  );
}

/**
 * Loads the initial catalog from a JSON file. The file is checked here first and
 * summarised, so nothing is written before the user has seen what is in it.
 */
export function ImportCatalog() {
  const [file, setFile] = useState<{ name: string; data: CatalogImport } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const imp = useImportCatalog();

  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    setFile(null);
    setProblem(null);
    imp.reset();
    const f = e.target.files?.[0];
    if (!f) return;
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      return setProblem('il file non è un JSON valido');
    }
    const parsed = catalogImportSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setProblem(`il file non è un catalogo valido: ${issue?.message}${issue?.path.length ? ` (${issue.path.join('.')})` : ''}`);
    }
    setFile({ name: f.name, data: parsed.data });
  };

  const items = file?.data.items ?? [];
  const live = items.filter((i) => !i.archived);
  const missing = live.filter((i) => i.amountCents == null);
  const noDay = live.filter((i) => i.day == null);

  return (
    <div className="border-[1.5px] border-ink bg-page p-4 md:p-[22px]">
      <h3 className="m-0 font-display text-xl font-bold">Carica il catalogo da un file</h3>
      <p className="mt-1.5 mb-0 text-sm text-ink-2">
        Un file JSON con i conti e le voci. Si può fare solo la prima volta, a quaderno vuoto.
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
            <span className="font-mono text-sm text-ink-2">{file.name}</span>: {file.data.accounts.length} conti,{' '}
            {live.length} voci attive
            {items.length > live.length && `, ${items.length - live.length} archiviate`}.
          </p>
          <ul className="mt-2 mb-0 pl-5 text-sm text-ink-2">
            {file.data.accounts.map((a) => (
              <li key={a.name}>
                {a.name}: {items.filter((i) => i.account.toLowerCase() === a.name.toLowerCase() && !i.archived).length} voci
                {a.receivesLeftover && ' · riceve gli avanzi'}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 mb-0 font-hand text-lg leading-tight text-verm">
              Senza importo, da inserire poi: {missing.map((i) => `${i.name} (${describeSchedule(i.schedule)})`).join(', ')}.
            </p>
          )}
          {noDay.length > 0 && (
            <p className="mt-1 mb-0 font-hand text-lg leading-tight text-verm">
              Senza giorno, contate il 1° del mese: {noDay.map((i) => i.name).join(', ')}.
            </p>
          )}
          <p className="mt-2 mb-0 text-sm text-ink-2">
            Ogni mese escono{' '}
            {formatEuro(
              live.filter((i) => i.kind === 'expense' && i.schedule.type === 'monthly').reduce((s, i) => s + (i.amountCents ?? 0), 0),
            )}{' '}
            ed entrano{' '}
            {formatEuro(
              live.filter((i) => i.kind === 'income' && i.schedule.type === 'monthly').reduce((s, i) => s + (i.amountCents ?? 0), 0),
            )}
            .
          </p>
          <Button variant="primary" className="mt-4 min-h-[50px] px-[22px]" disabled={imp.isPending} onClick={() => imp.mutate(file.data)}>
            {imp.isPending ? 'Carico…' : 'Carica nel quaderno'}
          </Button>
        </div>
      )}
      {imp.isSuccess && (
        <p role="status" className="mt-2 mb-0 text-[15px]">
          Fatto: {imp.data.accounts} conti e {imp.data.items} voci.
        </p>
      )}
    </div>
  );
}
