import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z, type ZodType } from 'zod';
import {
  accountCreateSchema,
  accountPatchSchema,
  calendarEventCreateSchema,
  calendarEventPatchSchema,
  catalogImportSchema,
  debtCreateSchema,
  debtPatchSchema,
  cycleConfirmSchema,
  cycleDraftSchema,
  historyImportSchema,
  itemCreateSchema,
  transferPatchSchema,
  yearMonth,
  itemPatchSchema,
  settingsPatchSchema,
} from '@kakebo/core';
import type { CatalogStore, CycleStore } from '@kakebo/db';
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
const monthParam = zValidator('param', z.object({ month: yearMonth }), (result, c) => {
  if (!result.success) return c.json({ error: 'mese non valido (AAAA-MM)' }, 422);
});

/** The REST API under /api. Chained so that the Hono client can infer its types. */
export function apiRoutes(store: CatalogStore, cycles: CycleStore) {
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

      // ---- cycles: the monthly planning ----
      // All cycles, most recent first (a handful per year: no paging needed).
      .get('/cycles', (c) => c.json(cycles.listCycles()))
      .get('/cycles/:month', monthParam, (c) => c.json(cycles.getCycle(c.req.valid('param').month)))
      // Save the four steps as a draft (creates the cycle the first time).
      .put('/cycles/:month', monthParam, body(cycleDraftSchema), (c) =>
        c.json(cycles.saveDraft(c.req.valid('param').month, c.req.valid('json'), c.get('identity').id)),
      )
      .post('/cycles/:month/confirm', monthParam, body(cycleConfirmSchema), (c) =>
        c.json(cycles.confirm(c.req.valid('param').month, c.req.valid('json'), c.get('identity').id)),
      )
      .post('/cycles/:month/reopen', monthParam, (c) =>
        c.json(cycles.reopen(c.req.valid('param').month, c.get('identity').id)),
      )
      .delete('/cycles/:month', monthParam, (c) => {
        cycles.deleteDraft(c.req.valid('param').month);
        return c.json({ ok: true });
      })
      // Stamp a transfer as done ("済"), or remove the stamp.
      .patch('/transfers/:id', idParam, body(transferPatchSchema), (c) =>
        c.json(cycles.setTransferDone(c.req.valid('param').id, c.req.valid('json').doneOn, c.get('identity').id)),
      )

      // ---- reminders: debts and calendar dates (typed in by hand) ----
      .get('/debts', (c) => c.json(cycles.listDebts()))
      .post('/debts', body(debtCreateSchema), (c) => c.json(cycles.createDebt(c.req.valid('json'), c.get('identity').id), 201))
      .patch('/debts/:id', idParam, body(debtPatchSchema), (c) =>
        c.json(cycles.updateDebt(c.req.valid('param').id, c.req.valid('json'), c.get('identity').id)),
      )
      .delete('/debts/:id', idParam, (c) => {
        cycles.deleteDebt(c.req.valid('param').id);
        return c.json({ ok: true });
      })
      .get('/calendar-events', (c) => c.json(cycles.listCalendarEvents()))
      .post('/calendar-events', body(calendarEventCreateSchema), (c) =>
        c.json(cycles.createCalendarEvent(c.req.valid('json'), c.get('identity').id), 201),
      )
      .patch('/calendar-events/:id', idParam, body(calendarEventPatchSchema), (c) =>
        c.json(cycles.updateCalendarEvent(c.req.valid('param').id, c.req.valid('json'), c.get('identity').id)),
      )
      .delete('/calendar-events/:id', idParam, (c) => {
        cycles.deleteCalendarEvent(c.req.valid('param').id);
        return c.json({ ok: true });
      })

      // Past cycles, debts and dates from the old spreadsheet (tools/import-xlsx).
      .post('/import/history', body(historyImportSchema), (c) =>
        c.json(cycles.importHistory(c.req.valid('json'), c.get('identity').id), 201),
      )
  );
}

export type ApiRoutes = ReturnType<typeof apiRoutes>;
