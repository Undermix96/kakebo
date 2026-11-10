import { formatYearMonth, fromEpochDay, isISODate, type ISODate, type YearMonth } from '@kakebo/core';

/**
 * Readers for the sheets of the old spreadsheet. They work on a plain grid of
 * computed values (row 0 = Excel row 1, column 0 = A), never on formulas, so they
 * can be tested without a workbook. Layouts are those described in the project
 * notes; where a sheet might differ, cells are found by their labels.
 */

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

const at = (g: Grid, r: number, c: number): Cell => g[r]?.[c] ?? null;
const text = (v: Cell) => (typeof v === 'string' ? v.trim() : '');
const num = (v: Cell): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
};

/** Euros (possibly with float noise like 12.300000000000001) → integer cents. */
export const toCents = (euros: number) => Math.round(euros * 100);

// ---------- sheet names ----------

const MONTH_ABBR: Record<string, number> = {
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, sett: 9, ott: 10, nov: 11, dic: 12,
};
export const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export interface CycleSheets {
  month: YearMonth;
  /** "Calcolo 10 …": entries with their account, summary per account. */
  plan?: string;
  /** "Calcolo new …": dated, signed movements with a running total. */
  fresh?: string;
}

/** "Calcolo 10 Nov. 26" / "Calcolo new 10 Ott. 26" → cycles by month. */
export function findCycleSheets(names: string[]): CycleSheets[] {
  const byMonth = new Map<YearMonth, CycleSheets>();
  for (const name of names) {
    const m = /^calcolo\s+(new\s+)?10\s+([a-z]+)\.?\s*(\d{2})$/i.exec(name.trim());
    if (!m) continue;
    const month = MONTH_ABBR[m[2]!.toLowerCase()];
    if (!month) continue;
    const ym = formatYearMonth(2000 + Number(m[3]), month);
    const entry = byMonth.get(ym) ?? { month: ym };
    if (m[1]) entry.fresh = name;
    else entry.plan = name;
    byMonth.set(ym, entry);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

// ---------- "Calcolo 10 …" ----------

export interface PlanRow {
  /** Excel row number (1-based), for the report. */
  row: number;
  name: string;
  day: number | null;
  /** Euros as written (expenses are positive). */
  amount: number;
  account: string;
  /** The amount was in column E instead of C. */
  misplaced: boolean;
}

/**
 * Entries of a "Calcolo 10" sheet: description (A), day (B), amount (C), account (D).
 * Any row with a description, an account and an amount counts, whatever the
 * section (fixed, variable, sporadic): the sections moved between months.
 */
export function parsePlanSheet(g: Grid, maxRows = 60): PlanRow[] {
  const out: PlanRow[] = [];
  for (let r = 1; r < Math.min(g.length, maxRows); r++) {
    const name = text(at(g, r, 0));
    const account = text(at(g, r, 3));
    if (!name || !account) continue;
    let amount = num(at(g, r, 2));
    let misplaced = false;
    if (amount == null) {
      amount = num(at(g, r, 4));
      misplaced = amount != null;
    }
    if (amount == null) continue;
    const d = num(at(g, r, 1));
    out.push({ row: r + 1, name, day: d != null && d >= 1 && d <= 31 ? Math.trunc(d) : null, amount, account, misplaced });
  }
  return out;
}

export interface PlanSummary {
  /** Account names as written in the header of the summary. */
  accounts: string[];
  /** "Saldo Attuale" per account (euros), null where empty. */
  balances: (number | null)[];
  /** "Bon. Effett." per account (euros), null where empty. */
  transfers: (number | null)[];
}

/** The per-account summary (around F1:H7): found by its labels, not by fixed cells. */
export function parseSummary(g: Grid): PlanSummary | null {
  let balRow = -1;
  let labelCol = -1;
  for (let r = 0; r < Math.min(g.length, 60) && balRow < 0; r++) {
    for (let c = 0; c < (g[r]?.length ?? 0); c++) {
      if (/saldo\s*attuale/i.test(text(at(g, r, c)))) [balRow, labelCol] = [r, c];
    }
  }
  if (balRow < 0) return null;
  // The header is the nearest row above with account names to the right of the labels.
  let headRow = -1;
  for (let r = balRow - 1; r >= 0 && headRow < 0; r--) {
    const names = [1, 2, 3, 4].map((k) => text(at(g, r, labelCol + k))).filter(Boolean);
    if (names.length >= 2 && names.every((n) => num(n) == null)) headRow = r;
  }
  if (headRow < 0) return null;
  const cols: number[] = [];
  for (let c = labelCol + 1; c < labelCol + 8; c++) if (text(at(g, headRow, c))) cols.push(c);
  let trRow = -1;
  for (let r = balRow + 1; r < balRow + 6; r++) if (/bon/i.test(text(at(g, r, labelCol)))) trRow = r;
  return {
    accounts: cols.map((c) => text(at(g, headRow, c))),
    balances: cols.map((c) => num(at(g, balRow, c))),
    transfers: cols.map((c) => (trRow < 0 ? null : num(at(g, trRow, c)))),
  };
}

// ---------- "Calcolo new …" ----------

export interface FreshRow {
  row: number;
  name: string;
  day: number | null;
  /** Signed euros: incomes +, expenses −. */
  amount: number;
  /** Running total written in column D, if any. */
  running: number | null;
}

export interface FreshSheet {
  /** Opening balance of all the accounts together (row 1). */
  start: number | null;
  rows: FreshRow[];
}

export function parseFreshSheet(g: Grid, maxRows = 80): FreshSheet {
  const first = g[0] ?? [];
  const start = num(at(g, 0, 3)) ?? num(at(g, 0, 2)) ?? num(at(g, 0, 1)) ?? (first.map(num).find((v) => v != null) ?? null);
  const rows: FreshRow[] = [];
  for (let r = 1; r < Math.min(g.length, maxRows); r++) {
    const name = text(at(g, r, 0));
    const amount = num(at(g, r, 2));
    if (!name || amount == null || amount === 0) continue;
    if (/^(totale|saldo)\b/i.test(name)) continue;
    const d = num(at(g, r, 1));
    rows.push({ row: r + 1, name, day: d != null && d >= 1 && d <= 31 ? Math.trunc(d) : null, amount, running: num(at(g, r, 3)) });
  }
  return { start, rows };
}

// ---------- "Scadenze" ----------

export interface Deadline {
  month: number;
  day: number | null;
  title: string;
}

/** A row with the month names as header; below each, "9) Compleanno X" or just a title. */
export function parseDeadlines(g: Grid): Deadline[] {
  let headRow = -1;
  const colMonth = new Map<number, number>();
  for (let r = 0; r < Math.min(g.length, 20) && headRow < 0; r++) {
    const found = new Map<number, number>();
    (g[r] ?? []).forEach((v, c) => {
      const i = MONTH_NAMES.indexOf(text(v).toLowerCase());
      if (i >= 0) found.set(c, i + 1);
    });
    if (found.size >= 6) {
      headRow = r;
      found.forEach((m, c) => colMonth.set(c, m));
    }
  }
  if (headRow < 0) return [];
  const out: Deadline[] = [];
  for (let r = headRow + 1; r < g.length; r++) {
    for (const [c, month] of colMonth) {
      const t = text(at(g, r, c));
      if (!t || t === '—' || t === '-') continue;
      const m = /^(\d{1,2})\s*\)\s*(.+)$/.exec(t);
      const title = (m ? m[2]! : t).replace(/\s*[–-]\s*[\d.,]+\s*€?\s*$/, '').trim();
      out.push({ month, day: m ? Number(m[1]) : null, title });
    }
  }
  return out;
}

// ---------- "Debiti" ----------

export interface DebtRow {
  row: number;
  date: ISODate;
  description: string;
  amount: number;
}

/** Excel serial day → ISO date (1900 date system). */
export function excelDate(v: Cell): ISODate | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) return fromEpochDay(Math.trunc(v) - 25569);
  const s = text(v);
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const iso = `${it[3]}-${it[2]!.padStart(2, '0')}-${it[1]!.padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  return isISODate(s) ? s : null;
}

/** Rows with a date, a description and an amount in columns A–D (notes elsewhere are ignored). */
export function parseDebts(g: Grid): DebtRow[] {
  const out: DebtRow[] = [];
  for (let r = 0; r < g.length; r++) {
    const cells = [0, 1, 2, 3].map((c) => at(g, r, c));
    const date = cells.map(excelDate).find((d) => d != null) ?? null;
    const description = cells.map(text).find((t) => t && excelDate(t) == null && num(t) == null) ?? '';
    const amounts = cells.filter((v) => typeof v === 'number' && excelDate(v) == null) as number[];
    if (!date || !description || amounts.length === 0 || /totale/i.test(description)) continue;
    out.push({ row: r + 1, date, description, amount: amounts.at(-1)! });
  }
  return out;
}
