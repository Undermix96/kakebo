import type { Cents } from './money.ts';
import type { CycleEntry, Id } from './types.ts';

/**
 * The envelope ("busta"): a catalog expense that is a budget spent bit by bit
 * during the cycle (the family's groceries and pharmacy), not a single payment.
 * Expenses already made out of it are cycle entries linked to it through
 * `envelopeEntryId`, paid from any account. They follow the usual balance rule
 * (already in the balance or still to come); the envelope itself only counts
 * for what is left of it.
 */

/** Envelope entry id → total of the (non-excluded) expenses linked to it. */
export function envelopeSpent(entries: CycleEntry[]): Map<Id, Cents> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const spent = new Map<Id, Cents>();
  for (const e of entries) {
    const target = e.envelopeEntryId ? byId.get(e.envelopeEntryId) : undefined;
    if (!target || target.id === e.id || target.kind !== 'expense' || target.envelopeEntryId) continue;
    if (e.kind !== 'expense' || e.state === 'excluded' || e.amountCents == null) continue;
    spent.set(target.id, (spent.get(target.id) ?? 0) + e.amountCents);
  }
  return spent;
}

export interface EnvelopeStatus {
  /** The whole envelope (the entry's amount). */
  totalCents: Cents;
  spentCents: Cents;
  /** What is still to spend, never below zero. */
  leftCents: Cents;
  /** How much the spending went over the envelope (0 if not). */
  overCents: Cents;
}

/** Status of an entry that has expenses linked to it; null for any other entry. */
export function envelopeStatus(entry: CycleEntry, spent: Map<Id, Cents>): EnvelopeStatus | null {
  const used = spent.get(entry.id);
  if (used == null || entry.amountCents == null) return null;
  return {
    totalCents: entry.amountCents,
    spentCents: used,
    leftCents: Math.max(0, entry.amountCents - used),
    overCents: Math.max(0, used - entry.amountCents),
  };
}

/** The amount an entry weighs on the cycle: its own, or what is left of the envelope. */
export function effectiveAmount(entry: CycleEntry, spent: Map<Id, Cents>): Cents | null {
  return envelopeStatus(entry, spent)?.leftCents ?? entry.amountCents;
}
