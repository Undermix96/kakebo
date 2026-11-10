import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z, type ZodType } from 'zod';
import {
  accountCreateSchema,
  accountPatchSchema,
  catalogImportSchema,
  itemCreateSchema,
  itemPatchSchema,
  settingsPatchSchema,
} from '@kakebo/core';
import type { CatalogStore } from '@kakebo/db';
import type { AccessEnv } from './access.ts';

/** JSON body validation; errors become 422 with the first message in Italian. */
const body = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
      return c.json({ error: `${issue?.message ?? 'dati non validi'}${where}` }, 422);
    }
  });

const idParam = zValidator('param', z.object({ id: z.string().min(1).max(64) }));

/** The REST API under /api. Chained so that the Hono client can infer its types. */
export function apiRoutes(store: CatalogStore) {
  return (
    new Hono<AccessEnv>()
      .get('/me', (c) => c.json(c.get('identity')))

      // Everything the Catalogo and Impostazioni pages need, in one call.
      .get('/catalog', (c) =>
        c.json({
          accounts: store.listAccounts(),
          items: store.listItems(),
          settings: store.getSettings(),
        }),
      )

      .post('/accounts', body(accountCreateSchema), (c) =>
        c.json(store.createAccount(c.req.valid('json'), c.get('identity').id), 201),
      )
      .patch('/accounts/:id', idParam, body(accountPatchSchema), (c) =>
        c.json(store.updateAccount(c.req.valid('param').id, c.req.valid('json'), c.get('identity').id)),
      )

      .post('/items', body(itemCreateSchema), (c) => c.json(store.createItem(c.req.valid('json'), c.get('identity').id), 201))
      .patch('/items/:id', idParam, body(itemPatchSchema), (c) =>
        c.json(store.updateItem(c.req.valid('param').id, c.req.valid('json'), c.get('identity').id)),
      )

      .patch('/settings', body(settingsPatchSchema), (c) =>
        c.json(store.updateSettings(c.req.valid('json'), c.get('identity').id)),
      )

      // First load of the catalog from a JSON file (only into an empty database).
      .post('/import/catalog', body(catalogImportSchema), (c) =>
        c.json(store.importCatalog(c.req.valid('json'), c.get('identity').id), 201),
      )
  );
}

export type ApiRoutes = ReturnType<typeof apiRoutes>;
