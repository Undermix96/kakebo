import { z } from 'zod';
import type { Account, RecurringItem, Schedule } from './types.ts';
import { DEFAULT_END_DAY } from './cycle.ts';
import { positiveCents, recurringItemFields, activeRangeIsValid, ACTIVE_RANGE_MESSAGE } from './schemas.ts';

/**
 * Stored shapes of the catalog (accounts, recurring items, settings) and the
 * schemas used by the API and the forms. Colors are palette keys: the actual
 * colors live in the web theme (apps/web/src/theme.css), never here.
 */

/** Each account is recognisable without color too: by its glyph. */
export const ACCOUNT_SHAPES = ['square', 'diamond', 'circle', 'bar'] as const;
export type AccountShape = (typeof ACCOUNT_SHAPES)[number];

/** Palette keys with their Italian names, in groups of three (one group per default account). */
export const ACCOUNT_COLORS = [
  ['indaco', 'indaco'],
  ['petrolio', 'verde petrolio'],
  ['notte', 'blu notte'],
  ['viola', 'viola'],
  ['prugna', 'prugna'],
  ['lavanda', 'lavanda scura'],
  ['ocra', 'ocra'],
  ['siena', 'terra di Siena'],
  ['oliva', 'oliva'],
  ['muschio', 'muschio'],
  ['giada', 'giada'],
  ['bronzo', 'bronzo'],
] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number][0];
const colorKeys = ACCOUNT_COLORS.map(([k]) => k) as [AccountColor, ...AccountColor[]];

/** The three swatches offered for an account: the group its current color belongs to. */
export function colorGroup(color: AccountColor): AccountColor[] {
  const i = colorKeys.indexOf(color);
  const start = Math.max(0, i - (i % 3));
  return colorKeys.slice(start, start + 3);
}

export interface AccountRecord extends Account {
  /** What the account is for, in the family's words. */
  role: string;
  /** Closed accounts stay for history but are not offered for new items. */
  active: boolean;
  color: AccountColor;
  shape: AccountShape;
}

export interface CatalogItem extends RecurringItem {
  note: string | null;
  category: string | null;
  activeFrom: string | null;
  activeTo: string | null;
  archived: boolean;
}

export interface Settings {
  /** Day of month M+1 when cycle M ends (inclusive). */
  cycleEndDay: number;
  /** Transfers rounded up to a multiple of this; 0 = exact cents. */
  roundingCents: number;
  /** Transfers are due this many days before the expense they cover. */
  leadDays: number;
}

export const DEFAULT_SETTINGS: Settings = { cycleEndDay: DEFAULT_END_DAY, roundingCents: 0, leadDays: 1 };
export const ROUNDING_OPTIONS = [0, 100, 500, 1000] as const;

// ---------- schemas ----------

const name = z.string().trim().min(1, 'il nome non può essere vuoto').max(80);

export const accountCreateSchema = z.object({
  name,
  role: z.string().trim().max(200).default(''),
  sort: z.number().int().optional(),
  marginCents: positiveCents.default(0),
  receivesLeftover: z.boolean().default(false),
  active: z.boolean().default(true),
  color: z.enum(colorKeys),
  shape: z.enum(ACCOUNT_SHAPES),
});
export type AccountCreate = z.input<typeof accountCreateSchema>;

export const accountPatchSchema = z
  .object({
    name,
    role: z.string().trim().max(200),
    sort: z.number().int(),
    marginCents: positiveCents,
    receivesLeftover: z.boolean(),
    active: z.boolean(),
    color: z.enum(colorKeys),
    shape: z.enum(ACCOUNT_SHAPES),
  })
  .partial();
export type AccountPatch = z.infer<typeof accountPatchSchema>;

const itemBody = recurringItemFields.omit({ id: true }).extend({
  name,
  note: z.string().trim().max(500).nullish(),
  category: z.string().trim().max(60).nullish(),
});

export const itemCreateSchema = itemBody.refine(activeRangeIsValid, { message: ACTIVE_RANGE_MESSAGE, path: ['activeTo'] });
export type ItemCreate = z.input<typeof itemCreateSchema>;

/** Partial update; the API re-checks the merged item (e.g. the active range). */
export const itemPatchSchema = itemBody.partial();
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const settingsSchema = z.object({
  cycleEndDay: z.number().int().min(1).max(28),
  roundingCents: z.number().int().refine((v) => (ROUNDING_OPTIONS as readonly number[]).includes(v), 'arrotondamento non previsto'),
  leadDays: z.number().int().min(0).max(10),
});
export const settingsPatchSchema = settingsSchema.partial();

/**
 * Catalog file used to load the initial catalog (the real one lives outside the
 * repository). Items refer to accounts by name.
 */
export const catalogImportSchema = z
  .object({
    accounts: z
      .array(accountCreateSchema.extend({ sort: z.number().int() }))
      .min(1),
    items: z.array(
      itemBody.omit({ accountId: true }).extend({ account: name }).refine(activeRangeIsValid, {
        message: ACTIVE_RANGE_MESSAGE,
        path: ['activeTo'],
      }),
    ),
    settings: settingsPatchSchema.optional(),
  })
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    file.accounts.forEach((a, i) => {
      const key = a.name.toLowerCase();
      if (names.has(key)) ctx.addIssue({ code: 'custom', message: `conto ripetuto: ${a.name}`, path: ['accounts', i, 'name'] });
      names.add(key);
    });
    if (file.accounts.filter((a) => a.receivesLeftover).length > 1) {
      ctx.addIssue({ code: 'custom', message: 'solo un conto può ricevere gli avanzi', path: ['accounts'] });
    }
    file.items.forEach((it, i) => {
      if (!names.has(it.account.toLowerCase())) {
        ctx.addIssue({ code: 'custom', message: `conto sconosciuto: ${it.account}`, path: ['items', i, 'account'] });
      }
    });
  });
export type CatalogImport = z.infer<typeof catalogImportSchema>;

// ---------- labels (Italian UI) ----------

export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'] as const;
export const MONTHS_LONG = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
] as const;

/** "mensile", "annuale · maggio", "giugno e dicembre", "ogni 3 mesi da gen 2027"… */
export function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case 'monthly':
      return 'mensile';
    case 'yearly':
      return `annuale · ${MONTHS_LONG[s.month - 1]}`;
    case 'months': {
      const ms = [...s.months].sort((a, b) => a - b);
      if (ms.length === 1) return `annuale · ${MONTHS_LONG[ms[0]! - 1]}`;
      if (ms.length === 2) return `${MONTHS_LONG[ms[0]! - 1]} e ${MONTHS_LONG[ms[1]! - 1]}`;
      return ms.map((m) => MONTHS_SHORT[m - 1]).join(' · ');
    }
    case 'every_n_months': {
      const [y, m] = s.startMonth.split('-').map(Number);
      return `ogni ${s.n} mesi da ${MONTHS_SHORT[m! - 1]} ${y}`;
    }
  }
}

/** Is the item due in the projection at all (not archived, not ended before `today`)? */
export function isCurrentlyActive(item: Pick<CatalogItem, 'archived' | 'activeTo'>, today: string): boolean {
  return !item.archived && (!item.activeTo || item.activeTo >= today);
}

