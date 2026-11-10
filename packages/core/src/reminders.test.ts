import { describe, expect, it } from 'vitest';
import type { CatalogItem } from './catalog.ts';
import type { CalendarEvent, Debt } from './cycle-record.ts';
import {
  calendarEventCreateSchema,
  calendarEventPatchSchema,
  debtCreateSchema,
  monthCalendar,
  openDebts,
  yearCalendar,
  type CalendarCycle,
} from './reminders.ts';

const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name'>): CatalogItem => ({
  kind: 'expense',
  accountId: 'blu',
  day: 5,
  schedule: { type: 'monthly' },
  amountMode: 'fixed',
  amountCents: 1000,
  note: null,
  category: null,
  activeFrom: null,
  activeTo: null,
  archived: false,
  ...over,
});

const items: CatalogItem[] = [
  item({ id: 'affitto', name: 'Affitto', day: 30, amountCents: 65000 }),
  item({ id: 'paga', name: 'Stipendio', kind: 'income', day: 13, amountCents: 150000 }),
  item({ id: 'bollo', name: 'Bollo auto', day: null, schedule: { type: 'yearly', month: 5 }, amountCents: 30000 }),
  item({ id: 'rifiuti', name: 'Rifiuti', day: 16, schedule: { type: 'months', months: [6, 12] }, amountCents: null }),
  item({ id: 'vecchia', name: 'Palestra', day: 3, archived: true }),
  item({ id: 'finita', name: 'Rata divano', day: 8, activeTo: '2026-03-31' }),
];

const events: CalendarEvent[] = [
  { id: 'e1', type: 'birthday', title: 'Compleanno Zia', month: 2, day: 29, note: null },
  { id: 'e2', type: 'other', title: 'Natale', month: 12, day: 25, note: null },
  { id: 'e3', type: 'birthday', title: 'Compleanno Nonno', month: 5, day: null, note: null },
  { id: 'e4', type: 'anniversary', title: 'Anniversario', month: 5, day: 12, note: null },
  { id: 'e5', type: 'birthday', title: 'Compleanno Leo', month: 5, day: 20, note: null },
];

const debts: Debt[] = [
  { id: 'd1', date: '2026-05-26', description: 'Mensa', amountCents: 20000, paidOn: null, note: null },
  { id: 'd2', date: '2026-05-02', description: 'Luce scale', amountCents: 5000, paidOn: '2026-06-01', note: null },
  { id: 'd3', date: '2026-01-10', description: 'Dentista', amountCents: 9000, paidOn: null, note: null },
];

const src = { items, events, debts };

describe('monthCalendar', () => {
  it('puts the catalog on its days and the undated items in the month', () => {
    const may = monthCalendar('2026-05', src);
    const names = may.map((i) => `${i.date ?? '—'} ${i.type} ${i.name}`);
    expect(names).toEqual([
      '— event Compleanno Nonno',
      '— deadline Bollo auto',
      '2026-05-12 event Anniversario',
      '2026-05-13 income Stipendio',
      '2026-05-20 event Compleanno Leo',
      '2026-05-26 debt Mensa',
      '2026-05-30 expense Affitto',
    ]);
    expect(may.find((i) => i.name === 'Bollo auto')).toMatchObject({ date: null, type: 'deadline', amountCents: 30000 });
    expect(may.find((i) => i.name === 'Affitto')).toMatchObject({ date: '2026-05-30', type: 'expense' });
    expect(may.find((i) => i.name === 'Stipendio')).toMatchObject({ date: '2026-05-13', type: 'income' });
    // Archived and ended items are not there.
    expect(may.some((i) => i.name === 'Palestra' || i.name === 'Rata divano')).toBe(false);
    // Only open debts.
    expect(may.filter((i) => i.type === 'debt').map((i) => i.name)).toEqual(['Mensa']);
  });

  it('clamps days to the month and keeps unknown amounts null', () => {
    const feb = monthCalendar('2027-02', src);
    expect(feb.find((i) => i.name === 'Affitto')!.date).toBe('2027-02-28');
    expect(feb.find((i) => i.name === 'Compleanno Zia')!.date).toBe('2027-02-28');
    expect(monthCalendar('2028-02', src).find((i) => i.name === 'Compleanno Zia')!.date).toBe('2028-02-29');
    expect(monthCalendar('2026-06', src).find((i) => i.name === 'Rifiuti')).toMatchObject({ amountCents: null, type: 'deadline' });
  });

  it('uses the real entries and transfers of a confirmed cycle on the days it owns', () => {
    const cycle: CalendarCycle = {
      month: '2026-05',
      plannedOn: '2026-05-09',
      endsOn: '2026-06-10',
      status: 'confirmed',
      entries: [
        { id: 'affitto@2026-05-30', recurringItemId: 'affitto', name: 'Affitto', kind: 'expense', accountId: 'blu', date: '2026-05-30', amountCents: 66000, state: 'pending', origin: 'catalog' },
        { id: 'bollo@2026-05-01', recurringItemId: 'bollo', name: 'Bollo auto', kind: 'expense', accountId: 'blu', date: '2026-05-01', amountCents: 31000, state: 'pending', origin: 'catalog' },
        { id: 's1', name: 'Idraulico', kind: 'expense', accountId: 'blu', date: '2026-05-22', amountCents: 12000, state: 'pending', origin: 'sporadic' },
        { id: 's2', name: 'Annullata', kind: 'expense', accountId: 'blu', date: '2026-05-23', amountCents: 100, state: 'excluded', origin: 'sporadic' },
      ],
      transfers: [
        { id: 't1', fromAccountId: 'rosso', toAccountId: 'blu', amountCents: 50000, date: '2026-05-10', dueDate: '2026-05-21', doneOn: null, coversEntryIds: [] },
      ],
    };
    const may = monthCalendar('2026-05', { ...src, cycles: [cycle] });
    // The cycle's amount wins over the catalog, without duplicates.
    expect(may.filter((i) => i.name === 'Affitto')).toEqual([expect.objectContaining({ amountCents: 66000, fromCycle: true })]);
    // The undated deadline is now dated (as the engine placed it) and not repeated in the month slot.
    expect(may.filter((i) => i.name === 'Bollo auto')).toEqual([expect.objectContaining({ date: '2026-05-01', type: 'deadline' })]);
    expect(may.find((i) => i.name === 'Idraulico')).toMatchObject({ type: 'expense', amountCents: 12000 });
    expect(may.some((i) => i.name === 'Annullata')).toBe(false);
    expect(may.find((i) => i.type === 'transfer')).toMatchObject({ date: '2026-05-21', done: false, accountId: 'rosso', toAccountId: 'blu' });
    // Drafts are ignored.
    const draft = monthCalendar('2026-05', { ...src, cycles: [{ ...cycle, status: 'draft' }] });
    expect(draft.find((i) => i.name === 'Affitto')).toMatchObject({ amountCents: 65000 });
    expect(draft.find((i) => i.name === 'Affitto')!.fromCycle).toBeUndefined();
  });
});

describe('yearCalendar', () => {
  it('flags heavy months', () => {
    const year = yearCalendar(2026, src);
    expect(year).toHaveLength(12);
    const may = year[4]!;
    expect(may).toMatchObject({ month: '2026-05', deadlinesCents: 30000, events: 3, openDebts: 1, heavy: true });
    const june = year[5]!;
    expect(june).toMatchObject({ deadlinesCents: 0, deadlinesWithoutAmount: ['Rifiuti'], heavy: false });
    expect(year[2]!.heavy).toBe(false);
  });
});

describe('schemas', () => {
  it('rejects days that do not exist', () => {
    expect(calendarEventCreateSchema.safeParse({ type: 'birthday', title: 'A', month: 4, day: 31 }).success).toBe(false);
    expect(calendarEventCreateSchema.safeParse({ type: 'birthday', title: 'A', month: 2, day: 29 }).success).toBe(true);
    expect(calendarEventCreateSchema.safeParse({ type: 'other', title: ' ', month: 2, day: null }).success).toBe(false);
    expect(calendarEventPatchSchema.safeParse({ day: 31, month: 6 }).success).toBe(false);
    expect(calendarEventPatchSchema.safeParse({ day: 31 }).success).toBe(true); // checked against the stored month
  });

  it('wants an amount for a debt', () => {
    expect(debtCreateSchema.safeParse({ date: '2026-05-01', description: 'Mensa', amountCents: 0 }).success).toBe(false);
    expect(debtCreateSchema.safeParse({ date: '2026-05-01', description: 'Mensa', amountCents: 1 }).success).toBe(true);
  });

  it('lists open debts, oldest first', () => {
    expect(openDebts(debts).map((d) => d.id)).toEqual(['d3', 'd1']);
  });
});
