import { describe, expect, it } from 'vitest';
import { testClient } from 'hono/testing';
import { CatalogStore, CycleStore, openDatabase } from '@kakebo/db';
import example from '../../../packages/db/fixtures/catalog.example.json' with { type: 'json' };
import { createApp } from './app.ts';
import type { Config } from './config.ts';

const config: Config = {
  port: 0,
  staticDir: null,
  dataDir: './data',
  migrationsDir: null,
  access: null,
  devFakeIdentity: 'dev@example.com',
};

function setup() {
  const { db, sqlite } = openDatabase({ file: ':memory:' });
  const app = createApp(config, { store: new CatalogStore(db), cycles: new CycleStore(db) });
  // Untyped helper for raw requests (the typed client is tested separately).
  const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as Promise<Omit<Response, 'json'> & { json(): Promise<any> }>;
  return { app, sqlite, json, client: testClient(app) };
}

const account = { name: 'Banca Blu', color: 'indaco', shape: 'square' };

describe('catalog API', () => {
  it('starts empty with default settings', async () => {
    const { app } = setup();
    const res = await app.request('/api/catalog');
    expect(res.status).toBe(200);
    expect(await res.json() as unknown).toEqual({
      accounts: [],
      items: [],
      settings: { cycleEndDay: 10, roundingCents: 0, leadDays: 1 },
    });
  });

  it('creates and edits accounts and items, recording the identity', async () => {
    const { json, sqlite } = setup();
    const acc = await (await json('POST', '/api/accounts', account)).json();
    expect(acc).toMatchObject({ name: 'Banca Blu', marginCents: 0, active: true, sort: 1 });

    const created = await json('POST', '/api/items', {
      kind: 'expense',
      name: 'Affitto',
      accountId: acc.id,
      day: 30,
      schedule: { type: 'monthly' },
      amountMode: 'fixed',
      amountCents: 65000,
    });
    expect(created.status).toBe(201);
    const item = await created.json();

    const patched = await json('PATCH', `/api/items/${item.id}`, { amountCents: 66000, note: 'aumentato' });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ amountCents: 66000, note: 'aumentato' });
    expect(sqlite.prepare('select updated_by as by from recurring_items').get()).toEqual({ by: 'dev@example.com' });
  });

  it('rejects invalid input with 422 and a message in Italian', async () => {
    const { json } = setup();
    const res = await json('POST', '/api/accounts', { ...account, name: '' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/nome/);

    const money = await json('POST', '/api/items', {
      kind: 'expense', name: 'X', accountId: 'a', day: 1, schedule: { type: 'monthly' }, amountMode: 'fixed', amountCents: 10.5,
    });
    expect(money.status).toBe(422);
  });

  it('maps domain errors to 404 and 409', async () => {
    const { json } = setup();
    expect((await json('PATCH', '/api/items/nope', { name: 'Y' })).status).toBe(404);
    await json('POST', '/api/accounts', account);
    expect((await json('POST', '/api/accounts', account)).status).toBe(409);
  });

  it('only accepts JSON bodies for changes', async () => {
    const { app } = setup();
    const res = await app.request('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=x',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('imports the catalog once, then refuses', async () => {
    const { json, app } = setup();
    const res = await json('POST', '/api/import/catalog', example);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ accounts: 4, items: 10 });
    const catalog = (await (await app.request('/api/catalog')).json()) as { items: unknown[] };
    expect(catalog.items).toHaveLength(10);
    expect((await json('POST', '/api/import/catalog', example)).status).toBe(409);
  });

  it('updates settings and validates the rounding', async () => {
    const { json } = setup();
    expect(await (await json('PATCH', '/api/settings', { roundingCents: 500 })).json()).toMatchObject({ roundingCents: 500 });
    expect((await json('PATCH', '/api/settings', { roundingCents: 7 })).status).toBe(422);
  });

  it('works through the typed client', async () => {
    const { client } = setup();
    const res = await client.api.accounts.$post({ json: { name: 'Uno', color: 'viola', shape: 'diamond' } });
    const acc = await res.json();
    if (!('id' in acc)) throw new Error('expected an account');
    const list = await (await client.api.catalog.$get()).json();
    expect(list.accounts.map((a) => a.id)).toEqual([acc.id]);
  });
});

describe('cycles API', () => {
  async function seeded() {
    const ctx = setup();
    await ctx.json('POST', '/api/import/catalog', example);
    const catalog = await (await ctx.app.request('/api/catalog')).json() as { accounts: { id: string }[] };
    const balances = catalog.accounts.map((a, i) => ({ accountId: a.id, amountCents: i === 0 ? 100000 : 0, asOf: '2026-11-10' }));
    return { ...ctx, accounts: catalog.accounts, balances };
  }

  it('saves a draft, confirms it, stamps a transfer, reopens it', async () => {
    const { json, accounts, balances } = await seeded();
    const draft = { plannedOn: '2026-11-10', endsOn: '2026-12-10', balances, entries: [] };
    const saved = await json('PUT', '/api/cycles/2026-11', draft);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ month: '2026-11', status: 'draft' });

    const t = { fromAccountId: accounts[0]!.id, toAccountId: accounts[1]!.id, amountCents: 5000, date: '2026-11-10', dueDate: '2026-11-12' };
    const confirmed = await json('POST', '/api/cycles/2026-11/confirm', { transfers: [t] });
    expect(confirmed.status).toBe(200);
    const { cycle } = await confirmed.json();
    expect(cycle.status).toBe('confirmed');
    expect(cycle.transfers).toHaveLength(1);

    const stamped = await json('PATCH', `/api/transfers/${cycle.transfers[0].id}`, { doneOn: '2026-11-11' });
    expect((await stamped.json()).transfers[0].doneOn).toBe('2026-11-11');

    expect((await json('PUT', '/api/cycles/2026-11', draft)).status).toBe(409);
    expect((await json('POST', '/api/cycles/2026-11/reopen')).status).toBe(200);
    expect((await json('PUT', '/api/cycles/2026-11', draft)).status).toBe(200);

    const list = await (await json('GET', '/api/cycles')).json();
    expect(list.map((c: { month: string }) => c.month)).toEqual(['2026-11']);
  });

  it('validates months, drafts and transfers', async () => {
    const { json, balances } = await seeded();
    expect((await json('GET', '/api/cycles/novembre')).status).toBe(422);
    expect((await json('GET', '/api/cycles/2026-11')).status).toBe(404);
    const future = { plannedOn: '2026-11-10', endsOn: '2026-12-10', balances: [{ ...balances[0], asOf: '2026-11-11' }], entries: [] };
    expect((await json('PUT', '/api/cycles/2026-11', future)).status).toBe(422);
    const same = { fromAccountId: 'a', toAccountId: 'a', amountCents: 1, date: '2026-11-10', dueDate: '2026-11-10' };
    expect((await json('POST', '/api/cycles/2026-11/confirm', { transfers: [same] })).status).toBe(422);
    expect((await json('DELETE', '/api/cycles/2026-11')).status).toBe(404);
  });

  it('rejects an expense linked to an envelope that is not in the cycle', async () => {
    const { json, accounts, balances } = await seeded();
    const spend = {
      id: 'mov-1',
      name: 'Farmacia',
      kind: 'expense',
      accountId: accounts[0]!.id,
      date: '2026-11-09',
      amountCents: 1000,
      state: 'included_in_balance',
      origin: 'past_movement',
      envelopeEntryId: 'nope',
    };
    const res = await json('PUT', '/api/cycles/2026-11', { plannedOn: '2026-11-10', endsOn: '2026-12-10', balances, entries: [spend] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('busta');
  });

  it('imports the history and lists debts', async () => {
    const { json } = await seeded();
    const file = {
      cycles: [],
      debts: [{ date: '2026-04-14', description: 'Gita', amountCents: 18750 }],
      calendarEvents: [{ type: 'birthday', title: 'Compleanno di Z.', month: 3, day: 9 }],
    };
    const res = await json('POST', '/api/import/history', file);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ cycles: 0, debts: 1, calendarEvents: 1 });
    expect(await (await json('GET', '/api/debts')).json()).toMatchObject([{ description: 'Gita', paidOn: null }]);
    expect((await json('POST', '/api/import/history', file)).status).toBe(409);
  });
});

describe('reminders API', () => {
  it('adds, edits, pays and deletes a debt', async () => {
    const { json, sqlite } = setup();
    const res = await json('POST', '/api/debts', { date: '2026-05-26', description: 'Mensa', amountCents: 24352, note: '' });
    expect(res.status).toBe(201);
    const debt = await res.json();
    expect(debt).toMatchObject({ description: 'Mensa', amountCents: 24352, paidOn: null, note: null });

    const paid = await (await json('PATCH', `/api/debts/${debt.id}`, { paidOn: '2026-11-10' })).json();
    expect(paid).toMatchObject({ paidOn: '2026-11-10', description: 'Mensa' });
    const reopened = await (await json('PATCH', `/api/debts/${debt.id}`, { paidOn: null, amountCents: 24000 })).json();
    expect(reopened).toMatchObject({ paidOn: null, amountCents: 24000 });
    expect(sqlite.prepare('select updated_by as by from debts').get()).toEqual({ by: 'dev@example.com' });

    expect((await json('POST', '/api/debts', { date: '2026-05-26', description: 'X', amountCents: 0 })).status).toBe(422);
    expect((await json('POST', '/api/debts', { date: '26/05/2026', description: 'X', amountCents: 1 })).status).toBe(422);
    expect((await json('PATCH', '/api/debts/nope', { paidOn: null })).status).toBe(404);

    expect((await json('DELETE', `/api/debts/${debt.id}`)).status).toBe(200);
    expect(await (await json('GET', '/api/debts')).json()).toEqual([]);
    expect((await json('DELETE', `/api/debts/${debt.id}`)).status).toBe(404);
  });

  it('adds, edits and deletes calendar dates, checking the day', async () => {
    const { json } = setup();
    const res = await json('POST', '/api/calendar-events', { type: 'birthday', title: 'Compleanno Leo', month: 7, day: 9 });
    expect(res.status).toBe(201);
    const ev = await res.json();
    expect(ev).toMatchObject({ type: 'birthday', month: 7, day: 9, note: null });

    expect((await json('POST', '/api/calendar-events', { type: 'birthday', title: 'X', month: 4, day: 31 })).status).toBe(422);
    // Moving July 31 to June: the day no longer exists.
    await json('PATCH', `/api/calendar-events/${ev.id}`, { day: 31 });
    expect((await json('PATCH', `/api/calendar-events/${ev.id}`, { month: 6 })).status).toBe(422);
    const undated = await (await json('PATCH', `/api/calendar-events/${ev.id}`, { month: 6, day: null })).json();
    expect(undated).toMatchObject({ month: 6, day: null });

    await json('POST', '/api/calendar-events', { type: 'other', title: 'Natale', month: 12, day: 25 });
    const list = await (await json('GET', '/api/calendar-events')).json();
    expect(list.map((e: { title: string }) => e.title)).toEqual(['Compleanno Leo', 'Natale']);

    expect((await json('DELETE', `/api/calendar-events/${ev.id}`)).status).toBe(200);
    expect((await json('PATCH', `/api/calendar-events/${ev.id}`, { title: 'Y' })).status).toBe(404);
  });
});
