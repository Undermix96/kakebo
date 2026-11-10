import type { Cents } from './money.ts';
import type { ISODate, YearMonth } from './dates.ts';

export type Id = string;
export type EntryKind = 'income' | 'expense';

export interface Account {
  id: Id;
  name: string;
  /** Display order; also the tie-breaker when the engine has to choose. */
  sort: number;
  /** Safety margin: the engine keeps the account at or above this. Default 0. */
  marginCents: Cents;
  /** The account that gets what is left at the end of the cycle (ING). */
  receivesLeftover: boolean;
}

/** How often a catalog item recurs. Months are 1–12. */
export type Schedule =
  | { type: 'monthly' }
  | { type: 'every_n_months'; n: number; startMonth: YearMonth }
  | { type: 'yearly'; month: number }
  | { type: 'months'; months: number[] };

export interface RecurringItem {
  id: Id;
  kind: EntryKind;
  name: string;
  accountId: Id;
  /** Day of the month (29–31 clamp to the month's last day). null = unknown day: see `generateCycleEntries`. */
  day: number | null;
  schedule: Schedule;
  /** 'fixed' = always the same amount; 'last' = propose the last amount used. */
  amountMode: 'fixed' | 'last';
  /** Always positive. null = amount not known yet (flagged, never invented). */
  amountCents: Cents | null;
  note?: string | null;
  /** Free label for future kakebo statistics. */
  category?: string | null;
  /** Inclusive bounds of validity, ISO dates. */
  activeFrom?: ISODate | null;
  activeTo?: ISODate | null;
  archived?: boolean;
}

export type EntryState = 'pending' | 'included_in_balance' | 'excluded';
export type EntryOrigin = 'catalog' | 'sporadic' | 'past_movement';

/** A concrete income or expense in a cycle. */
export interface CycleEntry {
  id: Id;
  recurringItemId?: Id | null;
  name: string;
  kind: EntryKind;
  accountId: Id;
  date: ISODate;
  /** Always positive; the sign comes from `kind`. null = missing (flagged, left out of the projection). */
  amountCents: Cents | null;
  state: EntryState;
  origin: EntryOrigin;
}

/** Balance of an account on a given day (`asOf`): movements dated before it are assumed to be in it. */
export interface Balance {
  accountId: Id;
  amountCents: Cents;
  asOf: ISODate;
}

export interface Transfer {
  fromAccountId: Id;
  toAccountId: Id;
  /** Always positive. */
  amountCents: Cents;
  /** Earliest day the transfer can be made without leaving the source short. */
  date: ISODate;
  /** Latest day ("entro il") for the destination to have the money in time. */
  dueDate: ISODate;
}
