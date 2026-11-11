import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AccountColor, AccountShape, Schedule } from '@kakebo/core';

/**
 * kakebo database. Money is INTEGER cents, days are TEXT 'YYYY-MM-DD' (Europe/Rome),
 * timestamps are TEXT ISO-8601 UTC. Every editable row records who changed it
 * (the Cloudflare Access identity).
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const audit = {
  createdAt: text('created_at').notNull().default(now),
  createdBy: text('created_by').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
  updatedBy: text('updated_by').notNull(),
};

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role').notNull().default(''),
    sort: integer('sort').notNull().default(0),
    receivesLeftover: integer('receives_leftover', { mode: 'boolean' }).notNull().default(false),
    marginCents: integer('margin_cents').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    color: text('color').$type<AccountColor>().notNull(),
    shape: text('shape').$type<AccountShape>().notNull(),
    ...audit,
  },
  (t) => [
    uniqueIndex('accounts_name_unique').on(sql`lower(${t.name})`),
    // At most one account receives what is left at the end of the cycle.
    uniqueIndex('accounts_one_leftover').on(t.receivesLeftover).where(sql`${t.receivesLeftover} = 1`),
    check('accounts_margin_nonneg', sql`${t.marginCents} >= 0`),
  ],
);

export const recurringItems = sqliteTable(
  'recurring_items',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    name: text('name').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    day: integer('day'),
    schedule: text('schedule_json', { mode: 'json' }).$type<Schedule>().notNull(),
    amountMode: text('amount_mode', { enum: ['fixed', 'last'] }).notNull(),
    amountCents: integer('amount_cents'),
    note: text('note'),
    category: text('category'),
    activeFrom: text('active_from'),
    activeTo: text('active_to'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    envelope: integer('is_envelope', { mode: 'boolean' }).notNull().default(false),
    ...audit,
  },
  (t) => [
    index('recurring_items_account').on(t.accountId),
    check('recurring_items_kind', sql`${t.kind} in ('income', 'expense')`),
    check('recurring_items_mode', sql`${t.amountMode} in ('fixed', 'last')`),
    check('recurring_items_day', sql`${t.day} is null or ${t.day} between 1 and 31`),
    check('recurring_items_amount', sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
  ],
);

export const cycles = sqliteTable(
  'cycles',
  {
    id: text('id').primaryKey(),
    month: text('month').notNull().unique(),
    plannedOn: text('planned_on').notNull(),
    endsOn: text('ends_on').notNull(),
    status: text('status', { enum: ['draft', 'confirmed'] }).notNull().default('draft'),
    notes: text('notes'),
    imported: integer('imported', { mode: 'boolean' }).notNull().default(false),
    confirmedAt: text('confirmed_at'),
    ...audit,
  },
  (t) => [check('cycles_status', sql`${t.status} in ('draft', 'confirmed')`)],
);

export const cycleBalances = sqliteTable(
  'cycle_balances',
  {
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amountCents: integer('amount_cents').notNull(),
    asOf: text('as_of').notNull(),
    ...audit,
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.accountId] })],
);

export const cycleEntries = sqliteTable(
  'cycle_entries',
  {
    // Unique within its cycle (the same catalog occurrence can sit in two cycles).
    id: text('id').notNull(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    recurringItemId: text('recurring_item_id').references(() => recurringItems.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    date: text('date').notNull(),
    amountCents: integer('amount_cents'),
    state: text('state', { enum: ['pending', 'included_in_balance', 'excluded'] }).notNull(),
    origin: text('origin', { enum: ['catalog', 'sporadic', 'past_movement'] }).notNull(),
    plannedDate: text('planned_date'),
    envelopeEntryId: text('envelope_entry_id'),
    ...audit,
  },
  (t) => [
    primaryKey({ columns: [t.cycleId, t.id] }),
    check('cycle_entries_amount', sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
  ],
);

export const cycleTransfers = sqliteTable(
  'cycle_transfers',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    fromAccountId: text('from_account_id')
      .notNull()
      .references(() => accounts.id),
    toAccountId: text('to_account_id')
      .notNull()
      .references(() => accounts.id),
    amountCents: integer('amount_cents').notNull(),
    /** Earliest day the source has the money. */
    date: text('date').notNull(),
    dueDate: text('due_date').notNull(),
    doneOn: text('done_on'),
    coversEntryIds: text('covers_json', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    ...audit,
  },
  (t) => [
    index('cycle_transfers_cycle').on(t.cycleId),
    check('cycle_transfers_amount', sql`${t.amountCents} > 0`),
    check('cycle_transfers_distinct', sql`${t.fromAccountId} <> ${t.toAccountId}`),
  ],
);

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['birthday', 'anniversary', 'other'] }).notNull(),
    title: text('title').notNull(),
    month: integer('month').notNull(),
    day: integer('day'),
    note: text('note'),
    ...audit,
  },
  (t) => [
    check('calendar_events_month', sql`${t.month} between 1 and 12`),
    check('calendar_events_day', sql`${t.day} is null or ${t.day} between 1 and 31`),
  ],
);

export const debts = sqliteTable(
  'debts',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paidOn: text('paid_on'),
    note: text('note'),
    ...audit,
  },
  (t) => [check('debts_amount', sql`${t.amountCents} >= 0`)],
);

/** Key/value settings; values are JSON. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull().default(now),
  updatedBy: text('updated_by').notNull(),
});
