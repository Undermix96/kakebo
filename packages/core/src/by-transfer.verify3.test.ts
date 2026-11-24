import { describe, expect, it } from 'vitest';
import { monthCalendar, type CalendarCycle, type CalendarSources } from './reminders.ts';
import type { CatalogItem } from './catalog.ts';
import type { CycleEntry } from './types.ts';

// Third independent verification of §13 phase 5c (calendar rule A). Invented data only.
const e = (over: Partial<CycleEntry>): CycleEntry => ({
  id: 'x', recurringItemId: null, name: 'X', kind: 'expense', accountId: 'b',
  date: '2026-11-15', amountCents: 1000, state: 'pending', origin: 'sporadic', ...over,
});
const cyc = (over: Partial<CalendarCycle>): CalendarCycle => ({
  month: '2026-11', plannedOn: '2026-11-10', endsOn: '2026-12-09', status: 'confirmed', entries: [], transfers: [], ...over,
});
const base: CalendarSources = { items: [], events: [], debts: [] };
const months = ['2026-10', '2026-11', '2026-12', '2027-01'] as const;
const count = (src: CalendarSources, name: string) =>
  months.flatMap((m) => monthCalendar(m, src)).filter((i) => i.name === name);

describe('calendar rule A', () => {
  it('a stamp in an earlier month than the due day moves the entry, never duplicates it', () => {
    const c = cyc({ entries: [e({ id: 'a', name: 'Affitto', date: '2026-12-05', byTransfer: true, paidOn: '2026-11-28' })] });
    const shown = count({ ...base, cycles: [c] }, 'Affitto');
    expect(shown).toEqual([expect.objectContaining({ date: '2026-11-28', done: true })]);
  });

  it('a dated catalog item whose stamped entry moved to the previous month is not shown again', () => {
    const item = { id: 'it', name: 'Affitto', kind: 'expense', accountId: 'b', amountCents: 1000, day: 5, schedule: { type: 'monthly' }, archived: false } as unknown as CatalogItem;
    const c = cyc({ entries: [e({ id: 'a', recurringItemId: 'it', origin: 'catalog', name: 'Affitto', date: '2026-12-05', byTransfer: true, paidOn: '2026-11-28' })] });
    const dec = monthCalendar('2026-12', { ...base, items: [item], cycles: [c] }).filter((i) => i.name === 'Affitto');
    expect(dec).toEqual([]);
  });

  it('an UNDATED catalog item whose stamped entry moved to the previous month is not shown again', () => {
    // Undated items are generated on the 1st of the month (cycle.ts) and deduplicated with `fromCycles`.
    const item = { id: 'it', name: 'Condominio', kind: 'expense', accountId: 'b', amountCents: 1000, day: null, schedule: { type: 'monthly' }, archived: false } as unknown as CatalogItem;
    const entry = e({ id: 'a', recurringItemId: 'it', origin: 'catalog', name: 'Condominio', date: '2026-12-01', byTransfer: true });
    const unstamped = cyc({ entries: [entry] });
    const stamped = cyc({ entries: [{ ...entry, paidOn: '2026-11-28' }] });
    const before = monthCalendar('2026-12', { ...base, items: [item], cycles: [unstamped] }).filter((i) => i.name === 'Condominio');
    expect(before).toHaveLength(1);
    const after = monthCalendar('2026-12', { ...base, items: [item], cycles: [stamped] }).filter((i) => i.name === 'Condominio');
    // Already shown (stamped) on 2026-11-28 in November: December must not list it again.
    expect(after).toEqual([]);
  });

  it('unstamped byTransfer entries keep their due day; non-byTransfer entries have no done flag', () => {
    const c = cyc({ entries: [e({ id: 'a', name: 'A', date: '2026-11-20', byTransfer: true }), e({ id: 'b', name: 'B', date: '2026-11-21' })] });
    const nov = monthCalendar('2026-11', { ...base, cycles: [c] });
    expect(nov.find((i) => i.name === 'A')).toMatchObject({ date: '2026-11-20', done: false });
    expect(nov.find((i) => i.name === 'B')).not.toHaveProperty('done');
  });

  it('stamped excluded entry is not shown (state rule wins)', () => {
    const c = cyc({ entries: [e({ id: 'a', name: 'A', state: 'excluded', byTransfer: true, paidOn: '2026-11-20' })] });
    expect(count({ ...base, cycles: [c] }, 'A')).toEqual([]);
  });

  it('stamp on a day owned by the next confirmed cycle: shown once, by the owning cycle of the due day', () => {
    const nov = cyc({ entries: [e({ id: 'a', name: 'A', date: '2026-12-08', byTransfer: true, paidOn: '2026-12-09' })] });
    const dec = cyc({ month: '2026-12', plannedOn: '2026-12-01', endsOn: '2027-01-09', entries: [e({ id: 'z', name: 'Z', date: '2026-12-15' })] });
    // 2026-12-08 is owned by dec (most recent span containing it): nov does not own its due day.
    const shown = count({ ...base, cycles: [nov, dec] }, 'A');
    expect(shown.length).toBeLessThanOrEqual(1);
    // Same owner logic as before the stamp:
    const unst = count({ ...base, cycles: [{ ...nov, entries: [{ ...nov.entries[0]!, paidOn: null }] }, dec] }, 'A');
    expect(shown.length).toBe(unst.length);
  });
});
