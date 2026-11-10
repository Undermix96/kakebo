import { describe, expect, it } from 'vitest';
import { testClient } from 'hono/testing';
import { CatalogStore, openDatabase } from '@kakebo/db';
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
  const app = createApp(config, { store: new CatalogStore(db) });
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
