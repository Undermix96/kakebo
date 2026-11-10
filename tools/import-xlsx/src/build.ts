import {
  addMonths,
  dateInMonth,
  formatEuro,
  historyImportSchema,
  type CatalogImport,
  type HistoryImport,
  type ISODate,
  type YearMonth,
} from '@kakebo/core';
import { bestMatch, normalize } from './match.ts';
import {
  findCycleSheets,
  parseDeadlines,
  parseDebts,
  parseFreshSheet,
  parsePlanSheet,
  parseSummary,
  toCents,
  type FreshRow,
  type Grid,
  type PlanRow,
} from './parse.ts';

/**
 * Everything specific to the family's spreadsheet that is not layout: kept in a
 * private file (private/import-xlsx.config.json), never in the repository.
 */
export interface ImportConfig {
  /** Months to import (default: every month with a "Calcolo" sheet). */
  months?: YearMonth[];
  /** Months to import as drafts instead of confirmed cycles (default: the last one). */
  draftMonths?: YearMonth[];
  /** Spreadsheet account name → account name in the app (e.g. an old label). */
  accountAliases?: Record<string, string>;
  /** Account for movements whose account cannot be found. */
  defaultAccount?: string;
  /** Source account of the transfers made ("Bon. Effett.") when the sheet does not say it. */
  transferSource?: string;
  /** Planning day per month (default: the end day of that month). */
  plannedOn?: Record<YearMonth, ISODate>;
  /** Balances in euros per month and account, for sheets that do not have them. */
  knownBalances?: Record<YearMonth, Record<string, number>>;
  /** Regular expressions of "Scadenze" entries to leave out (old suppliers, catalog items…). */
  calendarSkip?: string[];
  /** Day of month M+1 when cycle M ends (default 10). */
  cycleEndDay?: number;
}

export interface Workbook {
  sheetNames: string[];
  grid(name: string): Grid;
}

type Catalog = Pick<CatalogImport, 'accounts' | 'items'>;
type HistoryCycle = HistoryImport['cycles'][number];
type HistoryEntry = HistoryCycle['entries'][number];

const eur = (cents: number) => formatEuro(cents);
const euros = (e: number) => eur(toCents(e));

/** Builds the history file and a reconciliation report (Markdown) to read before loading it. */
export function buildHistory(book: Workbook, catalog: Catalog, config: ImportConfig = {}): { history: HistoryImport; report: string } {
  const endDay = config.cycleEndDay ?? 10;
  const report: string[] = ['# Import dello storico: riconciliazione', ''];
  const appAccounts = catalog.accounts.map((a) => a.name);
  const aliases = new Map(Object.entries(config.accountAliases ?? {}).map(([k, v]) => [normalize(k), v]));
  const accountProblems = new Set<string>();

  const appAccount = (excel: string): string => {
    const alias = aliases.get(normalize(excel));
    if (alias) return alias;
    const direct = appAccounts.find((a) => normalize(a) === normalize(excel));
    if (direct) return direct;
    const near = bestMatch(excel, appAccounts, (a) => a, 0.85);
    if (near) return near.item;
    accountProblems.add(excel);
    return excel;
  };

  const all = findCycleSheets(book.sheetNames);
  const wanted = config.months ?? all.map((c) => c.month);
  const sheets = all.filter((c) => wanted.includes(c.month));
  for (const m of wanted) if (!sheets.some((s) => s.month === m)) report.push(`- ⚠ ${m}: nessun foglio "Calcolo" trovato.`);
  const drafts = config.draftMonths ?? (sheets.length ? [sheets.at(-1)!.month] : []);

  const cycles: HistoryCycle[] = [];
  for (const s of sheets) {
    const lines: string[] = [];
    const notes: string[] = [];
    const plannedOn = config.plannedOn?.[s.month] ?? dateInMonth(s.month, endDay);
    const endsOn = dateInMonth(addMonths(s.month, 1), endDay);
    const plan = s.plan ? parsePlanSheet(book.grid(s.plan)) : [];
    const summary = s.plan ? parseSummary(book.grid(s.plan)) : null;
    const fresh = s.fresh ? parseFreshSheet(book.grid(s.fresh)) : null;
    lines.push(`## ${s.month} (${drafts.includes(s.month) ? 'bozza' : 'confermato'})`, '');
    lines.push(`Fogli: ${[s.plan, s.fresh].filter(Boolean).map((n) => `“${n}”`).join(' + ')}. Saldi al ${plannedOn}, fine ciclo ${endsOn}.`, '');

    // Dates: incomes count by cycle (always month M, like the salary of the 9th);
    // expenses by date: day ≥ end day → month M, otherwise M+1. The same expense on
    // the end day twice → the second one is M+1.
    const seen = new Set<string>();
    const dateOf = (name: string, day: number | null, kind: 'income' | 'expense' = 'expense'): ISODate => {
      const d = day ?? 1;
      if (kind === 'income') return dateInMonth(s.month, d);
      const inM = d >= endDay;
      const key = `${normalize(name)}@${d}`;
      if (d === endDay && seen.has(key)) return dateInMonth(addMonths(s.month, 1), d);
      seen.add(key);
      return dateInMonth(inM ? s.month : addMonths(s.month, 1), d);
    };

    const itemFor = (name: string, kind: 'income' | 'expense', account: string | null) => {
      const pool = catalog.items.filter((i) => i.kind === kind);
      const sameAccount = account ? pool.filter((i) => normalize(i.account) === normalize(account)) : [];
      return bestMatch(name, sameAccount, (i) => i.name) ?? bestMatch(name, pool, (i) => i.name);
    };

    for (const p of plan.filter((p) => p.misplaced)) {
      lines.push(`- ⚠ riga ${p.row} “${p.name}”: importo in colonna E (${euros(p.amount)}), lo uso comunque.`);
    }

    const entries: HistoryEntry[] = [];
    const table: string[] = ['| riga | voce nel foglio | data | importo | conto | voce del catalogo | origine |', '|---|---|---|---|---|---|---|'];
    const used = new Set<PlanRow>();

    if (fresh) {
      for (const r of fresh.rows) {
        const kind = r.amount > 0 ? 'income' : 'expense';
        const planRow = bestMatch(r.name, plan.filter((p) => !used.has(p)), (p) => p.name);
        if (planRow) used.add(planRow.item);
        const fromPlan = planRow ? appAccount(planRow.item.account) : null;
        const item = itemFor(r.name, kind, fromPlan);
        let account = fromPlan ?? item?.item.account ?? null;
        let flag = '';
        if (!account) {
          account = config.defaultAccount ?? appAccounts[0]!;
          flag = ' ⚠ conto ipotizzato';
        }
        const origin = item ? 'catalog' : planRow ? 'sporadic' : 'past_movement';
        entries.push(entry(r, kind, account, dateOf(r.name, r.day, kind), item?.item.name ?? null, origin));
        table.push(
          `| ${r.row} | ${r.name} | ${entries.at(-1)!.date} | ${euros(r.amount)} | ${account}${flag} | ${item ? `${item.item.name} (${pct(item.score)})` : '—'} | ${origin}${planRow ? ` · conto da riga ${planRow.item.row} “${planRow.item.name}”` : ''} |`,
        );
      }
      const leftOut = plan.filter((p) => !used.has(p));
      if (leftOut.length) {
        lines.push('', 'Nel “Calcolo 10” ma non nel “new” (non importate: vale il “new”):');
        for (const p of leftOut) lines.push(`- riga ${p.row} “${p.name}” ${euros(p.amount)} su ${p.account}`);
      }
      // Cross-check of the running total.
      const sum = fresh.rows.reduce((t, r) => t + toCents(r.amount), 0);
      const lastRunning = [...fresh.rows].reverse().find((r) => r.running != null)?.running ?? null;
      if (fresh.start != null) {
        lines.push('', `Saldo iniziale del “new”: ${euros(fresh.start)}; movimenti ${eur(sum)}; fine ${eur(toCents(fresh.start) + sum)}.`);
        if (lastRunning != null && toCents(lastRunning) !== toCents(fresh.start) + sum)
          lines.push(`- ⚠ l’ultima riga del “new” dice ${euros(lastRunning)}: le righe non tornano col saldo progressivo.`);
      }
    } else {
      for (const p of plan) {
        const account = appAccount(p.account);
        const item = itemFor(p.name, 'expense', account);
        const r: FreshRow = { row: p.row, name: p.name, day: p.day, amount: -Math.abs(p.amount), running: null };
        entries.push(entry(r, 'expense', account, dateOf(p.name, p.day), item?.item.name ?? null, item ? 'catalog' : 'sporadic'));
        table.push(`| ${p.row} | ${p.name} | ${entries.at(-1)!.date} | ${euros(-Math.abs(p.amount))} | ${account} | ${item ? `${item.item.name} (${pct(item.score)})` : '—'} | ${item ? 'catalog' : 'sporadic'} |`);
      }
      notes.push('Senza “Calcolo new”: le entrate del ciclo non sono nel foglio.');
      lines.push('- ⚠ manca il “Calcolo new”: importo solo le uscite del “Calcolo 10”, le entrate non ci sono.');
    }
    for (const e of entries.filter((e) => e.amountCents === 0)) lines.push(`- ⚠ “${e.name}” ha importo zero.`);

    // Balances.
    const balances: HistoryCycle['balances'] = [];
    const known = config.knownBalances?.[s.month] ?? {};
    for (const a of appAccounts) {
      let euro: number | null = null;
      let from = '';
      const k = Object.entries(known).find(([name]) => normalize(appAccount(name)) === normalize(a));
      if (k) [euro, from] = [k[1], 'configurazione'];
      else if (summary) {
        const i = summary.accounts.findIndex((n) => normalize(appAccount(n)) === normalize(a));
        if (i >= 0 && summary.balances[i] != null) [euro, from] = [summary.balances[i]!, '“Saldo Attuale”'];
      }
      if (euro == null) {
        notes.push(`Saldo di ${a} non nel foglio: messo a 0.`);
        lines.push(`- ⚠ saldo di ${a}: non trovato, messo a 0,00.`);
        euro = 0;
      } else lines.push(`- saldo di ${a}: ${euros(euro)} (${from})`);
      balances.push({ account: a, amountCents: toCents(euro), asOf: plannedOn });
    }
    if (fresh?.start != null) {
      const tot = balances.reduce((t, b) => t + b.amountCents, 0);
      if (tot !== toCents(fresh.start)) lines.push(`- nota: i saldi sommano ${eur(tot)}, il “new” parte da ${euros(fresh.start)} (differenza ${eur(tot - toCents(fresh.start))}).`);
    }

    // Transfers already made ("Bon. Effett."): + to an account, − from one.
    const transfers: HistoryCycle['transfers'] = [];
    if (summary) {
      const moves = summary.accounts.map((n, i) => ({ account: appAccount(n), euro: summary.transfers[i] ?? 0 })).filter((m) => m.euro !== 0);
      const sources = moves.filter((m) => m.euro < 0);
      const source = sources.length === 1 ? sources[0]!.account : config.transferSource;
      for (const m of moves.filter((m) => m.euro > 0)) {
        if (!source || source === m.account) {
          lines.push(`- ⚠ bonifico di ${euros(m.euro)} verso ${m.account}: non so da quale conto (imposta transferSource).`);
          continue;
        }
        transfers.push({ from: source, to: m.account, amountCents: toCents(m.euro), date: plannedOn, dueDate: plannedOn, doneOn: plannedOn });
        lines.push(`- bonifico fatto: ${source} → ${m.account} ${euros(m.euro)}${sources.length === 1 ? '' : ' (fonte dalla configurazione)'}`);
      }
    }

    const inc = entries.filter((e) => e.kind === 'income').reduce((t, e) => t + (e.amountCents ?? 0), 0);
    const out = entries.filter((e) => e.kind === 'expense').reduce((t, e) => t + (e.amountCents ?? 0), 0);
    const start = balances.reduce((t, b) => t + b.amountCents, 0);
    lines.push('', `Entrate ${eur(inc)} · uscite ${eur(-out)} · saldi ${eur(start)} → in tutto a fine ciclo ${eur(start + inc - out)}.`, '');
    report.push(...lines, '', ...table, '');

    cycles.push({
      month: s.month,
      plannedOn,
      endsOn,
      status: drafts.includes(s.month) ? 'draft' : 'confirmed',
      notes: [`Dal vecchio Excel: ${[s.plan, s.fresh].filter(Boolean).join(' + ')}.`, ...notes].join(' '),
      balances,
      entries,
      transfers,
    });
  }

  // ---- calendar and debts ----
  const calendarEvents: HistoryImport['calendarEvents'] = [];
  const debts: HistoryImport['debts'] = [];
  const skip = (config.calendarSkip ?? []).map((p) => new RegExp(p, 'i'));
  if (book.sheetNames.includes('Scadenze')) {
    report.push('## Scadenze', '');
    for (const d of parseDeadlines(book.grid('Scadenze'))) {
      const item = bestMatch(d.title, catalog.items, (i) => i.name, 0.8);
      if (skip.some((r) => r.test(d.title)) || item) {
        report.push(`- saltata: ${d.day ?? '?'}/${d.month} “${d.title}”${item ? ` (è nel catalogo: ${item.item.name})` : ''}`);
        continue;
      }
      const type = /compl/i.test(d.title) ? 'birthday' : /anniv/i.test(d.title) ? 'anniversary' : 'other';
      calendarEvents.push({ type, title: d.title, month: d.month, day: d.day });
      report.push(`- ${type}: ${d.day ?? '?'}/${d.month} “${d.title}”`);
    }
    report.push('');
  } else report.push('- ⚠ foglio “Scadenze” non trovato.');
  if (book.sheetNames.includes('Debiti')) {
    report.push('## Debiti', '');
    for (const d of parseDebts(book.grid('Debiti'))) {
      debts.push({ date: d.date, description: d.description, amountCents: toCents(d.amount) });
      report.push(`- riga ${d.row}: ${d.date} “${d.description}” ${euros(d.amount)}`);
    }
    report.push(`- totale: ${eur(debts.reduce((t, d) => t + d.amountCents, 0))}`, '');
  } else report.push('- ⚠ foglio “Debiti” non trovato.');

  if (accountProblems.size) {
    report.splice(2, 0, `**⚠ Conti del foglio che non trovo nel catalogo: ${[...accountProblems].join(', ')}.** Aggiungili ad accountAliases nella configurazione, altrimenti l’app rifiuterà il file.`, '');
  }

  const history = historyImportSchema.parse({ source: 'vecchio Excel', cycles, debts, calendarEvents });
  return { history, report: report.join('\n') };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function entry(r: FreshRow, kind: 'income' | 'expense', account: string, date: ISODate, item: string | null, origin: HistoryEntry['origin']): HistoryEntry {
  return {
    name: r.name.replace(/\s+/g, ' ').trim(),
    kind,
    account,
    date,
    amountCents: Math.abs(toCents(r.amount)),
    state: 'pending',
    origin,
    item,
  };
}
