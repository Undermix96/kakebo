import { hc, type InferResponseType } from 'hono/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { App } from '@kakebo/api';
import type {
  AccountCreate,
  AccountPatch,
  AccountRecord,
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventPatch,
  CatalogImport,
  CatalogItem,
  CycleConfirm,
  CycleDraft,
  CycleRecord,
  Debt,
  DebtCreate,
  DebtPatch,
  HistoryImport,
  ItemCreate,
  ItemPatch,
  Settings,
} from '@kakebo/core';

/** Typed client of our own API (same origin: Cloudflare Access sends its cookie). */
export const client = hc<App>('/', { init: { credentials: 'same-origin' } });

/** Error with the server's message (already in Italian). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function unwrap<T>(res: Promise<Response>): Promise<T> {
  let r: Response;
  try {
    r = await res;
  } catch {
    throw new ApiError(0, 'il servizio non risponde: controlla la connessione');
  }
  if (r.ok) return (await r.json()) as T;
  let message = `errore ${r.status}`;
  try {
    const body = (await r.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* not JSON */
  }
  if (r.status === 403) message = 'accesso scaduto: ricarica la pagina per rifare il login';
  throw new ApiError(r.status, message);
}

export type Catalog = InferResponseType<typeof client.api.catalog.$get>;
// The inferred type and the domain types must agree.
type _Check = Catalog extends { accounts: AccountRecord[]; items: CatalogItem[]; settings: Settings } ? true : never;
const _check: _Check = true;
void _check;

export const meQuery = () => ({
  queryKey: ['me'],
  queryFn: () => unwrap<{ id: string; kind: 'user' | 'service' | 'dev' }>(client.api.me.$get()),
});

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => unwrap<Catalog>(client.api.catalog.$get()) });
}

/** Mutations refresh the catalog when they succeed. */
function useCatalogMutation<V, R>(fn: (v: V) => Promise<Response>) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => unwrap<R>(fn(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog'] }),
  });
}

export const useCreateAccount = () =>
  useCatalogMutation<AccountCreate, AccountRecord>((json) => client.api.accounts.$post({ json }));
export const useUpdateAccount = () =>
  useCatalogMutation<{ id: string; patch: AccountPatch }, AccountRecord>(({ id, patch }) =>
    client.api.accounts[':id'].$patch({ param: { id }, json: patch }),
  );
export const useCreateItem = () =>
  useCatalogMutation<ItemCreate, CatalogItem>((json) => client.api.items.$post({ json }));
export const useUpdateItem = () =>
  useCatalogMutation<{ id: string; patch: ItemPatch }, CatalogItem>(({ id, patch }) =>
    client.api.items[':id'].$patch({ param: { id }, json: patch }),
  );
export const useUpdateSettings = () =>
  useCatalogMutation<Partial<Settings>, Settings>((json) => client.api.settings.$patch({ json }));
export const useImportCatalog = () =>
  useCatalogMutation<CatalogImport, { accounts: number; items: number }>((json) =>
    client.api.import.catalog.$post({ json }),
  );

// ---------- cycles ----------

export function useCycles() {
  return useQuery({ queryKey: ['cycles'], queryFn: () => unwrap<CycleRecord[]>(client.api.cycles.$get()) });
}

export function useDebts() {
  return useQuery({ queryKey: ['debts'], queryFn: () => unwrap<Debt[]>(client.api.debts.$get()) });
}

/** Cycle mutations refresh the cycles (and the catalog: confirming updates "last" amounts). */
function useCycleMutation<V, R>(fn: (v: V) => Promise<Response>) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => unwrap<R>(fn(v)),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['cycles'] }), qc.invalidateQueries({ queryKey: ['catalog'] })]),
  });
}

export const useSaveDraft = () =>
  useMutation<CycleRecord, ApiError, { month: string; draft: CycleDraft }>({
    mutationFn: ({ month, draft }) => unwrap(client.api.cycles[':month'].$put({ param: { month }, json: draft })),
  });
export const useConfirmCycle = () =>
  useCycleMutation<{ month: string; body: CycleConfirm }, { cycle: CycleRecord; updatedItems: number }>(({ month, body }) =>
    client.api.cycles[':month'].confirm.$post({ param: { month }, json: body }),
  );
export const useReopenCycle = () =>
  useCycleMutation<string, CycleRecord>((month) => client.api.cycles[':month'].reopen.$post({ param: { month } }));
export const useDeleteDraft = () =>
  useCycleMutation<string, { ok: true }>((month) => client.api.cycles[':month'].$delete({ param: { month } }));
export const useImportHistory = () => {
  const qc = useQueryClient();
  return useMutation<{ cycles: number; debts: number; calendarEvents: number }, ApiError, HistoryImport>({
    mutationFn: (json) => unwrap(client.api.import.history.$post({ json })),
    onSuccess: () => qc.invalidateQueries(),
  });
};

/** Stamping is optimistic: the 済 appears at once, and goes away if the server says no. */
export function useStampTransfer() {
  const qc = useQueryClient();
  return useMutation<CycleRecord, ApiError, { id: string; doneOn: string | null }, { before?: CycleRecord[] }>({
    mutationFn: ({ id, doneOn }) => unwrap(client.api.transfers[':id'].$patch({ param: { id }, json: { doneOn } })),
    onMutate: async ({ id, doneOn }) => {
      await qc.cancelQueries({ queryKey: ['cycles'] });
      const before = qc.getQueryData<CycleRecord[]>(['cycles']);
      qc.setQueryData<CycleRecord[]>(['cycles'], (list) =>
        list?.map((c) => ({ ...c, transfers: c.transfers.map((t) => (t.id === id ? { ...t, doneOn } : t)) })),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(['cycles'], ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['cycles'] }),
  });
}

// ---------- reminders: debts and calendar dates ----------

export function useCalendarEvents() {
  return useQuery({ queryKey: ['calendar-events'], queryFn: () => unwrap<CalendarEvent[]>(client.api['calendar-events'].$get()) });
}

function useListMutation<V, R>(key: string, fn: (v: V) => Promise<Response>) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => unwrap<R>(fn(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

export const useCreateDebt = () => useListMutation<DebtCreate, Debt>('debts', (json) => client.api.debts.$post({ json }));
export const useDeleteDebt = () =>
  useListMutation<string, { ok: true }>('debts', (id) => client.api.debts[':id'].$delete({ param: { id } }));

/** Editing a debt is optimistic, so "segna come saldato" stamps at once. */
export function useUpdateDebt() {
  const qc = useQueryClient();
  return useMutation<Debt, ApiError, { id: string; patch: DebtPatch }, { before?: Debt[] }>({
    mutationFn: ({ id, patch }) => unwrap(client.api.debts[':id'].$patch({ param: { id }, json: patch })),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['debts'] });
      const before = qc.getQueryData<Debt[]>(['debts']);
      qc.setQueryData<Debt[]>(['debts'], (list) => list?.map((d) => (d.id === id ? ({ ...d, ...patch } as Debt) : d)));
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(['debts'], ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['debts'] }),
  });
}

export const useCreateCalendarEvent = () =>
  useListMutation<CalendarEventCreate, CalendarEvent>('calendar-events', (json) => client.api['calendar-events'].$post({ json }));
export const useUpdateCalendarEvent = () =>
  useListMutation<{ id: string; patch: CalendarEventPatch }, CalendarEvent>('calendar-events', ({ id, patch }) =>
    client.api['calendar-events'][':id'].$patch({ param: { id }, json: patch }),
  );
export const useDeleteCalendarEvent = () =>
  useListMutation<string, { ok: true }>('calendar-events', (id) => client.api['calendar-events'][':id'].$delete({ param: { id } }));
