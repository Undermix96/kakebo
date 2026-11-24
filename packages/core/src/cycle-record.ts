import { z } from 'zod';
import type { Cents } from './money.ts';
import { minDate, type ISODate, type YearMonth } from './dates.ts';
import type { Account, Balance, CycleEntry, Id, Transfer } from './types.ts';
import { planCycle, type PlanOptions, type PlanResult } from './plan.ts';
import { effectiveAmount, envelopeSpent } from './envelope.ts';
import { balanceSchema, cents, cycleEntrySchema, id, isoDate, positiveCents, yearMonth } from './schemas.ts';

/**
 * A cycle as stored: what was typed in the four steps (balances and entries) and,
 * once confirmed, the transfers to make. The projection is never stored: it is
 * recomputed with the engine from these inputs.
 */

export type CycleStatus = 'draft' | 'confirmed';

export interface StoredTransfer extends Transfer {
  id: Id;
  /** Day it was stamped as done; null = still to do. */
  doneOn: ISODate | null;
  /** Expenses it was meant to cover (for the "why" shown next to it). */
  coversEntryIds: Id[];
}

export interface CycleRecord {
  id: Id;
  month: YearMonth;
  /** Day of the planning (the engine's "today"). */
  plannedOn: ISODate;
  /** Last day of the cycle, inclusive. */
  endsOn: ISODate;
  status: CycleStatus;
  /** Loaded from the old spreadsheet. */
  imported: boolean;
  notes: string | null;
  balances: Balance[];
  entries: CycleEntry[];
  transfers: StoredTransfer[];
  confirmedAt: string | null;
  updatedAt: string;
  updatedBy: string;
}

// ---------- API bodies ----------

/** Save the draft of the four steps (replaces balances and entries). */
/**
 * What is wrong with the "paid by transfer" fields of an entry (§13 phase 5c), or null.
 * Only an expense still to be made (not out of an envelope) is paid by a transfer;
 * only such an expense, not excluded, carries a stamp. A pending one is stamped from
 * the balance date of its account to the end of the cycle; one already in the
 * balance (the balance was read after the transfer) may be stamped before it.
 */
export function byTransferIssue(
  e: Pick<CycleEntry, 'kind' | 'origin' | 'envelopeEntryId' | 'state' | 'byTransfer' | 'paidOn'>,
  asOf: ISODate,
  endsOn: ISODate,
): { field: 'byTransfer' | 'paidOn'; message: string } | null {
  if (e.byTransfer && !entryCanBeByTransfer(e)) return { field: 'byTransfer', message: 'solo una spesa ancora da fare si paga con bonifico' };
  if (!e.paidOn) return null;
  if (!e.byTransfer) return { field: 'paidOn', message: 'si timbra solo una spesa pagata con bonifico' };
  if (e.state === 'excluded') return { field: 'paidOn', message: 'una voce tolta dal ciclo non si timbra' };
  if (e.paidOn > endsOn) return { field: 'paidOn', message: 'il giorno del pagamento è dopo la fine del ciclo' };
  if (e.state === 'pending' && e.paidOn < asOf) return { field: 'paidOn', message: 'il giorno del pagamento è prima della data del saldo' };
  return null;
}

export const cycleDraftSchema = z
  .object({
    plannedOn: isoDate,
    endsOn: isoDate,
    balances: z.array(balanceSchema).min(1),
    entries: z.array(cycleEntrySchema),
    notes: z.string().trim().max(1000).nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.plannedOn > d.endsOn) ctx.addIssue({ code: 'custom', message: 'la programmazione è dopo la fine del ciclo', path: ['plannedOn'] });
    const seen = new Set<string>();
    d.balances.forEach((b, i) => {
      if (seen.has(b.accountId)) ctx.addIssue({ code: 'custom', message: 'due saldi per lo stesso conto', path: ['balances', i] });
      seen.add(b.accountId);
      if (b.asOf > d.plannedOn) ctx.addIssue({ code: 'custom', message: 'la data del saldo è nel futuro', path: ['balances', i, 'asOf'] });
    });
    const ids = new Set<string>();
    d.entries.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: 'custom', message: 'voce ripetuta', path: ['entries', i, 'id'] });
      ids.add(e.id);
    });
    const byId = new Map(d.entries.map((e) => [e.id, e]));
    d.entries.forEach((e, i) => {
      if (!e.envelopeEntryId) return;
      const target = byId.get(e.envelopeEntryId);
      const path = ['entries', i, 'envelopeEntryId'];
      if (!target || target.id === e.id || target.kind !== 'expense' || target.envelopeEntryId)
        ctx.addIssue({ code: 'custom', message: 'la busta di questa spesa non è nel ciclo', path });
      else if (e.kind !== 'expense' || e.origin !== 'past_movement')
        ctx.addIssue({ code: 'custom', message: 'nella busta vanno solo spese già fatte', path });
    });
    const asOf = new Map(d.balances.map((b) => [b.accountId, b.asOf]));
    d.entries.forEach((e, i) => {
      const issue = byTransferIssue(e, asOf.get(e.accountId) ?? d.plannedOn, d.endsOn);
      if (issue) ctx.addIssue({ code: 'custom', message: issue.message, path: ['entries', i, issue.field] });
    });
  });
export type CycleDraft = z.infer<typeof cycleDraftSchema>;

export const transferInputSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amountCents: positiveCents.refine((v) => v > 0, 'importo del bonifico mancante'),
    date: isoDate,
    dueDate: isoDate,
    doneOn: isoDate.nullish(),
    coversEntryIds: z.array(id).default([]),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { message: 'un bonifico va tra due conti diversi', path: ['toAccountId'] });
export type TransferInput = z.input<typeof transferInputSchema>;

/** Confirm the cycle with the transfers to make (those already stamped are kept). */
export const cycleConfirmSchema = z.object({ transfers: z.array(transferInputSchema) });
export type CycleConfirm = z.input<typeof cycleConfirmSchema>;

export const transferPatchSchema = z.object({ doneOn: isoDate.nullable() });

/**
 * Can this cycle entry be paid by a transfer? An expense to be made (catalog or
 * sporadic), not a movement already made nor an expense out of an envelope.
 * Envelopes themselves are refused by the store, which knows the catalog.
 */
export const entryCanBeByTransfer = (e: Pick<CycleEntry, 'kind' | 'origin' | 'envelopeEntryId'>) =>
  e.kind === 'expense' && e.origin !== 'past_movement' && !e.envelopeEntryId;

/** Stamp (or un-stamp, with null) an expense paid by a transfer, also in a confirmed cycle. */
export const entryStampSchema = z.object({ paidOn: isoDate.nullable() });
export type EntryStamp = z.infer<typeof entryStampSchema>;

// ---------- engine helpers ----------

/** Accounts that take part in a cycle: those with a balance in it. */
export function cycleAccounts<A extends Account>(record: Pick<CycleRecord, 'balances'>, accounts: A[]): A[] {
  const used = new Set(record.balances.map((b) => b.accountId));
  return accounts.filter((a) => used.has(a.id));
}

/**
 * Stored transfers as the engine's fixed transfers. A transfer stamped late counts
 * from the day it was stamped; one stamped early (often a transfer scheduled in the
 * bank's app) stays on its planned day, when the source has the money.
 */
export function fixedTransfersOf(transfers: StoredTransfer[], start: ISODate): Transfer[] {
  return transfers.map((t) => ({
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amountCents: t.amountCents,
    date: maxIso(t.doneOn && t.doneOn > t.date ? t.doneOn : t.date, start),
    dueDate: t.dueDate,
  }));
}

const maxIso = (a: ISODate, b: ISODate) => (a >= b ? a : b);

/**
 * The projection of a stored cycle. A confirmed cycle only replays its own
 * transfers; a draft also gets suggestions for what its stamped transfers do
 * not cover yet.
 */
export function planStoredCycle(
  record: Pick<CycleRecord, 'plannedOn' | 'endsOn' | 'status' | 'balances' | 'entries' | 'transfers'>,
  accounts: Account[],
  options: Omit<PlanOptions, 'suggest'> = {},
): PlanResult {
  const today = minDate(record.plannedOn, record.endsOn);
  const start = record.balances.reduce((d, b) => minDate(d, b.asOf), today);
  const transfers = record.status === 'confirmed' ? record.transfers : record.transfers.filter((t) => t.doneOn);
  return planCycle({
    accounts: cycleAccounts(record, accounts),
    balances: record.balances,
    entries: record.entries,
    today,
    end: record.endsOn,
    fixedTransfers: fixedTransfersOf(transfers, start),
    options: { ...options, suggest: record.status !== 'confirmed' },
  });
}

/** Totals of a cycle's entries that count (pending ones with an amount; an envelope for what is left of it). */
export function cycleTotals(entries: CycleEntry[]): { incomeCents: Cents; expenseCents: Cents; incomes: number; expenses: number } {
  let incomeCents = 0;
  let expenseCents = 0;
  let incomes = 0;
  let expenses = 0;
  const spent = envelopeSpent(entries);
  for (const e of entries) {
    const amount = effectiveAmount(e, spent);
    if (e.state !== 'pending' || amount == null) continue;
    if (e.kind === 'income') [incomeCents, incomes] = [incomeCents + amount, incomes + 1];
    else [expenseCents, expenses] = [expenseCents + amount, expenses + 1];
  }
  return { incomeCents, expenseCents, incomes, expenses };
}

// ---------- history file (import from the old spreadsheet) ----------

const accountName = z.string().trim().min(1).max(80);

export const historyImportSchema = z
  .object({
    /** Where the data comes from, for the summary shown before writing. */
    source: z.string().max(200).optional(),
    cycles: z.array(
      z.object({
        month: yearMonth,
        plannedOn: isoDate,
        endsOn: isoDate,
        status: z.enum(['draft', 'confirmed']),
        notes: z.string().max(2000).nullish(),
        balances: z.array(z.object({ account: accountName, amountCents: cents, asOf: isoDate })).min(1),
        entries: z.array(
          cycleEntrySchema.omit({ id: true, accountId: true, recurringItemId: true, envelopeEntryId: true }).extend({
            account: accountName,
            /** Name of the catalog item it is an occurrence of, if any. */
            item: z.string().nullish(),
          }),
        ),
        transfers: z.array(
          z.object({
            from: accountName,
            to: accountName,
            amountCents: positiveCents,
            date: isoDate,
            dueDate: isoDate,
            doneOn: isoDate.nullish(),
          }),
        ),
      }),
    ),
    debts: z
      .array(
        z.object({
          date: isoDate,
          description: z.string().trim().min(1).max(200),
          amountCents: positiveCents,
          paidOn: isoDate.nullish(),
          note: z.string().max(500).nullish(),
        }),
      )
      .default([]),
    calendarEvents: z
      .array(
        z.object({
          type: z.enum(['birthday', 'anniversary', 'other']),
          title: z.string().trim().min(1).max(120),
          month: z.number().int().min(1).max(12),
          day: z.number().int().min(1).max(31).nullish(),
          note: z.string().max(500).nullish(),
        }),
      )
      .default([]),
  })
  .superRefine((f, ctx) => {
    const months = new Set<string>();
    f.cycles.forEach((c, i) => {
      if (months.has(c.month)) ctx.addIssue({ code: 'custom', message: `ciclo ripetuto: ${c.month}`, path: ['cycles', i, 'month'] });
      months.add(c.month);
      // Same rules as a draft for expenses paid by a transfer (§13 phase 5c).
      const asOf = new Map(c.balances.map((b) => [b.account.toLowerCase(), b.asOf]));
      c.entries.forEach((e, j) => {
        const issue = byTransferIssue({ ...e, envelopeEntryId: null }, asOf.get(e.account.toLowerCase()) ?? c.plannedOn, c.endsOn);
        if (issue) ctx.addIssue({ code: 'custom', message: issue.message, path: ['cycles', i, 'entries', j, issue.field] });
      });
    });
  });
export type HistoryImport = z.infer<typeof historyImportSchema>;

export interface Debt {
  id: Id;
  date: ISODate;
  description: string;
  amountCents: Cents;
  paidOn: ISODate | null;
  note: string | null;
}

export interface CalendarEvent {
  id: Id;
  type: 'birthday' | 'anniversary' | 'other';
  title: string;
  month: number;
  day: number | null;
  note: string | null;
}
