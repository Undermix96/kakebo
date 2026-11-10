import { z } from 'zod';
import { isISODate, isYearMonth } from './dates.ts';
import type { Account, Balance, CycleEntry, RecurringItem, Schedule, Transfer } from './types.ts';

/** Zod schemas for the engine's inputs: shared by the API and the forms. */

export const isoDate = z.string().refine(isISODate, 'data non valida (AAAA-MM-GG)');
export const yearMonth = z.string().refine(isYearMonth, 'mese non valido (AAAA-MM)');
export const cents = z.number().int();
export const positiveCents = cents.nonnegative();
export const id = z.string().min(1);
const monthNumber = z.number().int().min(1).max(12);

export const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('monthly') }),
  z.object({ type: z.literal('every_n_months'), n: z.number().int().min(1).max(12), startMonth: yearMonth }),
  z.object({ type: z.literal('yearly'), month: monthNumber }),
  z.object({ type: z.literal('months'), months: z.array(monthNumber).min(1) }),
]);

export const accountSchema = z.object({
  id,
  name: z.string().trim().min(1),
  sort: z.number().int(),
  marginCents: positiveCents,
  receivesLeftover: z.boolean(),
});

/** Fields of a catalog item, without refinements (so it can be picked/partialed). */
export const recurringItemFields = z.object({
  id,
  kind: z.enum(['income', 'expense']),
  name: z.string().trim().min(1),
  accountId: id,
  day: z.number().int().min(1).max(31).nullable(),
  schedule: scheduleSchema,
  amountMode: z.enum(['fixed', 'last']),
  amountCents: positiveCents.nullable(),
  note: z.string().nullish(),
  category: z.string().nullish(),
  activeFrom: isoDate.nullish(),
  activeTo: isoDate.nullish(),
  archived: z.boolean().optional(),
});

export const activeRangeIsValid = (i: { activeFrom?: string | null; activeTo?: string | null }) =>
  !i.activeFrom || !i.activeTo || i.activeFrom <= i.activeTo;
export const ACTIVE_RANGE_MESSAGE = 'la data di fine viene prima di quella di inizio';

export const recurringItemSchema = recurringItemFields.refine(activeRangeIsValid, {
  message: ACTIVE_RANGE_MESSAGE,
  path: ['activeTo'],
});

export const cycleEntrySchema = z.object({
  id,
  recurringItemId: id.nullish(),
  name: z.string().trim().min(1),
  kind: z.enum(['income', 'expense']),
  accountId: id,
  date: isoDate,
  amountCents: positiveCents.nullable(),
  state: z.enum(['pending', 'included_in_balance', 'excluded']),
  origin: z.enum(['catalog', 'sporadic', 'past_movement']),
});

export const balanceSchema = z.object({ accountId: id, amountCents: cents, asOf: isoDate });

export const transferSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amountCents: positiveCents,
    date: isoDate,
    dueDate: isoDate,
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { message: 'stesso conto', path: ['toAccountId'] });

export const planOptionsSchema = z.object({
  roundingCents: positiveCents.optional(),
  leadDays: z.number().int().min(0).max(10).optional(),
});

// Compile-time checks: the schemas produce exactly the engine's types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>() => {};
check<Same<z.infer<typeof scheduleSchema>, Schedule>>();
check<Same<z.infer<typeof accountSchema>, Account>>();
check<Same<z.infer<typeof balanceSchema>, Balance>>();
check<Same<z.infer<typeof transferSchema>, Transfer>>();
check<z.infer<typeof cycleEntrySchema> extends CycleEntry ? true : false>();
check<z.infer<typeof recurringItemSchema> extends RecurringItem ? true : false>();
