import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  EVENT_DAY_MESSAGE,
  MONTHS_LONG,
  calendarEventCreateSchema,
  calendarEventPatchSchema,
  debtCreateSchema,
  debtPatchSchema,
  eventDayIsValid,
  type CalendarEventCreate,
  type CalendarEventPatch,
  type DebtCreate,
  type DebtPatch,
  cycleConfirmSchema,
  cycleDraftSchema,
  lastUsedAmounts,
  parseYearMonth,
  type CalendarEvent,
  type CycleConfirm,
  type CycleDraft,
  type CycleRecord,
  type Debt,
  type HistoryImport,
  type ISODate,
  type YearMonth,
} from '@kakebo/core';
import {
  accounts,
  calendarEvents,
  cycleBalances,
  cycleEntries,
  cycleTransfers,
  cycles,
  debts,
  recurringItems,
} from './schema.ts';
import type { Db } from './open.ts';
import { StoreError } from './catalog-store.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const nowIso = () => new Date().toISOString();
const monthName = (ym: YearMonth) => {
  const { year, month } = parseYearMonth(ym);
  return `${MONTHS_LONG[month - 1]} ${year}`;
};

/** Cycles (the monthly planning) and their transfers, plus the debts and the calendar dates. */
export class CycleStore {
  constructor(private readonly db: Db) {}

  // ---------- reading ----------

  private records(where?: ReturnType<typeof eq>): CycleRecord[] {
    const rows = this.db.select().from(cycles).where(where).orderBy(desc(cycles.month)).all();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const bal = this.db.select().from(cycleBalances).where(inArray(cycleBalances.cycleId, ids)).all();
    const ent = this.db
      .select()
      .from(cycleEntries)
      .where(inArray(cycleEntries.cycleId, ids))
      .orderBy(asc(cycleEntries.date), asc(cycleEntries.name))
      .all();
    const trf = this.db
      .select()
      .from(cycleTransfers)
      .where(inArray(cycleTransfers.cycleId, ids))
      .orderBy(asc(cycleTransfers.dueDate), asc(cycleTransfers.date))
      .all();
    return rows.map((r) => ({
      id: r.id,
      month: r.month,
      plannedOn: r.plannedOn,
      endsOn: r.endsOn,
      status: r.status,
      imported: r.imported,
      notes: r.notes,
      confirmedAt: r.confirmedAt,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
      balances: bal
        .filter((b) => b.cycleId === r.id)
        .map((b) => ({ accountId: b.accountId, amountCents: b.amountCents, asOf: b.asOf })),
      entries: ent
        .filter((e) => e.cycleId === r.id)
        .map((e) => ({
          id: e.id,
          recurringItemId: e.recurringItemId,
          name: e.name,
          kind: e.kind,
          accountId: e.accountId,
          date: e.date,
          amountCents: e.amountCents,
          state: e.state,
          origin: e.origin,
          plannedDate: e.plannedDate,
          envelopeEntryId: e.envelopeEntryId,
        })),
      transfers: trf
        .filter((t) => t.cycleId === r.id)
        .map((t) => ({
          id: t.id,
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          amountCents: t.amountCents,
          date: t.date || t.dueDate,
          dueDate: t.dueDate,
          doneOn: t.doneOn,
          coversEntryIds: t.coversEntryIds,
        })),
    }));
  }

  /** All cycles, the most recent first. */
  listCycles(): CycleRecord[] {
    return this.records();
  }

  getCycle(month: YearMonth): CycleRecord {
    const r = this.records(eq(cycles.month, month))[0];
    if (!r) throw new StoreError('not_found', `nessuna programmazione per ${monthName(month)}`);
    return r;
  }

  // ---------- planning ----------

  private assertAccounts(tx: Tx, ids: string[]) {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const found = tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, wanted)).all();
    if (found.length !== wanted.length) throw new StoreError('invalid', 'uno dei conti non esiste più: ricarica la pagina');
  }

  /**
   * Saves the draft of the four steps: replaces balances and entries. Stamped
   * transfers (of a reopened cycle) are kept. A confirmed cycle must be reopened first.
   */
  saveDraft(month: YearMonth, input: CycleDraft, by: string): CycleRecord {
    const d = cycleDraftSchema.parse(input);
    this.db.transaction((tx) => {
      this.assertAccounts(tx, [...d.balances.map((b) => b.accountId), ...d.entries.map((e) => e.accountId)]);
      const itemIds = [...new Set(d.entries.map((e) => e.recurringItemId).filter((x): x is string => !!x))];
      const found = itemIds.length
        ? tx.select({ id: recurringItems.id, envelope: recurringItems.envelope }).from(recurringItems).where(inArray(recurringItems.id, itemIds)).all()
        : [];
      if (found.length !== itemIds.length) throw new StoreError('invalid', 'una delle voci non è più nel catalogo: ricarica la pagina');
      // Expenses already made out of an envelope must point to an envelope of the catalog.
      const envelopes = new Set(found.filter((f) => f.envelope).map((f) => f.id));
      const entryById = new Map(d.entries.map((e) => [e.id, e]));
      for (const e of d.entries) {
        if (!e.envelopeEntryId) continue;
        const target = entryById.get(e.envelopeEntryId);
        if (!target?.recurringItemId || !envelopes.has(target.recurringItemId))
          throw new StoreError('invalid', `«${target?.name ?? e.name}» non è una busta del catalogo`);
      }

      let cycle = tx.select().from(cycles).where(eq(cycles.month, month)).get();
      if (cycle?.status === 'confirmed') {
        throw new StoreError('conflict', `${monthName(month)} è già confermato: riaprilo per cambiarlo`);
      }
      if (!cycle) {
        const id = randomUUID();
        tx.insert(cycles)
          .values({ id, month, plannedOn: d.plannedOn, endsOn: d.endsOn, notes: d.notes ?? null, createdBy: by, updatedBy: by })
          .run();
        cycle = tx.select().from(cycles).where(eq(cycles.id, id)).get()!;
      } else {
        tx.update(cycles)
          .set({ plannedOn: d.plannedOn, endsOn: d.endsOn, notes: d.notes ?? cycle.notes, updatedAt: nowIso(), updatedBy: by })
          .where(eq(cycles.id, cycle.id))
          .run();
      }
      const cycleId = cycle.id;
      tx.delete(cycleBalances).where(eq(cycleBalances.cycleId, cycleId)).run();
      tx.delete(cycleEntries).where(eq(cycleEntries.cycleId, cycleId)).run();
      for (const b of d.balances) tx.insert(cycleBalances).values({ cycleId, ...b, createdBy: by, updatedBy: by }).run();
      for (const e of d.entries) {
        tx.insert(cycleEntries)
          .values({ cycleId, ...e, recurringItemId: e.recurringItemId ?? null, plannedDate: e.plannedDate ?? null, envelopeEntryId: e.envelopeEntryId ?? null, createdBy: by, updatedBy: by })
          .run();
      }
    });
    return this.getCycle(month);
  }

  /**
   * Confirms a draft with its transfers. Stamped transfers already stored are kept,
   * the others are replaced. The amounts used for "last amount" items become the
   * new proposals in the catalog.
   */
  confirm(month: YearMonth, input: CycleConfirm, by: string): { cycle: CycleRecord; updatedItems: number } {
    const { transfers } = cycleConfirmSchema.parse(input);
    let updatedItems = 0;
    this.db.transaction((tx) => {
      const cycle = tx.select().from(cycles).where(eq(cycles.month, month)).get();
      if (!cycle) throw new StoreError('not_found', `nessuna bozza per ${monthName(month)}: salva prima i passi`);
      if (cycle.status === 'confirmed') throw new StoreError('conflict', `${monthName(month)} è già confermato`);
      this.assertAccounts(tx, transfers.flatMap((t) => [t.fromAccountId, t.toAccountId]));
      const inCycle = new Set(
        tx.select({ a: cycleBalances.accountId }).from(cycleBalances).where(eq(cycleBalances.cycleId, cycle.id)).all().map((r) => r.a),
      );
      for (const t of transfers) {
        if (!inCycle.has(t.fromAccountId) || !inCycle.has(t.toAccountId))
          throw new StoreError('invalid', 'un bonifico usa un conto senza saldo in questo ciclo');
        if (t.date > cycle.endsOn || t.dueDate > cycle.endsOn) throw new StoreError('invalid', 'un bonifico cade dopo la fine del ciclo');
      }

      tx.delete(cycleTransfers).where(and(eq(cycleTransfers.cycleId, cycle.id), isNull(cycleTransfers.doneOn))).run();
      for (const t of transfers) {
        tx.insert(cycleTransfers)
          .values({
            id: randomUUID(),
            cycleId: cycle.id,
            fromAccountId: t.fromAccountId,
            toAccountId: t.toAccountId,
            amountCents: t.amountCents,
            date: t.date,
            dueDate: t.dueDate,
            doneOn: t.doneOn ?? null,
            coversEntryIds: t.coversEntryIds,
            createdBy: by,
            updatedBy: by,
          })
          .run();
      }
      const now = nowIso();
      tx.update(cycles)
        .set({ status: 'confirmed', confirmedAt: now, updatedAt: now, updatedBy: by })
        .where(eq(cycles.id, cycle.id))
        .run();

      // "Last amount" items: the amount used this cycle becomes the next proposal.
      // Imported cycles do not touch the catalog.
      if (!cycle.imported) {
        const items = tx.select().from(recurringItems).all();
        const entries = tx.select().from(cycleEntries).where(eq(cycleEntries.cycleId, cycle.id)).all();
        const last = lastUsedAmounts(items, entries);
        for (const [itemId, cents] of last) {
          const item = items.find((i) => i.id === itemId)!;
          if (item.amountCents === cents) continue;
          tx.update(recurringItems)
            .set({ amountCents: cents, updatedAt: now, updatedBy: by })
            .where(eq(recurringItems.id, itemId))
            .run();
          updatedItems++;
        }
      }
    });
    return { cycle: this.getCycle(month), updatedItems };
  }

  /** Back to draft to change it: stamped transfers stay, the others will be recomputed. */
  reopen(month: YearMonth, by: string): CycleRecord {
    this.db.transaction((tx) => {
      const cycle = tx.select().from(cycles).where(eq(cycles.month, month)).get();
      if (!cycle) throw new StoreError('not_found', `nessuna programmazione per ${monthName(month)}`);
      if (cycle.status !== 'confirmed') return;
      tx.delete(cycleTransfers).where(and(eq(cycleTransfers.cycleId, cycle.id), isNull(cycleTransfers.doneOn))).run();
      tx.update(cycles)
        .set({ status: 'draft', confirmedAt: null, updatedAt: nowIso(), updatedBy: by })
        .where(eq(cycles.id, cycle.id))
        .run();
    });
    return this.getCycle(month);
  }

  /** Throws away a draft that was never confirmed. */
  deleteDraft(month: YearMonth): void {
    const cycle = this.db.select().from(cycles).where(eq(cycles.month, month)).get();
    if (!cycle) throw new StoreError('not_found', `nessuna bozza per ${monthName(month)}`);
    if (cycle.status !== 'draft') throw new StoreError('conflict', 'una programmazione confermata non si cancella');
    if (this.db.select({ id: cycleTransfers.id }).from(cycleTransfers).where(eq(cycleTransfers.cycleId, cycle.id)).get())
      throw new StoreError('conflict', 'questa bozza ha bonifici già timbrati: non si cancella');
    this.db.delete(cycles).where(eq(cycles.id, cycle.id)).run();
  }

  /** Stamps a transfer as done (or removes the stamp with null). */
  setTransferDone(id: string, doneOn: ISODate | null, by: string): CycleRecord {
    const t = this.db.select().from(cycleTransfers).where(eq(cycleTransfers.id, id)).get();
    if (!t) throw new StoreError('not_found', 'bonifico non trovato');
    this.db
      .update(cycleTransfers)
      .set({ doneOn, updatedAt: nowIso(), updatedBy: by })
      .where(eq(cycleTransfers.id, id))
      .run();
    const month = this.db.select({ m: cycles.month }).from(cycles).where(eq(cycles.id, t.cycleId)).get()!.m;
    return this.getCycle(month);
  }

  // ---------- debts and dates ----------

  listDebts(): Debt[] {
    return this.db.select().from(debts).orderBy(asc(debts.date), asc(debts.createdAt)).all().map(toDebt);
  }

  getDebt(id: string): Debt {
    const d = this.db.select().from(debts).where(eq(debts.id, id)).get();
    if (!d) throw new StoreError('not_found', 'debito non trovato');
    return toDebt(d);
  }

  createDebt(input: DebtCreate, by: string): Debt {
    const d = debtCreateSchema.parse(input);
    const id = randomUUID();
    this.db
      .insert(debts)
      .values({ id, ...d, paidOn: d.paidOn ?? null, note: d.note || null, createdBy: by, updatedBy: by })
      .run();
    return this.getDebt(id);
  }

  /** Edits a debt; `paidOn` marks it as paid (null reopens it). */
  updateDebt(id: string, input: DebtPatch, by: string): Debt {
    const p = debtPatchSchema.parse(input);
    this.getDebt(id);
    const set = { ...p, ...('note' in p ? { note: p.note || null } : {}), ...('paidOn' in p ? { paidOn: p.paidOn ?? null } : {}) };
    this.db.update(debts).set({ ...set, updatedAt: nowIso(), updatedBy: by }).where(eq(debts.id, id)).run();
    return this.getDebt(id);
  }

  deleteDebt(id: string): void {
    this.getDebt(id);
    this.db.delete(debts).where(eq(debts.id, id)).run();
  }

  listCalendarEvents(): CalendarEvent[] {
    return this.db
      .select()
      .from(calendarEvents)
      .orderBy(asc(calendarEvents.month), asc(calendarEvents.day), asc(calendarEvents.title))
      .all()
      .map(toEvent);
  }

  getCalendarEvent(id: string): CalendarEvent {
    const e = this.db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
    if (!e) throw new StoreError('not_found', 'data non trovata');
    return toEvent(e);
  }

  createCalendarEvent(input: CalendarEventCreate, by: string): CalendarEvent {
    const e = calendarEventCreateSchema.parse(input);
    const id = randomUUID();
    this.db
      .insert(calendarEvents)
      .values({ id, ...e, note: e.note || null, createdBy: by, updatedBy: by })
      .run();
    return this.getCalendarEvent(id);
  }

  updateCalendarEvent(id: string, input: CalendarEventPatch, by: string): CalendarEvent {
    const p = calendarEventPatchSchema.parse(input);
    const current = this.getCalendarEvent(id);
    // The day is checked against the month it ends up in.
    if (!eventDayIsValid({ month: p.month ?? current.month, day: p.day === undefined ? current.day : p.day }))
      throw new StoreError('invalid', EVENT_DAY_MESSAGE);
    const set = { ...p, ...('note' in p ? { note: p.note || null } : {}) };
    this.db.update(calendarEvents).set({ ...set, updatedAt: nowIso(), updatedBy: by }).where(eq(calendarEvents.id, id)).run();
    return this.getCalendarEvent(id);
  }

  deleteCalendarEvent(id: string): void {
    this.getCalendarEvent(id);
    this.db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
  }

  // ---------- history import ----------

  /**
   * Loads past cycles, debts and calendar dates from a history file (made by
   * tools/import-xlsx). Accounts and catalog items are matched by name. All or
   * nothing: a month that already exists stops the whole import.
   */
  importHistory(file: HistoryImport, by: string): { cycles: number; debts: number; calendarEvents: number } {
    this.db.transaction((tx) => {
      const accountIds = new Map(tx.select().from(accounts).all().map((a) => [a.name.toLowerCase(), a.id]));
      const names = file.cycles.flatMap((c) => [
        ...c.balances.map((b) => b.account),
        ...c.entries.map((e) => e.account),
        ...c.transfers.flatMap((t) => [t.from, t.to]),
      ]);
      const unknown = [...new Set(names.filter((n) => !accountIds.has(n.toLowerCase())))];
      if (unknown.length) throw new StoreError('invalid', `conti sconosciuti nel file: ${unknown.join(', ')}`);
      const acc = (name: string) => accountIds.get(name.toLowerCase())!;
      const items = tx.select().from(recurringItems).all();
      const itemId = (name: string | null | undefined, accountId: string) => {
        if (!name) return null;
        const same = items.filter((i) => i.name.toLowerCase() === name.toLowerCase());
        return (same.find((i) => i.accountId === accountId) ?? same[0])?.id ?? null;
      };

      const existing = tx
        .select({ m: cycles.month })
        .from(cycles)
        .where(inArray(cycles.month, file.cycles.map((c) => c.month).concat([''])))
        .all()
        .map((r) => r.m);
      if (existing.length) {
        throw new StoreError('conflict', `esistono già: ${existing.map(monthName).join(', ')}. Lo storico si carica solo per mesi vuoti`);
      }
      if (file.debts.length && tx.select({ n: sql<number>`count(*)` }).from(debts).get()!.n > 0)
        throw new StoreError('conflict', 'ci sono già dei debiti: lo storico li caricherebbe due volte');
      if (file.calendarEvents.length && tx.select({ n: sql<number>`count(*)` }).from(calendarEvents).get()!.n > 0)
        throw new StoreError('conflict', 'ci sono già delle date nel calendario: lo storico le caricherebbe due volte');

      for (const c of file.cycles) {
        const cycleId = randomUUID();
        const now = nowIso();
        tx.insert(cycles)
          .values({
            id: cycleId,
            month: c.month,
            plannedOn: c.plannedOn,
            endsOn: c.endsOn,
            status: c.status,
            notes: c.notes ?? null,
            imported: true,
            confirmedAt: c.status === 'confirmed' ? now : null,
            createdBy: by,
            updatedBy: by,
          })
          .run();
        for (const b of c.balances) {
          tx.insert(cycleBalances)
            .values({ cycleId, accountId: acc(b.account), amountCents: b.amountCents, asOf: b.asOf, createdBy: by, updatedBy: by })
            .run();
        }
        c.entries.forEach((e, n) => {
          const accountId = acc(e.account);
          const { account: _a, item, ...rest } = e;
          tx.insert(cycleEntries)
            .values({ cycleId, id: `imp-${n + 1}`, ...rest, accountId, recurringItemId: itemId(item, accountId), createdBy: by, updatedBy: by })
            .run();
        });
        for (const t of c.transfers) {
          tx.insert(cycleTransfers)
            .values({
              id: randomUUID(),
              cycleId,
              fromAccountId: acc(t.from),
              toAccountId: acc(t.to),
              amountCents: t.amountCents,
              date: t.date,
              dueDate: t.dueDate,
              doneOn: t.doneOn ?? null,
              createdBy: by,
              updatedBy: by,
            })
            .run();
        }
      }

      for (const d of file.debts) {
        tx.insert(debts)
          .values({ id: randomUUID(), ...d, paidOn: d.paidOn ?? null, note: d.note ?? null, createdBy: by, updatedBy: by })
          .run();
      }
      for (const e of file.calendarEvents) {
        tx.insert(calendarEvents)
          .values({ id: randomUUID(), ...e, day: e.day ?? null, note: e.note ?? null, createdBy: by, updatedBy: by })
          .run();
      }
    });
    return { cycles: file.cycles.length, debts: file.debts.length, calendarEvents: file.calendarEvents.length };
  }
}

type DebtRow = typeof debts.$inferSelect;
type EventRow = typeof calendarEvents.$inferSelect;

const toDebt = (d: DebtRow): Debt => ({
  id: d.id,
  date: d.date,
  description: d.description,
  amountCents: d.amountCents,
  paidOn: d.paidOn,
  note: d.note,
});

const toEvent = (e: EventRow): CalendarEvent => ({ id: e.id, type: e.type, title: e.title, month: e.month, day: e.day, note: e.note });
