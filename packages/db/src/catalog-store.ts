import { randomUUID } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  ACTIVE_RANGE_MESSAGE,
  ENVELOPE_MESSAGE,
  envelopeIsValid,
  DEFAULT_SETTINGS,
  accountCreateSchema,
  activeRangeIsValid,
  itemCreateSchema,
  settingsSchema,
  type AccountCreate,
  type AccountPatch,
  type AccountRecord,
  type CatalogImport,
  type CatalogItem,
  type ItemCreate,
  type ItemPatch,
  type Settings,
} from '@kakebo/core';
import { accounts, recurringItems, settings } from './schema.ts';
import type { Db } from './open.ts';

export type StoreErrorCode = 'not_found' | 'conflict' | 'invalid';

/** A domain error with a message for the user (Italian). The API maps the code to a status. */
export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

type AccountRow = typeof accounts.$inferSelect;
type ItemRow = typeof recurringItems.$inferSelect;

const toAccount = (r: AccountRow): AccountRecord => ({
  id: r.id,
  name: r.name,
  role: r.role,
  sort: r.sort,
  marginCents: r.marginCents,
  receivesLeftover: r.receivesLeftover,
  active: r.active,
  color: r.color,
  shape: r.shape,
});

const toItem = (r: ItemRow): CatalogItem => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  accountId: r.accountId,
  day: r.day,
  schedule: r.schedule,
  amountMode: r.amountMode,
  amountCents: r.amountCents,
  note: r.note,
  category: r.category,
  activeFrom: r.activeFrom,
  activeTo: r.activeTo,
  archived: r.archived,
  envelope: r.envelope,
});

const nowIso = () => new Date().toISOString();

function isUniqueViolation(err: unknown, index: string): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message) && err.message.includes(index);
}

/** Accounts, catalog items and settings. `by` is the Access identity of who makes the change. */
export class CatalogStore {
  constructor(private readonly db: Db) {}

  // ---------- accounts ----------

  listAccounts(): AccountRecord[] {
    return this.db.select().from(accounts).orderBy(asc(accounts.sort), asc(accounts.name)).all().map(toAccount);
  }

  getAccount(id: string): AccountRecord {
    const row = this.db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!row) throw new StoreError('not_found', 'conto non trovato');
    return toAccount(row);
  }

  createAccount(input: AccountCreate, by: string): AccountRecord {
    const a = accountCreateSchema.parse(input);
    return this.db.transaction((tx) => {
      const sort =
        a.sort ?? (tx.select({ max: sql<number | null>`max(${accounts.sort})` }).from(accounts).get()?.max ?? 0) + 1;
      if (a.receivesLeftover) tx.update(accounts).set({ receivesLeftover: false, updatedAt: nowIso(), updatedBy: by }).run();
      const id = randomUUID();
      try {
        tx.insert(accounts)
          .values({ id, ...a, sort, createdBy: by, updatedBy: by })
          .run();
      } catch (err) {
        if (isUniqueViolation(err, 'accounts')) throw new StoreError('conflict', `esiste già un conto “${a.name}”`);
        throw err;
      }
      return toAccount(tx.select().from(accounts).where(eq(accounts.id, id)).get()!);
    });
  }

  updateAccount(id: string, patch: AccountPatch, by: string): AccountRecord {
    return this.db.transaction((tx) => {
      const current = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!current) throw new StoreError('not_found', 'conto non trovato');

      if (patch.active === false && current.active) {
        const used = tx
          .select({ n: sql<number>`count(*)` })
          .from(recurringItems)
          .where(and(eq(recurringItems.accountId, id), eq(recurringItems.archived, false)))
          .get();
        if (used && used.n > 0) {
          throw new StoreError('conflict', `il conto ha ancora ${used.n} voci nel catalogo: spostale o archiviale prima`);
        }
      }
      if (patch.receivesLeftover === true) {
        tx.update(accounts)
          .set({ receivesLeftover: false, updatedAt: nowIso(), updatedBy: by })
          .where(and(ne(accounts.id, id), eq(accounts.receivesLeftover, true)))
          .run();
      }
      try {
        tx.update(accounts)
          .set({ ...patch, updatedAt: nowIso(), updatedBy: by })
          .where(eq(accounts.id, id))
          .run();
      } catch (err) {
        if (isUniqueViolation(err, 'accounts')) throw new StoreError('conflict', `esiste già un conto “${patch.name}”`);
        throw err;
      }
      return toAccount(tx.select().from(accounts).where(eq(accounts.id, id)).get()!);
    });
  }

  // ---------- catalog items ----------

  listItems(): CatalogItem[] {
    return this.db
      .select()
      .from(recurringItems)
      .orderBy(asc(recurringItems.day), asc(recurringItems.name))
      .all()
      .map(toItem);
  }

  getItem(id: string): CatalogItem {
    const row = this.db.select().from(recurringItems).where(eq(recurringItems.id, id)).get();
    if (!row) throw new StoreError('not_found', 'voce non trovata');
    return toItem(row);
  }

  private assertUsableAccount(accountId: string) {
    const acc = this.db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!acc) throw new StoreError('invalid', 'il conto scelto non esiste');
    if (!acc.active) throw new StoreError('invalid', `il conto ${acc.name} è chiuso`);
  }

  createItem(input: ItemCreate, by: string): CatalogItem {
    const it = itemCreateSchema.parse(input);
    this.assertUsableAccount(it.accountId);
    const id = randomUUID();
    this.db
      .insert(recurringItems)
      .values({
        id,
        ...it,
        note: it.note || null,
        category: it.category || null,
        activeFrom: it.activeFrom ?? null,
        activeTo: it.activeTo ?? null,
        archived: it.archived ?? false,
        envelope: it.envelope ?? false,
        createdBy: by,
        updatedBy: by,
      })
      .run();
    return this.getItem(id);
  }

  updateItem(id: string, patch: ItemPatch, by: string): CatalogItem {
    const current = this.getItem(id);
    const merged = { ...current, ...patch };
    if (!activeRangeIsValid(merged)) throw new StoreError('invalid', ACTIVE_RANGE_MESSAGE);
    if (!envelopeIsValid(merged)) throw new StoreError('invalid', ENVELOPE_MESSAGE);
    // Restoring or moving an item requires an open account; archived items may keep a closed one.
    if (patch.accountId !== undefined || (patch.archived === false && current.archived)) {
      this.assertUsableAccount(merged.accountId);
    }
    const values: Partial<typeof recurringItems.$inferInsert> = { ...patch, updatedAt: nowIso(), updatedBy: by };
    if ('note' in patch) values.note = patch.note || null;
    if ('category' in patch) values.category = patch.category || null;
    this.db.update(recurringItems).set(values).where(eq(recurringItems.id, id)).run();
    return this.getItem(id);
  }

  // ---------- settings ----------

  getSettings(): Settings {
    const rows = this.db.select().from(settings).all();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // Ignore unknown or corrupt values rather than failing the whole app.
    const parsed = settingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  updateSettings(patch: Partial<Settings>, by: string): Settings {
    const next = settingsSchema.parse({ ...this.getSettings(), ...patch });
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        tx.insert(settings)
          .values({ key, value, updatedBy: by })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: nowIso(), updatedBy: by } })
          .run();
      }
    });
    return next;
  }

  // ---------- initial import ----------

  isEmpty(): boolean {
    return !this.db.select({ id: accounts.id }).from(accounts).limit(1).get();
  }

  /**
   * Loads accounts, items and settings from a catalog file, in one transaction.
   * Only into an empty database: the catalog is edited in the app afterwards.
   */
  importCatalog(file: CatalogImport, by: string): { accounts: number; items: number } {
    if (!this.isEmpty()) throw new StoreError('conflict', 'il catalogo non è vuoto: l’import si fa solo la prima volta');
    this.db.transaction((tx) => {
      const ids = new Map<string, string>();
      for (const a of file.accounts) {
        const id = randomUUID();
        ids.set(a.name.toLowerCase(), id);
        tx.insert(accounts)
          .values({ id, ...a, createdBy: by, updatedBy: by })
          .run();
      }
      for (const { account, ...it } of file.items) {
        tx.insert(recurringItems)
          .values({
            id: randomUUID(),
            ...it,
            accountId: ids.get(account.toLowerCase())!,
            note: it.note || null,
            category: it.category || null,
            activeFrom: it.activeFrom ?? null,
            activeTo: it.activeTo ?? null,
            archived: it.archived ?? false,
            envelope: it.envelope ?? false,
            createdBy: by,
            updatedBy: by,
          })
          .run();
      }
      if (file.settings) {
        for (const [key, value] of Object.entries(file.settings)) {
          if (value !== undefined) tx.insert(settings).values({ key, value, updatedBy: by }).run();
        }
      }
    });
    return { accounts: file.accounts.length, items: file.items.length };
  }
}
