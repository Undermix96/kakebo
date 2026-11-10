import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { catalogImportSchema, toEpochDay } from '@kakebo/core';
import example from '../../../packages/db/fixtures/catalog.example.json' with { type: 'json' };
import { buildHistory } from './build.ts';
import { bestMatch, normalize, similarity } from './match.ts';
import { excelDate, findCycleSheets } from './parse.ts';
import { readWorkbook } from './workbook.ts';

const catalog = catalogImportSchema.parse(example);
const serial = (iso: string) => toEpochDay(iso) + 25569;

/** A small workbook with the same layout as the old spreadsheet, invented data. */
function workbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const plan = [
    ['Fisse', 'Giorno', 'Importo', 'Conto', '', '', 'Banca Blu', 'Viola new', 'Carta Spesa'],
    ['Affitto', 30, 650, 'Banca Blu', '', 'conto'],
    ['Rata finanziamento', 20, 300, 'Viola new', '', 'Target', 1080, 300, 450],
    ['Spesa (500€)', 11, 450, 'Carta Spesa', '', 'Saldo Attuale', 100, 400, 0],
    ['Carta di credito', 3, null, 'Banca Blu', 400, 'Delta', -980, 100, -450],
    ['Pizzeria', 15, 30.000000000000004, 'Banca Blu', '', 'Bon. Effett.', null, -450, 450],
    [],
    [],
    ['Stipendio totale', 1200],
  ];
  // Summary labels are in column F, accounts in G–I; the header is the first row.
  plan[1]![5] = '';
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plan), 'Calcolo 10 Ott. 26');
  const fresh = [
    ['Saldo iniziale', null, null, 500],
    ['Stipendio A.', 9, 1200, 1700],
    ['Rata finanziamento', 20, -300, 1400],
    ['Spesa', 11, -450, 950],
    ['Affitto', 30, -650, 300],
    ['Carta di credito', 3, -400, -100],
    ['Macelleria', 12, -25, -125],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fresh), 'Calcolo new 10 Ott. 26');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fisse'], ['Affitto', 30, 650, 'Banca Blu']]), 'Calcolo 10 Sett. 26');
  const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const deadlines: (string | null)[][] = [months, months.map(() => null), months.map(() => null)];
  deadlines[1]![2] = '9) Compleanno di Z.';
  deadlines[1]![4] = 'Bollo auto';
  deadlines[1]![11] = 'Natale';
  deadlines[2]![4] = '20) Vecchio fornitore';
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deadlines), 'Scadenze');
  const debts = [
    [serial('2026-04-14'), 'Gita', 187.5, null, null, null, null, 12.34],
    [null, 'Totale', 187.5],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(debts), 'Debiti');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['vecchio kakebo']]), 'Novembre');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('matching', () => {
  it('normalizes and compares descriptions', () => {
    expect(normalize('Energia (Luce)')).toBe('energia luce');
    expect(similarity('Spesa (500€)', 'Spesa')).toBeGreaterThan(0.75);
    expect(similarity('Ass. Vita Prestito Viol.', 'Assicurazione Vita Prestito Viola')).toBeGreaterThan(0.75);
    expect(similarity('Affitto', 'Rata finanziamento')).toBe(0);
    expect(bestMatch('Stipendio A', catalog.items, (i) => i.name)?.item.name).toBe('Stipendio A.');
  });

  it('finds the cycle sheets and reads Excel dates', () => {
    expect(findCycleSheets(['Calcolo 10 Sett. 26', 'Calcolo new 10 Nov. 26', 'Calcolo 10 Nov. 26', 'Calcolatore X', 'Novembre'])).toEqual([
      { month: '2026-09', plan: 'Calcolo 10 Sett. 26' },
      { month: '2026-11', plan: 'Calcolo 10 Nov. 26', fresh: 'Calcolo new 10 Nov. 26' },
    ]);
    expect(excelDate(serial('2026-08-19'))).toBe('2026-08-19');
    expect(excelDate('19/08/2026')).toBe('2026-08-19');
  });
});

describe('buildHistory', () => {
  const book = readWorkbook(workbook());
  const { history, report } = buildHistory(book, catalog, {
    accountAliases: { 'Viola new': 'Banca Viola' },
    defaultAccount: 'Conto Giorno',
    knownBalances: { '2026-09': { 'Banca Blu': 35 } },
    calendarSkip: ['fornitore'],
  });
  const oct = history.cycles.find((c) => c.month === '2026-10')!;

  it('merges the two sheets of a month: amounts and dates from "new", accounts from "Calcolo 10"', () => {
    expect(history.cycles.map((c) => [c.month, c.status])).toEqual([
      ['2026-09', 'confirmed'],
      ['2026-10', 'draft'],
    ]);
    const byName = Object.fromEntries(oct.entries.map((e) => [e.name, e]));
    expect(byName['Stipendio A.']).toMatchObject({ kind: 'income', account: 'Banca Viola', date: '2026-10-09', amountCents: 120000, origin: 'catalog' });
    expect(byName['Rata finanziamento']).toMatchObject({ account: 'Banca Viola', amountCents: 30000, item: 'Rata finanziamento' });
    expect(byName['Carta di credito']).toMatchObject({ account: 'Banca Blu', date: '2026-11-03', amountCents: 40000 });
    expect(byName['Macelleria']).toMatchObject({ account: 'Conto Giorno', origin: 'past_movement', item: null });
  });

  it('takes balances and transfers made from the summary', () => {
    const bal = Object.fromEntries(oct.balances.map((b) => [b.account, b.amountCents]));
    expect(bal).toEqual({ 'Banca Blu': 10000, 'Banca Viola': 40000, 'Conto Giorno': 0, 'Carta Spesa': 0 });
    expect(oct.transfers).toEqual([
      { from: 'Banca Viola', to: 'Carta Spesa', amountCents: 45000, date: '2026-10-10', dueDate: '2026-10-10', doneOn: '2026-10-10' },
    ]);
    const sep = history.cycles.find((c) => c.month === '2026-09')!;
    expect(sep.balances.find((b) => b.account === 'Banca Blu')?.amountCents).toBe(3500);
    expect(sep.entries.map((e) => e.name)).toEqual(['Affitto']);
  });

  it('reports what does not match, without inventing anything', () => {
    expect(report).toMatch(/riga 5 “Carta di credito”: importo in colonna E/);
    expect(report).toMatch(/Pizzeria/); // in "Calcolo 10" only
    expect(report).toMatch(/saldo di Conto Giorno: non trovato/);
    expect(report).toMatch(/manca il “Calcolo new”/);
    expect(report).not.toMatch(/Conti del foglio che non trovo/);
  });

  it('reads dates and debts, skipping catalog items and old entries', () => {
    expect(history.calendarEvents).toEqual([
      { type: 'birthday', title: 'Compleanno di Z.', month: 3, day: 9 },
      { type: 'other', title: 'Natale', month: 12, day: null },
    ]);
    expect(report).toMatch(/saltata: \?\/5 “Bollo auto” \(è nel catalogo/);
    expect(history.debts).toEqual([{ date: '2026-04-14', description: 'Gita', amountCents: 18750 }]);
  });

  it('flags spreadsheet accounts it cannot map', () => {
    const { report: r } = buildHistory(book, catalog, { months: ['2026-10'] });
    expect(r).toMatch(/Conti del foglio che non trovo nel catalogo: Viola new/);
  });
});
