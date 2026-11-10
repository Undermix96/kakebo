import {
  PlanInputError,
  cycleAccounts,
  planCycle,
  planStoredCycle,
  type AccountRecord,
  type CycleRecord,
  type PlanResult,
  type Settings,
} from '@kakebo/core';
import type { ViewTransfer } from './pages/plan/Result.tsx';

export interface StoredPlan {
  accounts: AccountRecord[];
  /** With the cycle's transfers. */
  plan: PlanResult;
  /** Without any transfer. */
  bare: PlanResult;
  transfers: ViewTransfer[];
}

/** Recomputes the projection of a stored cycle (never stored itself). Null if its data no longer fits. */
export function storedPlan(record: CycleRecord, all: AccountRecord[], settings: Settings): StoredPlan | null {
  const accounts = cycleAccounts(record, all);
  const options = { roundingCents: settings.roundingCents, leadDays: settings.leadDays };
  try {
    const plan = planStoredCycle(record, accounts, options);
    const bare = planCycle({
      accounts,
      balances: record.balances,
      entries: record.entries,
      today: record.plannedOn <= record.endsOn ? record.plannedOn : record.endsOn,
      end: record.endsOn,
      options: { ...options, suggest: false },
    });
    const transfers: ViewTransfer[] = record.transfers.map((t) => ({ ...t, key: t.id }));
    return { accounts, plan, bare, transfers };
  } catch (err) {
    if (err instanceof PlanInputError) {
      console.warn(`cycle ${record.month}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

/** The cycle "Oggi" is about: the latest confirmed one already started. */
export function currentCycle(cycles: CycleRecord[], today: string): CycleRecord | undefined {
  return cycles.filter((c) => c.status === 'confirmed' && c.plannedOn <= today).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
}
