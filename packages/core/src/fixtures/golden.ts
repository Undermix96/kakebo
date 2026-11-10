import type { Cents } from '../money.ts';
import type { ISODate, YearMonth } from '../dates.ts';
import type { Account, Balance, CycleEntry, Id, RecurringItem } from '../types.ts';

/**
 * A "golden" cycle: catalog + balances + expected results. The real one (with the
 * family's data) lives in `private/fixtures/` and is never committed; the one below
 * has the same shape with invented names and amounts.
 */
export interface GoldenFixture {
  name: string;
  month: YearMonth;
  plannedOn: ISODate;
  accounts: Account[];
  catalog: RecurringItem[];
  sporadic: CycleEntry[];
  balances: Balance[];
  expected: {
    /** The cycle's entries, in date order: [date, name, accountId, signed cents]. */
    entries: [ISODate, string, Id, Cents][];
    /** Catalog items generated without an amount. */
    missingAmounts: Id[];
    withoutTransfers: Record<Id, { endCents: Cents; minDate?: ISODate; firstBelowMargin?: ISODate | null }>;
    totalEndCents: Cents;
    maxTransfers: number;
    /** Exact transfers, when the fixture pins them: [from, to, cents]. */
    transfers?: [Id, Id, Cents][];
  };
}

const acc = (id: Id, name: string, sort: number, receivesLeftover = false): Account => ({
  id,
  name,
  sort,
  marginCents: 0,
  receivesLeftover,
});

const item = (
  id: Id,
  kind: 'income' | 'expense',
  name: string,
  accountId: Id,
  day: number | null,
  amountCents: Cents | null,
  extra: Partial<RecurringItem> = {},
): RecurringItem => ({
  id,
  kind,
  name,
  accountId,
  day,
  schedule: { type: 'monthly' },
  amountMode: 'fixed',
  amountCents,
  ...extra,
});

/** Invented data, same structure as the real November 2026 cycle. */
export const exampleCycle: GoldenFixture = {
  name: 'example (invented data)',
  month: '2026-11',
  plannedOn: '2026-11-09',
  accounts: [acc('verde', 'Conto Verde', 1), acc('blu', 'Conto Blu', 2), acc('arancio', 'Conto Arancio', 3, true), acc('viola', 'Conto Viola', 4)],
  catalog: [
    item('stip-a', 'income', 'Stipendio A', 'blu', 9, 105000, { amountMode: 'last' }),
    item('stip-b', 'income', 'Stipendio B', 'arancio', 13, 140000),
    item('assegno', 'income', 'Assegno', 'blu', 20, 30000),
    item('ass-prestito', 'expense', 'Assicurazione prestito', 'blu', 10, 4000),
    item('spesa', 'expense', 'Spesa', 'viola', 11, 65000, { amountMode: 'last' }),
    item('carta-rate', 'expense', 'Carta rateale', 'verde', 15, 8000),
    item('prestito', 'expense', 'Prestito', 'blu', 20, 50000),
    item('asilo', 'expense', 'Asilo', 'verde', 22, 20000, { amountMode: 'last' }),
    item('auto', 'expense', 'Assicurazione auto', 'verde', 27, 10000),
    item('mutuo', 'expense', 'Mutuo', 'verde', 30, 30000),
    item('costo-conto', 'expense', 'Costo conto', 'blu', 31, 250, { amountMode: 'last' }),
    item('carta-credito', 'expense', 'Carta di credito', 'verde', 3, 55000, {
      amountMode: 'last',
      note: '+ interessi',
    }),
    item('luce', 'expense', 'Luce', 'verde', 6, 9000, { amountMode: 'last' }),
    item('gas', 'expense', 'Gas', 'verde', 6, 11000, { amountMode: 'last' }),
    item('bollo', 'expense', 'Bollo', 'verde', null, 20000, { schedule: { type: 'yearly', month: 5 } }),
    item('pedaggi', 'expense', 'Pedaggi', 'verde', 30, null, {
      amountMode: 'last',
      schedule: { type: 'months', months: [2, 5, 8, 11] },
    }),
    item('vecchia-carta', 'expense', 'Vecchia carta', 'verde', 18, 1000, { archived: true }),
  ],
  sporadic: [
    {
      id: 'visita',
      name: 'Visita',
      kind: 'expense',
      accountId: 'verde',
      date: '2026-11-22',
      amountCents: 25000,
      state: 'pending',
      origin: 'sporadic',
    },
  ],
  balances: [
    { accountId: 'verde', amountCents: 18000, asOf: '2026-11-09' },
    { accountId: 'viola', amountCents: 4000, asOf: '2026-11-09' },
    { accountId: 'blu', amountCents: 0, asOf: '2026-11-09' },
    { accountId: 'arancio', amountCents: 0, asOf: '2026-11-09' },
  ],
  expected: {
    entries: [
      ['2026-11-09', 'Stipendio A', 'blu', 105000],
      ['2026-11-10', 'Assicurazione prestito', 'blu', -4000],
      ['2026-11-11', 'Spesa', 'viola', -65000],
      ['2026-11-13', 'Stipendio B', 'arancio', 140000],
      ['2026-11-15', 'Carta rateale', 'verde', -8000],
      ['2026-11-20', 'Assegno', 'blu', 30000],
      ['2026-11-20', 'Prestito', 'blu', -50000],
      ['2026-11-22', 'Asilo', 'verde', -20000],
      ['2026-11-22', 'Visita', 'verde', -25000],
      ['2026-11-27', 'Assicurazione auto', 'verde', -10000],
      ['2026-11-30', 'Mutuo', 'verde', -30000],
      ['2026-11-30', 'Costo conto', 'blu', -250],
      ['2026-12-03', 'Carta di credito', 'verde', -55000],
      ['2026-12-06', 'Luce', 'verde', -9000],
      ['2026-12-06', 'Gas', 'verde', -11000],
      ['2026-12-10', 'Assicurazione prestito', 'blu', -4000],
    ],
    missingAmounts: ['pedaggi'],
    withoutTransfers: {
      blu: { endCents: 76750, minDate: '2026-12-10', firstBelowMargin: null },
      verde: { endCents: -150000, minDate: '2026-12-06', firstBelowMargin: '2026-11-22' },
      viola: { endCents: -61000, minDate: '2026-11-11', firstBelowMargin: '2026-11-11' },
      arancio: { endCents: 140000, firstBelowMargin: null },
    },
    totalEndCents: 5750,
    maxTransfers: 3,
    transfers: [
      ['blu', 'viola', 61000],
      ['blu', 'verde', 10000],
      ['arancio', 'verde', 140000],
    ],
  },
};
